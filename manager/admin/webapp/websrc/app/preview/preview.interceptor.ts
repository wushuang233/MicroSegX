import {
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  PREVIEW_ALL_SCANNED_IMAGES_RESPONSE,
  PREVIEW_ALL_SCANNED_IMAGES_SUMMARY_RESPONSE,
  PREVIEW_CLUSTER_DATA,
  PREVIEW_CONFIG_V2_RESPONSE,
  PREVIEW_CONTAINER_BRIEF_RESPONSE,
  PREVIEW_CONTAINER_RESPONSE,
  PREVIEW_CVE_PROFILE_RESPONSE,
  PREVIEW_DASHBOARD_DETAILS,
  PREVIEW_DASHBOARD_NOTIFICATIONS,
  PREVIEW_DASHBOARD_SCORES,
  PREVIEW_DOMAINS_RESPONSE,
  PREVIEW_ENFORCER_RESPONSE,
  PREVIEW_HOST_RESPONSE,
  PREVIEW_IP_GEO_RESPONSE,
  PREVIEW_PACKET_RESPONSE,
  PREVIEW_POLICY_RULE_RESPONSE,
  PREVIEW_PROCESS_HISTORY_RESPONSE,
  PREVIEW_PROCESS_RESPONSE,
  PREVIEW_PROCESS_PROFILE_RESPONSE,
  PREVIEW_REGISTRY_IMAGE_DETAIL_RESPONSE,
  PREVIEW_REGISTRY_LAYER_DETAIL_RESPONSE,
  PREVIEW_REGISTRY_REPO_RESPONSE,
  PREVIEW_REGISTRY_SUMMARIES,
  PREVIEW_REGISTRY_TYPES,
  PREVIEW_REBRAND_RESPONSE,
  PREVIEW_SCAN_CONFIG_RESPONSE,
  PREVIEW_SCANNED_WORKLOADS,
  PREVIEW_SECURITY_EVENTS_RAW,
  PREVIEW_SUMMARY_RESPONSE,
  PREVIEW_SYSTEM_ALERTS,
  PREVIEW_USER,
  PREVIEW_VUL_QUERY_DATA,
  PREVIEW_VUL_QUERY_SESSION,
  PREVIEW_VERSION,
  PREVIEW_WORKLOAD_COMPLIANCE_RESPONSE,
  PREVIEW_WORKLOAD_VUL_REPORT,
} from './preview-data';

