import { Injectable } from '@angular/core';
import { PathConstant } from '@common/constants/path.constant';
import {
  MicrosegxAutoPolicyEvent,
  MicrosegxAutoPolicyFeature,
  MicrosegxAutoPolicyConfigRequest,
  MicrosegxAutoPolicyDeleteResult,
  MicrosegxAutoPolicyRuleCreateRequest,
  MicrosegxAutoPolicyRuleUpdateRequest,
  MicrosegxAutoPolicyRuleSummary,
  MicrosegxAutoPolicyStatus,
  MicrosegxOverview,
} from '@common/types';
import { GlobalVariable } from '@common/variables/global.variable';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class MicrosegxHttpService {
  constructor(private http: HttpClient) {}

  private getHeaders(): HttpHeaders {
    const token = GlobalVariable.nvToken || localStorage.getItem('token');
    return new HttpHeaders({
      Token: token || '',
      'X-Auth-Token': token || '',
      'Content-Type': 'application/json',
    });
  }

  getOverview(): Observable<MicrosegxOverview> {
    return this.http.get<MicrosegxOverview>(
      PathConstant.MICROSEGX_OVERVIEW_URL,
      { headers: this.getHeaders() }
    );
  }

  getAutoPolicyStatus(): Observable<{ status: MicrosegxAutoPolicyStatus }> {
    return this.http.get<{ status: MicrosegxAutoPolicyStatus }>(
      PathConstant.AUTO_POLICY_STATUS_URL,
      { headers: this.getHeaders() }
    );
  }

  updateAutoPolicyConfig(
    mode: MicrosegxAutoPolicyConfigRequest['config']['mode']
  ): Observable<{ status: MicrosegxAutoPolicyStatus }> {
    const body: MicrosegxAutoPolicyConfigRequest = {
      config: { mode },
    };
    return this.http.patch<{ status: MicrosegxAutoPolicyStatus }>(
      PathConstant.AUTO_POLICY_CONFIG_URL,
      body,
      { headers: this.getHeaders() }
    );
  }

  updateGlobalNetworkPolicyMode(
    mode: 'Discover' | 'Monitor' | 'Protect'
  ): Observable<any> {
    return this.http.patch(
      PathConstant.SERVICE_ALL,
      {
        policy_mode: mode,
        profile_mode: 'Discover',
        baseline_profile: 'zero-drift',
      },
      { headers: this.getHeaders() }
    );
  }

  updateSystemNetworkPolicyMode(
    mode: 'Discover' | 'Monitor' | 'Protect'
  ): Observable<any> {
    return this.http.patch(
      PathConstant.CONFIG_V2_URL,
      {
        net_config: {
          net_service_status: false,
          net_service_policy_mode: mode,
          disable_net_policy: false,
          strict_group_mode: false,
        },
        config_v2: {
          svc_cfg: {
            new_service_policy_mode: mode,
            new_service_profile_mode: 'Discover',
            new_service_profile_baseline: 'zero-drift',
          },
        },
      },
      { headers: this.getHeaders() }
    );
  }

  getAutoPolicyRules(): Observable<{
    rules: MicrosegxAutoPolicyRuleSummary[];
  }> {
    return this.http.get<{ rules: MicrosegxAutoPolicyRuleSummary[] }>(
      PathConstant.AUTO_POLICY_RULES_URL,
      { headers: this.getHeaders() }
    );
  }

  getAutoPolicyRuleDetail(
    id: number | string
  ): Observable<{ rule: MicrosegxAutoPolicyRuleSummary }> {
    return this.http.get<{ rule: MicrosegxAutoPolicyRuleSummary }>(
      `${PathConstant.AUTO_POLICY_RULES_URL}/${id}`,
      { headers: this.getHeaders() }
    );
  }

  createAutoPolicyRule(
    config: MicrosegxAutoPolicyRuleCreateRequest['config']
  ): Observable<{ rule: MicrosegxAutoPolicyRuleSummary }> {
    const body: MicrosegxAutoPolicyRuleCreateRequest = { config };
    return this.http.post<{ rule: MicrosegxAutoPolicyRuleSummary }>(
      PathConstant.AUTO_POLICY_RULES_URL,
      body,
      { headers: this.getHeaders() }
    );
  }

  updateAutoPolicyRule(
    id: number | string,
    config: MicrosegxAutoPolicyRuleUpdateRequest['config']
  ): Observable<{ rule: MicrosegxAutoPolicyRuleSummary }> {
    const body: MicrosegxAutoPolicyRuleUpdateRequest = { config };
    return this.http.patch<{ rule: MicrosegxAutoPolicyRuleSummary }>(
      `${PathConstant.AUTO_POLICY_RULES_URL}/${id}`,
      body,
      { headers: this.getHeaders() }
    );
  }

  deleteAutoPolicyRules(
    ids: Array<number | string>
  ): Observable<{ result: MicrosegxAutoPolicyDeleteResult }> {
    return this.http.request<{ result: MicrosegxAutoPolicyDeleteResult }>(
      'delete',
      PathConstant.AUTO_POLICY_RULES_URL,
      {
        body: { ids: ids.map(id => Number(id)).filter(id => id > 0) },
        headers: this.getHeaders(),
      }
    );
  }

  getAutoPolicyFeatures(): Observable<{
    features: MicrosegxAutoPolicyFeature[];
  }> {
    return this.http.get<{ features: MicrosegxAutoPolicyFeature[] }>(
      PathConstant.AUTO_POLICY_FEATURES_URL,
      { headers: this.getHeaders() }
    );
  }

  getAutoPolicyEvents(): Observable<{ events: MicrosegxAutoPolicyEvent[] }> {
    return this.http.get<{ events: MicrosegxAutoPolicyEvent[] }>(
      PathConstant.AUTO_POLICY_EVENTS_URL,
      { headers: this.getHeaders() }
    );
  }

  // Port Exposure APIs
  getPortExposureServices(): Observable<any> {
    return this.http.get<any>('/microsegx/api/service_controls', {
      headers: this.getHeaders(),
    });
  }

  getExternalExposure(): Observable<any> {
    return this.http.get<any>('/microsegx/api/external_exposure_summary', {
      headers: this.getHeaders(),
    });
  }

  getNodes(): Observable<any> {
    return this.http.get<any>('/microsegx/api/nodes', {
      headers: this.getHeaders(),
    });
  }

  getNamespaces(): Observable<any> {
    return this.http.get<any>('/microsegx/api/namespaces', {
      headers: this.getHeaders(),
    });
  }

  triggerScan(): Observable<any> {
    return this.http.post<any>(
      '/microsegx/api/scan',
      {},
      { headers: this.getHeaders() }
    );
  }

  getScanStatus(): Observable<any> {
    return this.http.get<any>('/microsegx/api/scan_state', {
      headers: this.getHeaders(),
    });
  }

  // Ziti APIs
  getZitiSession(): Observable<any> {
    return this.http.get<any>('/microsegx/api/ziti/session', {
      headers: this.getHeaders(),
    });
  }

  getZitiOverview(): Observable<any> {
    return this.http.get<any>('/microsegx/api/ziti/overview', {
      headers: this.getHeaders(),
    });
  }

  getZitiRouters(): Observable<any> {
    return this.http.get<any>('/microsegx/api/ziti/routers', {
      headers: this.getHeaders(),
    });
  }

  getZitiServices(): Observable<any> {
    return this.http.get<any>('/microsegx/api/ziti/services', {
      headers: this.getHeaders(),
    });
  }

  getZitiIdentities(): Observable<any> {
    return this.http.get<any>('/microsegx/api/ziti/identities', {
      headers: this.getHeaders(),
    });
  }

  getZitiConfigs(): Observable<any> {
    return this.http.get<any>('/microsegx/api/ziti/configs', {
      headers: this.getHeaders(),
    });
  }
}
