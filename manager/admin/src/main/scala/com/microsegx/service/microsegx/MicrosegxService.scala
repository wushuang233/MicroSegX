package com.microsegx.service.microsegx

import com.microsegx.service.DefaultJsonFormats
import com.typesafe.scalalogging.LazyLogging
import org.apache.pekko.http.scaladsl.model.{
  ContentTypes,
  HttpEntity,
  HttpMethods,
  HttpRequest,
  HttpResponse,
  StatusCode,
  StatusCodes,
  Uri
}
import org.apache.pekko.http.scaladsl.model.headers.RawHeader
import org.apache.pekko.util.ByteString
import spray.json.*

import java.net.URI
import java.net.http.{
  HttpClient,
  HttpRequest as JavaHttpRequest,
  HttpResponse as JavaHttpResponse
}
import java.time.Duration
import scala.collection.mutable
import scala.jdk.CollectionConverters.*
import scala.util.Try
import scala.util.control.NonFatal

class MicrosegxService extends DefaultJsonFormats with LazyLogging {

  private final val DefaultBaseUrl         = "http://k8s-port-audit.port-audit.svc.cluster.local:8080"
  private final val HeaderCookie           = "Cookie"
  private final val HeaderSetCookie        = "Set-Cookie"
  private final val HeaderContentType      = "Content-Type"
  private final val HeaderAccept           = "Accept"
  private final val HeaderCacheControl     = "Cache-Control"
  private final val HeaderPragma           = "Pragma"
  private final val IgnoredResponseHeaders = Set(
    "content-length",
    "content-type",
    "connection",
    "transfer-encoding",
    "keep-alive",
    "upgrade",
    "date",
    "server"
  )

  private val baseUrl = sys.env
    .getOrElse("MICROSEGX_PORT_AUDIT_BASE_URL", DefaultBaseUrl)
    .stripSuffix("/")

  private val requestTimeout = Duration.ofSeconds(
    sys.env
      .get("MICROSEGX_PORT_AUDIT_TIMEOUT_SECONDS")
      .flatMap(value => Try(value.toLong).toOption)
      .getOrElse(30L)
  )

  private val overviewUpstreamTimeout = Duration.ofSeconds(
    sys.env
      .get("MICROSEGX_OVERVIEW_UPSTREAM_TIMEOUT_SECONDS")
      .flatMap(value => Try(value.toLong).toOption)
      .getOrElse(4L)
  )

  private val overviewCacheTtlMillis = Duration
    .ofSeconds(
      sys.env
        .get("MICROSEGX_OVERVIEW_CACHE_SECONDS")
        .flatMap(value => Try(value.toLong).toOption)
        .getOrElse(10L)
    )
    .toMillis

  private val httpClient = HttpClient
    .newBuilder()
    .connectTimeout(requestTimeout)
    .followRedirects(HttpClient.Redirect.NORMAL)
    .build()

  private val overviewCacheLock = new Object
  private val overviewCache     = mutable.Map.empty[String, CachedOverview]

  def getOverview(request: HttpRequest): JsObject = {
    val cacheKey = overviewCacheKey(request)
    val now      = System.currentTimeMillis()

    overviewCacheLock.synchronized {
      overviewCache.get(cacheKey).filter(_.expiresAtMillis > now).map(_.payload)
    } match {
      case Some(cached) =>
        cached
      case None         =>
        val stale = overviewCacheLock.synchronized {
          overviewCache.get(cacheKey).map(_.payload)
        }
        try {
          val fresh = buildOverview(request)
          overviewCacheLock.synchronized {
            overviewCache.update(
              cacheKey,
              CachedOverview(fresh, System.currentTimeMillis() + overviewCacheTtlMillis)
            )
          }
          fresh
        } catch {
          case NonFatal(e) =>
            logger.warn("Unable to build MicroSegX overview: {}", e.getMessage)
            stale.getOrElse(buildUnavailableOverview(e.getMessage))
        }
    }
  }

