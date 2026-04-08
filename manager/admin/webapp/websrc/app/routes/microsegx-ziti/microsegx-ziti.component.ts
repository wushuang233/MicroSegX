import { Component, OnInit } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { GlobalVariable } from '@common/variables/global.variable';
import { TranslateService } from '@ngx-translate/core';

interface ZitiEntity {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  tags?: Record<string, any>;
  [key: string]: any;
}

interface EdgeRouter extends ZitiEntity {
  isOnline?: boolean;
  hostname?: string;
  disabled?: boolean;
  cost?: number;
  roleAttributes?: string[];
  supportedProtocols?: Record<string, string>;
  versionInfo?: {
    version: string;
    arch: string;
    os: string;
  };
  k8sWorkload?: {
    deploymentName: string;
    routerName: string;
    available: boolean;
    readyReplicas: number;
    replicas: number;
    nodePort: number;
    publicHost: string;
    advertisedPort: number;
    serviceName: string;
  };
}

interface ZitiService extends ZitiEntity {
  encryptionRequired?: boolean;
  configs?: string[];
  terminatorStrategy?: string;
  roleAttributes?: string[];
}

interface Identity extends ZitiEntity {
  type?: string;
  enrollment?: Record<string, any>;
  roleAttributes?: string[];
  isAdmin?: boolean;
  authenticators?: any;
}

interface ZitiConfig extends ZitiEntity {
  configTypeId?: string;
  configType?: { name: string; id: string };
  data?: Record<string, any>;
}

interface ServicePolicy extends ZitiEntity {
  type?: 'Dial' | 'Bind';
  semantic?: 'AnyOf' | 'AllOf';
  serviceRoles?: string[];
  identityRoles?: string[];
}

interface EdgeRouterPolicy extends ZitiEntity {
  semantic?: 'AnyOf' | 'AllOf';
  edgeRouterRoles?: string[];
  identityRoles?: string[];
}

interface ServiceEdgeRouterPolicy extends ZitiEntity {
  semantic?: 'AnyOf' | 'AllOf';
  serviceRoles?: string[];
  edgeRouterRoles?: string[];
}

interface ZitiOverview {
  edge_routers?: EdgeRouter[];
  edge_router_workloads?: any[];
  services?: ZitiService[];
  identities?: Identity[];
  configs?: ZitiConfig[];
  service_policies?: ServicePolicy[];
  edge_router_policies?: EdgeRouterPolicy[];
  service_edge_router_policies?: ServiceEdgeRouterPolicy[];
  counts?: {
    alive_edge_routers?: number;
    deployed_edge_routers?: number;
    services?: number;
    configs?: number;
    identities?: number;
  };
  error?: string;
}

interface ZitiSession {
  default_controller_url?: string;
  default_credentials_configured?: boolean;
  logged_in?: boolean;
  identity_name?: string;
  expires_at?: number;
  controller_url?: string;
  username?: string;
}

@Component({
  standalone: false,
  selector: 'app-microsegx-ziti',
  templateUrl: './microsegx-ziti.component.html',
  styleUrls: ['./microsegx-ziti.component.scss'],
})
export class MicrosegxZitiComponent implements OnInit {
  session: ZitiSession | null = null;
  overview: ZitiOverview | null = null;
  loading = false;
  error = '';

  // Tab state
  activeTab: 'routers' | 'services' | 'identities' | 'configs' | 'policies' =
    'routers';

  get activeTabIndex(): number {
    const tabs = ['routers', 'services', 'identities', 'configs', 'policies'];
    return tabs.indexOf(this.activeTab);
  }

  set activeTabIndex(index: number) {
    const tabs = [
      'routers',
      'services',
      'identities',
      'configs',
      'policies',
    ] as const;
    if (index >= 0 && index < tabs.length) {
      this.activeTab = tabs[index];
    }
  }

  // Dialog state
  showRouterDeployDialog = false;
  showCreateDialog = false;
  showEditDialog = false;
  showDeleteConfirm = false;
  dialogLoading = false;
  dialogError = '';

  // Selected entity for operations
  selectedEntity: ZitiEntity | null = null;
  selectedEntityType: string = '';

  // Router deploy form
  routerDeployForm = {
    routerName: '',
    publicHost: '',
    nodePort: null as number | null,
  };