@Injectable()
export class PreviewInterceptor implements HttpInterceptor {
  intercept(
    req: HttpRequest<any>,
    next: HttpHandler
  ): Observable<HttpEvent<any>> {
    if (!environment.previewMode) {
      return next.handle(req);
    }

    const url = req.url.split('?')[0];
    const method = req.method.toUpperCase();

    switch (`${method} ${url}`) {
      case 'GET token_auth_server':
        return this.ok({ servers: [] });
      case 'PATCH token_auth_server':
      case 'GET self':
      case 'POST auth':
        return this.ok(PREVIEW_USER);
      case 'DELETE auth':
      case 'PATCH heartbeat':
      case 'POST notification/accept':
      case 'PATCH processProfile':
      case 'POST policy/rule':
      case 'POST scan/config':
      case 'POST risk/cve/profile/entry':
      case 'POST eula':
        return this.ok({});
      case 'GET eula':
        return this.ok({ eula: { accepted: true } });
      case 'GET rebrand':
        return this.ok(PREVIEW_REBRAND_RESPONSE);
      case 'GET gravatar':
        return this.ok('false');
      case 'GET fed/member':
        return this.ok(PREVIEW_CLUSTER_DATA);
      case 'GET config-v2':
        return this.ok(PREVIEW_CONFIG_V2_RESPONSE);
      case 'GET scan/config':
        return this.ok(PREVIEW_SCAN_CONFIG_RESPONSE);
      case 'GET summary':
        return this.ok(PREVIEW_SUMMARY_RESPONSE);
      case 'GET dashboard/scores':
      case 'POST dashboard/scores':
        return this.ok(PREVIEW_DASHBOARD_SCORES);
      case 'GET dashboard/details':
        return this.ok(PREVIEW_DASHBOARD_DETAILS);
      case 'GET dashboard/notifications':
        return this.ok(PREVIEW_DASHBOARD_NOTIFICATIONS);
      case 'GET dashboard/alerts':
        return this.ok(PREVIEW_SYSTEM_ALERTS);
      case 'GET security-events2':
        return this.ok(PREVIEW_SECURITY_EVENTS_RAW);
      case 'PATCH ip-geo':
        return this.ok(PREVIEW_IP_GEO_RESPONSE);
      case 'GET host':
        return this.ok(PREVIEW_HOST_RESPONSE);
      case 'GET container':
        return this.ok(PREVIEW_CONTAINER_BRIEF_RESPONSE);
      case 'GET workload/scanned':
        return this.ok(PREVIEW_SCANNED_WORKLOADS);
      case 'GET workload/compliance':
        return this.ok(PREVIEW_WORKLOAD_COMPLIANCE_RESPONSE);
      case 'GET scan/workload':
        return this.ok(PREVIEW_WORKLOAD_VUL_REPORT);
      case 'GET container/process':
        return this.ok(PREVIEW_PROCESS_RESPONSE);
      case 'GET container/processHistory':
        return this.ok(PREVIEW_PROCESS_HISTORY_RESPONSE);
      case 'GET workload/workload-by-id':
        return this.ok(PREVIEW_CONTAINER_RESPONSE);
      case 'GET single-enforcer':
        return this.ok(PREVIEW_ENFORCER_RESPONSE);
      case 'GET threat':
        return this.ok(PREVIEW_PACKET_RESPONSE);
      case 'GET processProfile':
        return this.ok(PREVIEW_PROCESS_PROFILE_RESPONSE);
      case 'GET policy/rule':
        return this.ok(PREVIEW_POLICY_RULE_RESPONSE);
      case 'GET domain':
        return this.ok(PREVIEW_DOMAINS_RESPONSE);
      case 'GET risk/cve/profile':
        return this.ok(PREVIEW_CVE_PROFILE_RESPONSE);
      case 'POST vulasset':
        return this.ok(PREVIEW_VUL_QUERY_DATA);
      case 'GET vulasset':
        return this.ok(PREVIEW_VUL_QUERY_SESSION);
      case 'GET scan/registry':
        return this.ok(PREVIEW_REGISTRY_SUMMARIES);
      case 'GET scan/registry/type':
        return this.ok(PREVIEW_REGISTRY_TYPES);
      case 'GET scan/registry/repo':
        return this.ok(PREVIEW_REGISTRY_REPO_RESPONSE);
      case 'GET scan/registry/fed-repo':
        return this.ok(PREVIEW_REGISTRY_REPO_RESPONSE);
      case 'GET scan/registry/image':
        return this.ok(PREVIEW_REGISTRY_IMAGE_DETAIL_RESPONSE);
      case 'GET scan/registry/layer':
        return this.ok(PREVIEW_REGISTRY_LAYER_DETAIL_RESPONSE);
      case 'POST scanned-assets':
        return this.ok(PREVIEW_ALL_SCANNED_IMAGES_SUMMARY_RESPONSE);
      case 'GET scanned-assets':
        return this.ok(PREVIEW_ALL_SCANNED_IMAGES_RESPONSE);
      case 'GET version':
        return this.ok(PREVIEW_VERSION);
      default:
        return next.handle(req);
    }
  }

  private ok(body: any): Observable<HttpEvent<any>> {
    return of(new HttpResponse({ status: 200, body: this.clone(body) }));
  }

  private clone<T>(body: T): T {
    if (typeof body === 'string') {
      return body;
    }

    return JSON.parse(JSON.stringify(body));
  }
}