  private def buildOverview(request: HttpRequest): JsObject = {
    val forwardedHeaders = forwardedOverviewHeaders(request)
    val dashboardPayload =
      requestJson(
        HttpMethods.GET.value,
        "/api/dashboard",
        timeout = overviewUpstreamTimeout
      ).asJsObject
    val zitiSession      =
      requestJson(
        HttpMethods.GET.value,
        "/api/ziti/session",
        headers = forwardedHeaders,
        timeout = overviewUpstreamTimeout
      ).asJsObject
    val zitiSnapshot     = fetchZitiSnapshot(zitiSession, forwardedHeaders)

    JsObject(
      "baseUrl"      -> JsString(baseUrl),
      "portExposure" -> buildPortExposureSummary(dashboardPayload),
      "ziti"         -> buildZitiSummary(zitiSession, zitiSnapshot),
      "dashboard"    -> dashboardPayload,
      "zitiSession"  -> zitiSession,
      "zitiOverview" -> zitiSnapshot.getOrElse(JsObject())
    )
  }

  private def buildUnavailableOverview(reason: String): JsObject =
    JsObject(
      "baseUrl"      -> JsString(baseUrl),
      "portExposure" -> JsObject(
        "managedServices" -> JsNumber(0),
        "openPorts"       -> JsNumber(0),
        "exposedTargets"  -> JsNumber(0),
        "resourceCount"   -> JsNumber(0),
        "trafficTargets"  -> JsNumber(0),
        "nodes"           -> JsNumber(0),
        "generatedAt"     -> JsString(""),
        "scanInProgress"  -> JsBoolean(false)
      ),
      "ziti"         -> JsObject(
        "available"                    -> JsBoolean(false),
        "defaultControllerUrl"         -> JsString(""),
        "defaultCredentialsConfigured" -> JsBoolean(false),
        "aliveRouters"                 -> JsNumber(0),
        "deployedRouters"              -> JsNumber(0),
        "services"                     -> JsNumber(0),
        "configs"                      -> JsNumber(0),
        "identities"                   -> JsNumber(0),
        "controllerError"              -> JsString(reason)
      ),
      "dashboard"    -> JsObject("error" -> JsString(reason)),
      "zitiSession"  -> JsObject(),
      "zitiOverview" -> JsObject(),
      "degraded"     -> JsBoolean(true)
    )

  def proxyApi(request: HttpRequest, remainingPath: Uri.Path): HttpResponse = {
    val upstreamPath = buildApiTargetPath(remainingPath, request.uri.rawQueryString)
    val response     = send(
      method = request.method.value,
      path = upstreamPath,
      body = requestBody(request),
      headers = forwardedRequestHeaders(request)
    )
    toPekkoResponse(response)
  }

  def proxyPortExposureUi(request: HttpRequest, remainingPath: Uri.Path): HttpResponse = {
    val upstreamPath = buildPortExposureUiPath(remainingPath, request.uri.rawQueryString)
    toPekkoResponse(send(method = request.method.value, path = upstreamPath))
  }

  def proxyZitiUi(request: HttpRequest, remainingPath: Uri.Path): HttpResponse = {
    val upstreamPath = buildZitiUiPath(remainingPath, request.uri.rawQueryString)
    toPekkoResponse(send(method = request.method.value, path = upstreamPath))
  }

  def proxyPortExposureStatic(request: HttpRequest, path: String): HttpResponse =
    toPekkoResponse(send(method = request.method.value, path = path))

  def proxyZitiStatic(request: HttpRequest, path: String): HttpResponse =
    toPekkoResponse(send(method = request.method.value, path = path))