  // Create/Edit form
  entityForm: Record<string, any> = {};

  // Config types for creating configs
  configTypes: { id: string; name: string }[] = [];

  constructor(
    private http: HttpClient,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.checkSessionAndLoad();
  }

  private getHeaders(): HttpHeaders {
    const token = GlobalVariable.nvToken || localStorage.getItem('token');
    return new HttpHeaders({
      Token: token || '',
      'Content-Type': 'application/json',
    });
  }

  checkSessionAndLoad(): void {
    this.loading = true;
    this.error = '';

    this.http
      .get<any>('/microsegx/overview', { headers: this.getHeaders() })
      .subscribe({
        next: data => {
          this.session = data.zitiSession || null;
          this.overview = data.zitiOverview || null;
          this.loading = false;

          // Auto-login if credentials are configured but not logged in
          if (this.isConfigured && !this.isLoggedIn) {
            this.autoLogin();
          }
        },
        error: err => {
          this.error =
            err?.error?.message ||
            err?.message ||
            this.translate.instant('MICROSEGX.ZITI.LOAD_FAILED');
          this.loading = false;
        },
      });
  }

  autoLogin(): void {
    this.http
      .post('/microsegx/api/ziti/login', {}, { headers: this.getHeaders() })
      .subscribe({
        next: () => {
          this.refresh();
        },
        error: err => {
          // Auto-login failed, user may need to provide credentials manually
          console.error('Auto-login failed:', err);
        },
      });
  }

  get isLoggedIn(): boolean {
    return this.session?.logged_in || false;
  }

  get isConfigured(): boolean {
    return this.session?.default_credentials_configured || false;
  }

  get counts() {
    return this.overview?.counts || {};
  }

  getExpiresAt(): string {
    const expiresAt = this.session?.expires_at;
    if (!expiresAt) return '-';
    const date = new Date(expiresAt * 1000);
    return date.toLocaleString('yyyy-MM-dd HH:mm:ss');
  }

  refresh(): void {
    this.loading = true;
    this.http
      .get<any>('/microsegx/overview', { headers: this.getHeaders() })
      .subscribe({
        next: data => {
          this.session = data.zitiSession || null;
          this.overview = data.zitiOverview || null;
          this.loading = false;
        },
        error: err => {
          this.error =
            err?.error?.message ||
            err?.message ||
            this.translate.instant('MICROSEGX.ZITI.LOAD_FAILED');
          this.loading = false;
        },
      });
  }

  logout(): void {
    this.loading = true;
    this.http
      .post('/microsegx/api/ziti/logout', {}, { headers: this.getHeaders() })
      .subscribe({
        next: () => {
          this.session = null;
          this.overview = null;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
        },
      });
  }

  // Edge Router operations
  getEdgeRouters(): EdgeRouter[] {
    return this.overview?.edge_routers || [];
  }

  getRouterWorkload(routerId: string): any {
    return this.overview?.edge_router_workloads?.find(
      (w: any) => w.routerId === routerId || w.routerName === routerId
    );
  }

  openRouterDeployDialog(router?: EdgeRouter): void {
    this.selectedEntity = router || null;
    const workload = router ? this.getRouterWorkload(router.id) : null;

    this.routerDeployForm = {
      routerName: router?.name || '',
      publicHost: workload?.publicHost || '',
      nodePort: workload?.nodePort || null,
    };

    this.dialogError = '';
    this.showRouterDeployDialog = true;
  }

  closeRouterDeployDialog(): void {
    this.showRouterDeployDialog = false;
    this.selectedEntity = null;
    this.dialogLoading = false;
    this.dialogError = '';
  }

  deployRouter(): void {
    if (!this.routerDeployForm.routerName) {
      this.dialogError = this.translate.instant('MICROSEGX.REQUIRED_SHORT');
      return;
    }

    this.dialogLoading = true;
    this.dialogError = '';

    const body = {
      router_name: this.routerDeployForm.routerName,
      public_host: this.routerDeployForm.publicHost || undefined,
      node_port: this.routerDeployForm.nodePort || undefined,
    };

    this.http
      .post(
        `/microsegx/api/ziti/edge-routers/${this.routerDeployForm.routerName}/deploy-k8s`,
        body,
        { headers: this.getHeaders() }
      )
      .subscribe({
        next: () => {
          this.dialogLoading = false;
          this.closeRouterDeployDialog();
          this.refresh();
        },
        error: err => {
          this.dialogError =
            err?.error?.error ||
            this.translate.instant('MICROSEGX.ZITI.Routers.DEPLOY_FAILED');
          this.dialogLoading = false;
        },
      });
  }

