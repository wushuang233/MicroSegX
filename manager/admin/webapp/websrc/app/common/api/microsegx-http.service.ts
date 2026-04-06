import { Injectable } from '@angular/core';
import { PathConstant } from '@common/constants/path.constant';
import { MicrosegxOverview } from '@common/types';
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
      'Content-Type': 'application/json',
    });
  }

  getOverview(): Observable<MicrosegxOverview> {
    return this.http.get<MicrosegxOverview>(
      PathConstant.MICROSEGX_OVERVIEW_URL,
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