  private def buildPortExposureSummary(payload: JsObject): JsObject = {
    val serviceControls = objectField(payload, "service_controls")
    val externalSummary = objectField(payload, "external_exposure_summary")
    val exposureItems   = arrayField(externalSummary, "items")
    val nodeInventory   = arrayField(externalSummary, "node_inventory")
    val resourceCount   = exposureItems
      .map(_.asJsObject)
      .map(item =>
        s"${stringField(item, "namespace")}|${stringOption(item, "group_name").orElse(stringOption(item, "resource_name")).getOrElse("")}|${stringField(item, "resource_kind")}"
      )
      .toSet
      .size
    val trafficCount    = exposureItems.count { item =>
      val obj = item.asJsObject
      booleanField(obj, "traffic_observed") || booleanField(obj, "listener_observed")
    }

    JsObject(
      "managedServices" -> JsNumber(intField(serviceControls, "service_count")),
      "openPorts"       -> JsNumber(intField(serviceControls, "open_port_count")),
      "exposedTargets"  -> JsNumber(exposureItems.length),
      "resourceCount"   -> JsNumber(resourceCount),
      "trafficTargets"  -> JsNumber(trafficCount),
      "nodes"           -> JsNumber(nodeInventory.length),
      "generatedAt"     -> JsString(stringField(payload, "generated_at")),
      "scanInProgress"  -> JsBoolean(
        booleanField(objectField(payload, "scan_state"), "scan_in_progress")
      )
    )
  }

  private def buildZitiSummary(
    sessionPayload: JsObject,
    overviewPayload: Option[JsObject]
  ): JsObject = {
    val counts       =
      overviewPayload.map(payload => objectField(payload, "counts")).getOrElse(JsObject())
    val available    = overviewPayload.nonEmpty
    val errorMessage = overviewPayload.flatMap(payload => stringOption(payload, "error"))

    JsObject(
      "available"                    -> JsBoolean(available),
      "defaultControllerUrl"         -> JsString(stringField(sessionPayload, "default_controller_url")),
      "defaultCredentialsConfigured" -> JsBoolean(
        booleanField(sessionPayload, "default_credentials_configured")
      ),
      "aliveRouters"                 -> JsNumber(intField(counts, "alive_edge_routers")),
      "deployedRouters"              -> JsNumber(intField(counts, "deployed_edge_routers")),
      "services"                     -> JsNumber(intField(counts, "services")),
      "configs"                      -> JsNumber(intField(counts, "configs")),
      "identities"                   -> JsNumber(intField(counts, "identities")),
      "controllerError"              -> errorMessage.map(JsString(_)).getOrElse(JsNull)
    )
  }

  private def fetchZitiSnapshot(
    sessionPayload: JsObject,
    forwardedHeaders: Seq[(String, String)]
  ): Option[JsObject] = {
    // Prefer the browser's current Ziti session so the UI can reflect the
    // user's real logged-in state. Fall back to a short-lived session only
    // when default credentials are configured but the browser has no cookie.
    if (booleanField(sessionPayload, "logged_in")) {
      val forwardedOverview = Try(
        requestJson(
          HttpMethods.GET.value,
          "/api/ziti/overview",
          headers = forwardedHeaders,
          timeout = overviewUpstreamTimeout
        ).asJsObject
      ).toOption

      if (forwardedOverview.nonEmpty) {
        return forwardedOverview
      }

      logger.warn("Unable to fetch Ziti overview from forwarded browser session, falling back")
    }

    if (!booleanField(sessionPayload, "default_credentials_configured")) {
      return None
    }

    val loginResponse =
      send(
        method = HttpMethods.POST.value,
        path = "/api/ziti/login",
        body = ByteString("{}").toArray,
        headers = Seq(HeaderContentType -> "application/json"),
        timeout = overviewUpstreamTimeout
      )

    if (!isSuccess(loginResponse.statusCode)) {
      logger.warn(
        "Unable to establish a temporary Ziti session via port-audit: status={}",
        loginResponse.statusCode
      )
      return None
    }

    val cookieHeader = cookieHeaderFromResponse(loginResponse)
    val overview     = Try(
      requestJson(
        HttpMethods.GET.value,
        "/api/ziti/overview",
        headers = cookieHeader.toSeq.map(value => HeaderCookie -> value),
        timeout = overviewUpstreamTimeout
      ).asJsObject
    ).toOption

    cookieHeader.foreach { cookie =>
      Try(
        send(
          method = HttpMethods.POST.value,
          path = "/api/ziti/logout",
          body = ByteString("{}").toArray,
          headers = Seq(
            HeaderCookie      -> cookie,
            HeaderContentType -> "application/json"
          ),
          timeout = overviewUpstreamTimeout
        )
      )
    }

    overview
  }