  reenrollRouter(router: EdgeRouter): void {
    this.selectedEntity = router;
    this.dialogLoading = true;
    this.dialogError = '';

    this.http
      .post(
        `/microsegx/api/ziti/edge-routers/${router.id}/re-enroll`,
        {},
        { headers: this.getHeaders() }
      )
      .subscribe({
        next: () => {
          this.dialogLoading = false;
          this.refresh();
        },
        error: err => {
          this.dialogError =
            err?.error?.error ||
            this.translate.instant('MICROSEGX.ZITI.Routers.RE_ENROLL_FAILED');
          this.dialogLoading = false;
        },
      });
  }

  deleteRouterK8s(router: EdgeRouter): void {
    this.selectedEntity = router;
    this.selectedEntityType = 'edge-router-k8s';
    this.dialogError = '';
    this.showDeleteConfirm = true;
  }

  // Services operations
  getServices(): ZitiService[] {
    return this.overview?.services || [];
  }

  openCreateServiceDialog(): void {
    this.selectedEntityType = 'services';
    this.entityForm = {
      name: '',
      encryptionRequired: true,
      configs: [],
      roleAttributes: [],
    };
    this.dialogError = '';
    this.showCreateDialog = true;
  }

  openEditServiceDialog(service: ZitiService): void {
    this.selectedEntity = service;
    this.selectedEntityType = 'services';
    this.entityForm = {
      name: service.name,
      encryptionRequired: service.encryptionRequired ?? true,
      configs: service.configs || [],
      roleAttributes: service.roleAttributes || [],
    };
    this.dialogError = '';
    this.showEditDialog = true;
  }

  openDeleteServiceDialog(service: ZitiService): void {
    this.selectedEntity = service;
    this.selectedEntityType = 'services';
    this.dialogError = '';
    this.showDeleteConfirm = true;
  }

  // Identities operations
  getIdentities(): Identity[] {
    return this.overview?.identities || [];
  }

  openCreateIdentityDialog(): void {
    this.selectedEntityType = 'identities';
    this.entityForm = {
      name: '',
      type: 'Device',
      roleAttributes: [],
      isAdmin: false,
    };
    this.dialogError = '';
    this.showCreateDialog = true;
  }

