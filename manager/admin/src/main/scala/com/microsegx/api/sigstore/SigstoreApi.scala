package com.microsegx.api.sigstore

import com.microsegx.api.BaseApi
import com.microsegx.client.RestClient.*
import com.microsegx.model.*
import com.microsegx.model.SigstoreJsonProtocol.given
import com.microsegx.service.Utils
import com.microsegx.service.sigstore.SigstoreService
import org.apache.pekko.http.scaladsl.server.Route

class SigstoreApi(resourceService: SigstoreService) extends BaseApi {

  val route: Route =
    headerValueByName("Token") { tokenId =>
      pathPrefix("sigstore") {
        pathEnd {
          get {
            Utils.respondWithWebServerHeaders() {
              resourceService.getSigstoreList(tokenId)
            }
          } ~
          post {
            entity(as[RootOfTrust]) { rootOfTrust =>
              Utils.respondWithWebServerHeaders() {
                resourceService.createSigstore(tokenId, rootOfTrust)
              }
            }
          } ~
          patch {
            entity(as[RootOfTrust]) { rootOfTrust =>
              Utils.respondWithWebServerHeaders() {
                resourceService.updateSigstore(tokenId, rootOfTrust)
              }
            }
          } ~
          delete {
            parameters(Symbol("rootOfTrustName")) { rootOfTrustName =>
              Utils.respondWithWebServerHeaders() {
                resourceService.removeSigstore(tokenId, rootOfTrustName)
              }
            }
          }
        }
      } ~
      path("verifier") {
        get {
          parameters(Symbol("rootOfTrustName")) { rootOfTrustName =>
            Utils.respondWithWebServerHeaders() {
              resourceService.getVerifiers(tokenId, rootOfTrustName)
            }
          }
        } ~
        post {
          entity(as[Verifier]) { verifier =>
            Utils.respondWithWebServerHeaders() {
              resourceService.createVerifier(tokenId, verifier)
            }
          }
        } ~
        patch {
          entity(as[Verifier]) { verifier =>
            Utils.respondWithWebServerHeaders() {
              resourceService.updateVerifier(tokenId, verifier)
            }
          }
        } ~
        delete {
          parameters(Symbol("rootOfTrustName"), Symbol("verifierName")) {
            (rootOfTrustName, verifierName) =>
              Utils.respondWithWebServerHeaders() {
                resourceService.removeVerifier(tokenId, verifierName, rootOfTrustName)
              }
          }
        }
      }
    }
}
