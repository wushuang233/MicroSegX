package com.microsegx.api.microsegx

import com.microsegx.api.BaseApi
import com.microsegx.service.Utils
import com.microsegx.service.microsegx.MicrosegxService
import org.apache.pekko.http.scaladsl.model.{ ContentTypes, HttpEntity }
import org.apache.pekko.http.scaladsl.server.Route

import scala.concurrent.duration.*

class MicrosegxApi(resourceService: MicrosegxService) extends BaseApi {

  val publicRoute: Route = pathPrefix("microsegx" / "ui") {
    pathPrefix("port-exposure") {
      get {
        extractRequest { request =>
          extractUnmatchedPath { remainingPath =>
            Utils.respondWithWebServerHeaders(
              isStaticResource = true,
              isJs = remainingPath.toString().endsWith(".js")
            ) {
              complete(resourceService.proxyPortExposureUi(request, remainingPath))
            }
          }
        }
      }
    } ~
    pathPrefix("ziti") {
      get {
        extractRequest { request =>
          extractUnmatchedPath { remainingPath =>
            Utils.respondWithWebServerHeaders(
              isStaticResource = true,
              isJs = remainingPath.toString().endsWith(".js")
            ) {
              complete(resourceService.proxyZitiUi(request, remainingPath))
            }
          }
        }
      }
    }
  } ~
    // Public static resources for port-audit embedded UIs
    // These are requested by the iframe pages at /microsegx/ui/port-exposure/ and /microsegx/ui/ziti/
    path("styles.css") {
      get {
        extractRequest { request =>
          Utils.respondWithWebServerHeaders(isStaticResource = true) {
            complete(resourceService.proxyPortExposureStatic(request, "/styles.css"))
          }
        }
      }
    } ~
    path("app.js") {
      get {
        extractRequest { request =>
          Utils.respondWithWebServerHeaders(isStaticResource = true, isJs = true) {
            complete(resourceService.proxyPortExposureStatic(request, "/app.js"))
          }
        }
      }
    } ~
    pathPrefix("ziti") {
      path("styles.css") {
        get {
          extractRequest { request =>
            Utils.respondWithWebServerHeaders(isStaticResource = true) {
              complete(resourceService.proxyZitiStatic(request, "/ziti/styles.css"))
            }
          }
        }
      } ~
      path("app.js") {
        get {
          extractRequest { request =>
            Utils.respondWithWebServerHeaders(isStaticResource = true, isJs = true) {
              complete(resourceService.proxyZitiStatic(request, "/ziti/app.js"))
            }
          }
        }
      }
    }

  val route: Route = headerValueByName("Token") { _ =>
    pathPrefix("microsegx") {
      path("overview") {
        get {
          Utils.respondWithWebServerHeaders() {
            complete(
              HttpEntity(
                ContentTypes.`application/json`,
                resourceService.getOverview.compactPrint
              )
            )
          }
        }
      } ~
      pathPrefix("api") {
        toStrictEntity(30.seconds) {
          extractRequest { request =>
            extractUnmatchedPath { remainingPath =>
              Utils.respondWithWebServerHeaders() {
                complete(resourceService.proxyApi(request, remainingPath))
              }
            }
          }
        }
      }
    }
  }
}