  downloadIdentityJwt(identity: Identity): void {
    this.http
      .get(`/microsegx/api/ziti/identities/${identity.id}/client-jwt`, {
        headers: this.getHeaders(),
        responseType: 'text',
      })
      .subscribe({
        next: (jwt: string) => {
          const blob = new Blob([jwt], { type: 'application/json' });
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${identity.name}.jwt`;
          a.click();
          window.URL.revokeObjectURL(url);
        },
        error: err => {
          this.error = err?.error?.error || 'Failed to download JWT';
        },
      });
  }

  openDeleteIdentityDialog(identity: Identity): void {
    this.selectedEntity = identity;
    this.selectedEntityType = 'identities';
    this.dialogError = '';
    this.showDeleteConfirm = true;
  }

  // Configs operations
  getConfigs(): ZitiConfig[] {
    return this.overview?.configs || [];
  }

  openCreateConfigDialog(): void {
    this.selectedEntityType = 'configs';
    this.entityForm = {
      name: '',
      configTypeId: '',
      data: {},
    };
    this.dialogError = '';
    this.showCreateDialog = true;
  }

  openEditConfigDialog(config: ZitiConfig): void {
    this.selectedEntity = config;
    this.selectedEntityType = 'configs';
    this.entityForm = {
      name: config.name,
      configTypeId: config.configTypeId,
      data: config.data || {},
    };
    this.dialogError = '';
    this.showEditDialog = true;
  }

  openDeleteConfigDialog(config: ZitiConfig): void {
    this.selectedEntity = config;
    this.selectedEntityType = 'configs';
    this.dialogError = '';
    this.showDeleteConfirm = true;
  }

  // Policies operations
  getServicePolicies(): ServicePolicy[] {
    return this.overview?.service_policies || [];
  }

  getEdgeRouterPolicies(): EdgeRouterPolicy[] {
    return this.overview?.edge_router_policies || [];
  }

  getServiceEdgeRouterPolicies(): ServiceEdgeRouterPolicy[] {
    return this.overview?.service_edge_router_policies || [];
  }

  openCreatePolicyDialog(
    policyType:
      | 'service-policies'
      | 'edge-router-policies'
      | 'service-edge-router-policies'
  ): void {
    this.selectedEntityType = policyType;
    this.entityForm = {
      name: '',
      type: 'Dial',
      semantic: 'AnyOf',
      serviceRoles: [],
      identityRoles: [],
      edgeRouterRoles: [],
    };
    this.dialogError = '';
    this.showCreateDialog = true;
  }

  openDeletePolicyDialog(
    policy: ServicePolicy | EdgeRouterPolicy | ServiceEdgeRouterPolicy,
    policyType: string
  ): void {
    this.selectedEntity = policy;
    this.selectedEntityType = policyType;
    this.dialogError = '';
    this.showDeleteConfirm = true;
  }

  // Generic create/edit/delete
  createEntity(): void {
    if (!this.entityForm.name) {
      this.dialogError = this.translate.instant('MICROSEGX.REQUIRED_SHORT');
      return;
    }

    this.dialogLoading = true;
    this.dialogError = '';

    this.http
      .post(`/microsegx/api/ziti/${this.selectedEntityType}`, this.entityForm, {
        headers: this.getHeaders(),
      })
      .subscribe({
        next: () => {
          this.dialogLoading = false;
          this.closeCreateDialog();
          this.refresh();
        },
        error: err => {
          this.dialogError =
            err?.error?.error ||
            this.translate.instant('MICROSEGX.ZITI.ACTION_FAILED');
          this.dialogLoading = false;
        },
      });
  }

  updateEntity(): void {
    if (!this.selectedEntity) return;

    this.dialogLoading = true;
    this.dialogError = '';

    this.http
      .patch(
        `/microsegx/api/ziti/${this.selectedEntityType}/${this.selectedEntity.id}`,
        this.entityForm,
        { headers: this.getHeaders() }
      )
      .subscribe({
        next: () => {
          this.dialogLoading = false;
          this.closeEditDialog();
          this.refresh();
        },
        error: err => {
          this.dialogError =
            err?.error?.error ||
            this.translate.instant('MICROSEGX.ZITI.ACTION_FAILED');
          this.dialogLoading = false;
        },
      });
  }

  deleteEntity(): void {
    if (!this.selectedEntity) return;

    this.dialogLoading = true;
    this.dialogError = '';

    let endpoint = `/microsegx/api/ziti/${this.selectedEntityType}/${this.selectedEntity.id}`;

    // Special handling for K8s router deletion
    if (this.selectedEntityType === 'edge-router-k8s') {
      endpoint = `/microsegx/api/ziti/edge-routers/${this.selectedEntity.id}/deploy-k8s`;
    }

    this.http.delete(endpoint, { headers: this.getHeaders() }).subscribe({
      next: () => {
        this.dialogLoading = false;
        this.closeDeleteConfirm();
        this.refresh();
      },
      error: err => {
        this.dialogError =
          err?.error?.error ||
          this.translate.instant('MICROSEGX.ZITI.ACTION_FAILED');
        this.dialogLoading = false;
      },
    });
  }

  closeCreateDialog(): void {
    this.showCreateDialog = false;
    this.selectedEntity = null;
    this.selectedEntityType = '';
    this.entityForm = {};
    this.dialogLoading = false;
    this.dialogError = '';
  }

  closeEditDialog(): void {
    this.showEditDialog = false;
    this.selectedEntity = null;
    this.selectedEntityType = '';
    this.entityForm = {};
    this.dialogLoading = false;
    this.dialogError = '';
  }

  closeDeleteConfirm(): void {
    this.showDeleteConfirm = false;
    this.selectedEntity = null;
    this.selectedEntityType = '';
    this.dialogLoading = false;
    this.dialogError = '';
  }
}
