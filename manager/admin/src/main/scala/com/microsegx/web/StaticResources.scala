package com.microsegx.web

import java.nio.charset.StandardCharsets

import com.google.common.net.UrlEscapers
import com.microsegx.core.CommonSettings.*
import com.microsegx.core.Md5
import com.microsegx.service.Utils
import com.typesafe.scalalogging.LazyLogging
import org.apache.pekko.http.scaladsl.model.ContentTypes
import org.apache.pekko.http.scaladsl.model.HttpEntity
import org.apache.pekko.http.scaladsl.model.HttpResponse
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.apache.pekko.http.scaladsl.model.Uri
import org.apache.pekko.http.scaladsl.model.headers.Location
import org.apache.pekko.http.scaladsl.model.headers.RawHeader
import org.apache.pekko.http.scaladsl.server.Directives
import org.apache.pekko.http.scaladsl.server.Route

import scala.io.Source

trait StaticResources extends Directives with LazyLogging {
  private val shortPath                       = 10
  private val isUsingSSL: Boolean             = sys.env.getOrElse("MANAGER_SSL", "on") == "on"
  private val isDev: Boolean                  = sys.env.getOrElse("IS_DEV", "false") == "true"
  private val noCacheHeader                   =
    RawHeader("Cache-Control", "private, no-cache, no-store, must-revalidate")
  private val indexHtmlResourcePaths          = Seq("/root/index.html", "/index.html")
  private lazy val indexVersionHash: String   =
    Md5.hash(loadIndexHtml()).take(shortPath)
  private lazy val versionedIndexPath: String = s"/index.html?v=$indexVersionHash"

  private def loadIndexHtml(): String =
    indexHtmlResourcePaths.view
      .flatMap(path => Option(getClass.getResourceAsStream(path)).map(path -> _))
      .headOption
      .map { case (_, stream) =>
        try
          Source.fromInputStream(stream, StandardCharsets.UTF_8.name()).mkString
        finally
          stream.close()
      }
      .getOrElse {
        logger.warn(
          "Unable to load index html from resources {}, fallback to managerVersion for UI hash",
          indexHtmlResourcePaths.mkString(",")
        )
        managerVersion
      }

  // # Rewrite redirect-implementation base on "spray/spray-routing/src/main/scala/spray/routing/RequestContext.scala, added strict transport security header"
  private def redirectMe(uri: Uri, redirectionType: StatusCodes.Redirection) =
    complete {
      HttpResponse(
        status = redirectionType,
        headers =
          if (isUsingSSL)
            Location(uri) :: noCacheHeader :: RawHeader(
              "X-Frame-Options",
              "SAMEORIGIN"
            ) :: RawHeader(
              "Strict-Transport-Security",
              "max-age=31536000; includeSubDomains; preload"
            ) :: Nil
          else {
            Location(uri) :: noCacheHeader :: RawHeader("X-Frame-Options", "SAMEORIGIN") :: Nil
          },
        entity = redirectionType.htmlTemplate match {
          case ""       => HttpEntity.Empty
          case template => HttpEntity(ContentTypes.`text/html(UTF-8)`, template.format(uri))
        }
      )
    }

  val staticResources: Route = get {
    path("") {
      redirectMe(
        UrlEscapers.urlFragmentEscaper().escape(versionedIndexPath),
        StatusCodes.TemporaryRedirect
      )
    } ~
    path("index.html") {
      parameters(Symbol("v").?) { v =>
        val hash = indexVersionHash
        if (v.isEmpty) {
          redirectMe(
            UrlEscapers.urlFragmentEscaper().escape(versionedIndexPath),
            StatusCodes.TemporaryRedirect
          )
        } else {
          if (v.get.equals(hash)) {
            respondWithHeader(noCacheHeader) {
              Utils.respondWithWebServerHeaders(isStaticResource = true) {
                getFromResource("root/index.html")
              }
            }
          } else {
            logger.info("Previous version hash: {}", v.get)
            logger.info("Current version hash: {}", hash)
            redirectMe(
              UrlEscapers.urlFragmentEscaper().escape(versionedIndexPath),
              StatusCodes.TemporaryRedirect
            )
          }
        }
      }
    } ~
    path("favicon.ico") {
      Utils.respondWithWebServerHeaders(isStaticResource = true) {
        complete(StatusCodes.NotFound)
      }
    } ~
    path(Remaining) { path =>
      if (isDev) {
        Utils.respondWithWebServerHeaders(isStaticResource = true) {
          getFromResource(UrlEscapers.urlFragmentEscaper().escape(s"root/$path"))
        }
      } else {
        if (path.endsWith(".js")) {
          Utils.respondWithWebServerHeaders(isStaticResource = true) {
            respondWithHeader(RawHeader("Content-Type", "application/javascript")) {
              encodeResponse {
                getFromResource(
                  UrlEscapers.urlFragmentEscaper().escape(s"root/$path.gz")
                )
              }
            }
          }
        } else {
          Utils.respondWithWebServerHeaders(isStaticResource = true) {
            getFromResource(UrlEscapers.urlFragmentEscaper().escape(s"root/$path"))
          }
        }
      }
    }
  }
}