  private def buildApiTargetPath(remainingPath: Uri.Path, rawQuery: Option[String]): String =
    buildTargetPath("/api", remainingPath, rawQuery)

  private def buildPortExposureUiPath(
    remainingPath: Uri.Path,
    rawQuery: Option[String]
  ): String = {
    val normalized = normalizeRemainingPath(remainingPath)
    val base       = if (normalized.isEmpty || normalized == "/") "/" else normalized
    appendQueryString(base, rawQuery)
  }

  private def buildZitiUiPath(remainingPath: Uri.Path, rawQuery: Option[String]): String = {
    val normalized = normalizeRemainingPath(remainingPath)
    val base       =
      if (normalized.isEmpty || normalized == "/") "/ziti/"
      else s"/ziti${ensureLeadingSlash(normalized)}"
    appendQueryString(base, rawQuery)
  }

  private def buildTargetPath(
    prefix: String,
    remainingPath: Uri.Path,
    rawQuery: Option[String]
  ): String = {
    val normalized = normalizeRemainingPath(remainingPath)
    appendQueryString(
      s"$prefix${if (normalized.isEmpty) "" else ensureLeadingSlash(normalized)}",
      rawQuery
    )
  }

  private def normalizeRemainingPath(path: Uri.Path): String = {
    val value = path.toString()
    if (value == "/") "" else value
  }

  private def appendQueryString(path: String, rawQuery: Option[String]): String =
    rawQuery.filter(_.nonEmpty).fold(path)(query => s"$path?$query")

  private def ensureLeadingSlash(path: String): String =
    if (path.startsWith("/")) path else s"/$path"

  private def forwardedRequestHeaders(request: HttpRequest): Seq[(String, String)] =
    request.headers.collect {
      case header
          if Set(
            HeaderCookie.toLowerCase,
            HeaderContentType.toLowerCase,
            HeaderAccept.toLowerCase,
            HeaderCacheControl.toLowerCase,
            HeaderPragma.toLowerCase
          ).contains(header.lowercaseName()) =>
        header.name() -> header.value()
    }

  private def forwardedOverviewHeaders(request: HttpRequest): Seq[(String, String)] =
    request.headers.collect {
      case header if header.lowercaseName() == HeaderCookie.toLowerCase =>
        header.name() -> header.value()
    }

  private def overviewCacheKey(request: HttpRequest): String =
    forwardedOverviewHeaders(request).map(_._2).mkString("|")

  private def requestBody(request: HttpRequest): Array[Byte] =
    request.entity match {
      case strict: HttpEntity.Strict => strict.data.toArray
      case _                         => Array.emptyByteArray
    }

  private def requestJson(
    method: String,
    path: String,
    body: Array[Byte] = Array.emptyByteArray,
    headers: Seq[(String, String)] = Nil,
    timeout: Duration = requestTimeout
  ): JsValue = {
    val response =
      send(method = method, path = path, body = body, headers = headers, timeout = timeout)
    if (!isSuccess(response.statusCode)) {
      throw new IllegalStateException(
        s"MicroSegX upstream request failed: ${response.statusCode} ${new String(response.body)}"
      )
    }
    responseText(response).parseJson
  }

