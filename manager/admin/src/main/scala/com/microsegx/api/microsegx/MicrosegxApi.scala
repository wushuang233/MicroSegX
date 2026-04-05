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
