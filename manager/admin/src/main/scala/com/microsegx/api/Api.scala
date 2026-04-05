package com.microsegx.api

import com.microsegx.api.authentication.AuthenticationApi
import com.microsegx.api.cluster.ClusterApi
import com.microsegx.api.dashboard.DashboardApi
import com.microsegx.api.device.DeviceApi
import com.microsegx.api.group.GroupApi
import com.microsegx.api.microsegx.MicrosegxApi
import com.microsegx.api.notification.NotificationApi
import com.microsegx.api.policy.PolicyApi
import com.microsegx.api.risk.RiskApi
import com.microsegx.api.sigstore.SigstoreApi
import com.microsegx.api.workload.WorkloadApi
import com.microsegx.client.RestClient.handleError
import com.microsegx.core.{ Core, CoreActors, HttpResponseException }
import com.microsegx.service.*
import com.microsegx.service.authentication.{
  AuthProvider,
  AuthService,
  AuthServiceFactory,
  ExtraAuthService
}
import com.microsegx.service.cluster.ClusterService
import com.microsegx.service.dashboard.DashboardService
import com.microsegx.service.device.DeviceService
import com.microsegx.service.group.GroupService
import com.microsegx.service.microsegx.MicrosegxService
import com.microsegx.service.notification.NotificationService
import com.microsegx.service.policy.PolicyService
import com.microsegx.service.risk.RiskService
import com.microsegx.service.sigstore.SigstoreService
import com.microsegx.service.workload.WorkloadService
import org.apache.pekko.http.scaladsl.model.{ ContentTypes, HttpEntity, HttpResponse }
import org.apache.pekko.http.scaladsl.server.{ Directives, ExceptionHandler, Route }

import scala.concurrent.ExecutionContext.Implicits.global

/**
 * The REST API layer. It exposes the REST services, but does not provide any web server
 * interface.<br/> Notice that it requires to be mixed in with ``core.CoreActors``, which provides
 * access to the top-level actors that make up the system.
 */
trait Api extends Directives with CoreActors with Core {

  private final val timeOutStatus              = "Status: 408"
  private final val authenticationFailedStatus = "Status: 401"
  private final val serverErrorStatus          = "Status: 503"

  implicit def exceptionHandler: ExceptionHandler =
    ExceptionHandler {
      case e: HttpResponseException =>
        complete(
          HttpResponse(
            status = e.statusCode,
            entity = e.response.entity
          )
        )
      case e: Exception             =>
        val (status, message) =
          handleError(timeOutStatus, authenticationFailedStatus, serverErrorStatus, e)
        complete(
          HttpResponse(
            status = status,
            entity = HttpEntity(ContentTypes.`application/json`, message)
          )
        )
    }

  private val authServiceFactory                 = new AuthServiceFactory()
  private val openIdAuthService: AuthService     =
    authServiceFactory.createService(AuthProvider.OPEN_ID)
  private val samlAuthService: AuthService       = authServiceFactory.createService(AuthProvider.SAML)
  private val suseAuthService: AuthService       = authServiceFactory.createService(AuthProvider.SUSE)
  private val extraAuthService: ExtraAuthService = authServiceFactory.createExtraAuthService()
  private val dashboardService                   = new DashboardService()
  private val clusterService                     = new ClusterService()
  private val deviceService                      = new DeviceService()
  private val groupService                       = new GroupService()
  private val microsegxService                   = new MicrosegxService()
  private val notificationService                = new NotificationService()
  private val policyService                      = new PolicyService()
  private val riskService                        = new RiskService()
  private val sigstoreService                    = new SigstoreService()
  private val workloadService                    = new WorkloadService()

  private val authenticationApi =
    new AuthenticationApi(openIdAuthService, samlAuthService, suseAuthService, extraAuthService)
  private val dashboardApi      = new DashboardApi(dashboardService)
  private val clusterApi        = new ClusterApi(clusterService)
  private val deviceApi         = new DeviceApi(deviceService)
  private val groupApi          = new GroupApi(groupService)
  private val microsegxApi      = new MicrosegxApi(microsegxService)
  private val notificationApi   = new NotificationApi(notificationService)
  private val policyApi         = new PolicyApi(policyService)
  private val riskApi           = new RiskApi(riskService)
  private val sigstoreApi       = new SigstoreApi(sigstoreService)
  private val workloadApi       = new WorkloadApi(workloadService)

  val routes: Route = handleExceptions(exceptionHandler) {
    microsegxApi.publicRoute ~
    authenticationApi.route ~
    dashboardApi.route ~
    clusterApi.route ~
    deviceApi.route ~
    groupApi.route ~
    microsegxApi.route ~
    notificationApi.route ~
    policyApi.route ~
    riskApi.route ~
    sigstoreApi.route ~
    workloadApi.route
  }
}