  private def send(
    method: String,
    path: String,
    body: Array[Byte] = Array.emptyByteArray,
    headers: Seq[(String, String)] = Nil,
    timeout: Duration = requestTimeout
  ): UpstreamResponse = {
    val requestBuilder = JavaHttpRequest
      .newBuilder()
      .uri(URI.create(s"$baseUrl$path"))
      .timeout(timeout)

    headers.foreach { case (name, value) =>
      requestBuilder.header(name, value)
    }

    val normalizedMethod = method.toUpperCase
    val requestBody      =
      if (body.nonEmpty) JavaHttpRequest.BodyPublishers.ofByteArray(body)
      else JavaHttpRequest.BodyPublishers.noBody()

    val response = httpClient.send(
      requestBuilder.method(normalizedMethod, requestBody).build(),
      JavaHttpResponse.BodyHandlers.ofByteArray()
    )

    UpstreamResponse(
      statusCode = response.statusCode(),
      headers = response.headers().map().asScala.toSeq.flatMap { case (name, values) =>
        values.asScala.map(value => name -> value)
      },
      body = response.body()
    )
  }

  private def cookieHeaderFromResponse(response: UpstreamResponse): Option[String] = {
    val cookies = response.headers.collect {
      case (name, value) if name.equalsIgnoreCase(HeaderSetCookie) =>
        value.split(";", 2).headOption.getOrElse("").trim
    }.filter(_.nonEmpty)
    if (cookies.nonEmpty) Some(cookies.mkString("; ")) else None
  }

  private def responseText(response: UpstreamResponse): String =
    new String(response.body, java.nio.charset.StandardCharsets.UTF_8)

  private def toPekkoResponse(response: UpstreamResponse): HttpResponse = {
    val status          = statusCodeFor(response.statusCode)
    val responseHeaders = response.headers.collect {
      case (name, value) if !IgnoredResponseHeaders.contains(name.toLowerCase) =>
        RawHeader(name, value)
    }.toList

    HttpResponse(
      status = status,
      headers = responseHeaders,
      entity = HttpEntity(ContentTypes.NoContentType, ByteString(response.body))
    )
  }

  private def statusCodeFor(statusCode: Int): StatusCode =
    StatusCodes.getForKey(statusCode).getOrElse(StatusCodes.BadGateway)

  private def isSuccess(statusCode: Int): Boolean = statusCode >= 200 && statusCode < 300

  private def objectField(payload: JsObject, fieldName: String): JsObject =
    payload.fields.get(fieldName).collect { case value: JsObject => value }.getOrElse(JsObject())

  private def arrayField(payload: JsObject, fieldName: String): Vector[JsValue] =
    payload.fields
      .get(fieldName)
      .collect { case JsArray(values) => values }
      .getOrElse(Vector.empty)

  private def stringField(payload: JsObject, fieldName: String): String =
    stringOption(payload, fieldName).getOrElse("")

  private def stringOption(payload: JsObject, fieldName: String): Option[String] =
    payload.fields.get(fieldName) match {
      case Some(JsString(value))  => Some(value)
      case Some(JsNumber(value))  => Some(value.toString())
      case Some(JsBoolean(value)) => Some(value.toString)
      case _                      => None
    }

  private def intField(payload: JsObject, fieldName: String): Int =
    payload.fields.get(fieldName) match {
      case Some(JsNumber(value)) => value.toInt
      case Some(JsString(value)) => Try(value.toInt).getOrElse(0)
      case _                     => 0
    }

  private def booleanField(payload: JsObject, fieldName: String): Boolean =
    payload.fields.get(fieldName) match {
      case Some(JsBoolean(value)) => value
      case Some(JsString(value))  => value.equalsIgnoreCase("true")
      case _                      => false
    }
}

private case class UpstreamResponse(
  statusCode: Int,
  headers: Seq[(String, String)],
  body: Array[Byte]
)

private case class CachedOverview(payload: JsObject, expiresAtMillis: Long)
