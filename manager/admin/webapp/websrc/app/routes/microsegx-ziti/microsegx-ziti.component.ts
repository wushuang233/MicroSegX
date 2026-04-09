import { AfterViewChecked, Component, OnDestroy, OnInit } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { TranslateService } from '@ngx-translate/core';
import { GlobalVariable } from '@common/variables/global.variable';

type ViewTab = 'routers' | 'services' | 'identities' | 'configs' | 'policies';
type PolicyType =
  | 'service-policies'
  | 'edge-router-policies'
  | 'service-edge-router-policies';
type EntityType =
  | 'edge-routers'
  | 'services'
  | 'identities'
  | 'configs'
  | PolicyType
  | 'edge-router-k8s';

interface ZitiEntity {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  isSystem?: boolean;
  tags?: Record<string, any>;
  [key: string]: any;
}

interface RouterWorkload {
  routerId?: string;
  routerName?: string;
  deploymentName?: string;
  available?: boolean;
  readyReplicas?: number;
  replicas?: number;
  nodePort?: number;
  servicePort?: number;
  publicHost?: string;
  advertisedPort?: number;
  serviceName?: string;
  tunnelEnabled?: boolean;
  tunnelMode?: string;
}

interface EdgeRouter extends ZitiEntity {
  isOnline?: boolean;
  hostname?: string;
  disabled?: boolean;
  noTraversal?: boolean;
  isTunnelerEnabled?: boolean;
  isVerified?: boolean;
  cost?: number;
  syncStatus?: string;
  supportedProtocols?: Record<string, string>;
  versionInfo?: {
    version?: string;
    os?: string;
    arch?: string;
  };
  roleAttributes?: string[];
  enrollmentJwt?: string;
  enrollmentExpiresAt?: string;
  k8sWorkload?: RouterWorkload;
}

interface ZitiService extends ZitiEntity {
  encryptionRequired?: boolean;
  configs?: string[];
  terminatorStrategy?: string;
  maxIdleTimeMillis?: number;
  roleAttributes?: string[];
}

interface ZitiTerminator extends ZitiEntity {
  binding?: string;
  address?: string;
  precedence?: string;
  service?: { id?: string; name?: string };
  router?: { id?: string; name?: string };
}

interface Identity extends ZitiEntity {
  type?: string;
  authPolicyId?: string;
  authPolicy?: { id?: string; name?: string };
  enrollment?: Record<string, any>;
  roleAttributes?: string[];
  isAdmin?: boolean;
  hasApiSession?: boolean;
  hasEdgeRouterConnection?: boolean;
  edgeRouterConnectionStatus?: string;
  externalId?: string;
  defaultHostingCost?: number;
  defaultHostingPrecedence?: string;
}

interface ZitiConfig extends ZitiEntity {
  configTypeId?: string;
  configType?: { name: string; id: string };
  data?: Record<string, any>;
}

interface ConfigType {
  id: string;
  name: string;
}

interface AuthPolicy {
  id: string;
  name: string;
}

interface PostureCheck {
  id: string;
  name: string;
}

interface Enrollment {
  id?: string;
  identityId?: string;
  method?: string;
  expiresAt?: string;
}

interface K8sServicePort {
  name?: string;
  protocol?: string;
  port?: number;
  target_port?: string;
}

interface K8sService {
  namespace?: string;
  name?: string;
  type?: string;
  cluster_ip?: string;
  fqdn?: string;
  ports?: K8sServicePort[];
}

interface ServicePolicy extends ZitiEntity {
  type?: 'Dial' | 'Bind';
  semantic?: 'AnyOf' | 'AllOf';
  postureCheckRoles?: string[];
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
  edge_router_workloads?: RouterWorkload[];
  services?: ZitiService[];
  identities?: Identity[];
  configs?: ZitiConfig[];
  config_types?: ConfigType[];
  service_policies?: ServicePolicy[];
  edge_router_policies?: EdgeRouterPolicy[];
  service_edge_router_policies?: ServiceEdgeRouterPolicy[];
  terminators?: ZitiTerminator[];
  posture_checks?: PostureCheck[];
  auth_policies?: AuthPolicy[];
  enrollments?: Enrollment[];
  k8s_services?: K8sService[];
  counts?: {
    edge_routers?: number;
    alive_edge_routers?: number;
    deployed_edge_routers?: number;
    services?: number;
    configs?: number;
    config_types?: number;
    identities?: number;
    service_policies?: number;
    edge_router_policies?: number;
    service_edge_router_policies?: number;
    posture_checks?: number;
    auth_policies?: number;
    enrollments?: number;
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

interface EntityFormState {
  name: string;
  type: string;
  semantic: string;
  configTypeId: string;
  k8sServiceRef: string;
  authPolicyId: string;
  updbUsername: string;
  externalId: string;
  defaultHostingCost: number;
  defaultHostingPrecedence: string;
  roleAttributesText: string;
  serviceRolesText: string;
  identityRolesText: string;
  edgeRouterRolesText: string;
  postureCheckRolesText: string;
  configs: string[];
  encryptionRequired: boolean;
  terminatorStrategy: string;
  maxIdleTime: string;
  dataJson: string;
  tagsJson: string;
  cost: number;
  disabled: boolean;
  noTraversal: boolean;
  isTunnelerEnabled: boolean;
  isAdmin: boolean;
}

interface QuickRoleOption {
  label: string;
  value: string;
}

@Component({
  standalone: false,
  selector: 'app-microsegx-ziti',
  templateUrl: './microsegx-ziti.component.html',
  styleUrls: ['./microsegx-ziti.component.scss'],
})
export class MicrosegxZitiComponent
  implements OnInit, AfterViewChecked, OnDestroy
{
  private static readonly DEFAULT_CONFIG_TYPE = 'Default';

  session: ZitiSession | null = null;
  overview: ZitiOverview | null = null;
  loading = false;
  error = '';
  searchText = '';
  routerStatusFilter = 'all';
  routerDeploymentFilter = 'all';
  serviceEncryptionFilter = 'all';
  identityEnrollmentFilter = 'all';
  identityTypeFilter = 'all';
  configTypeFilter = 'all';
  policySemanticFilter = 'all';

  activeTab: ViewTab = 'routers';
  selectedPolicyType: PolicyType = 'service-policies';

  showRouterDeployDialog = false;
  showServiceAttachDialog = false;
  showCreateDialog = false;
  showEditDialog = false;
  showDeleteConfirm = false;
  dialogLoading = false;
  dialogError = '';
  actionInProgress = '';

  selectedEntity: ZitiEntity | null = null;
  selectedEntityType: EntityType | '' = '';

  routerDeployForm = {
    publicHost: '',
    nodePort: null as number | null,
  };
  serviceAttachForm = {
    routerId: '',
    autoEnableRouter: true,
  };

  entityForm: EntityFormState = this.createEmptyEntityForm();
  private dialogBodyLocked = false;
  private overviewRevision = 0;
  private memoCache = new Map<string, { deps: string; value: unknown }>();
  private routerWorkloadById = new Map<string, RouterWorkload>();
  private routerWorkloadByName = new Map<string, RouterWorkload>();
  private configNameById = new Map<string, string>();
  private configById = new Map<string, ZitiConfig>();
  private configUsageCountById = new Map<string, number>();
  private serviceConfigNamesById = new Map<string, string[]>();
  private terminatorsByServiceId = new Map<string, ZitiTerminator[]>();
  private identityEnrollmentStateById = new Map<
    string,
    'enrolled' | 'pending' | 'none'
  >();
  private k8sServiceByRef = new Map<string, K8sService>();
  private configTypeNameByValue = new Map<string, string>();
  policyQuickAdd = {
    identity: '',
    service: '',
    router: '',
    postureCheck: '',
  };

  constructor(
    private http: HttpClient,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.checkSessionAndLoad();
  }

  ngAfterViewChecked(): void {
    this.syncDialogBodyState();
  }

  ngOnDestroy(): void {
    this.releaseDialogBodyState();
  }

  get activeTabIndex(): number {
    return ['routers', 'services', 'identities', 'configs', 'policies'].indexOf(
      this.activeTab
    );
  }

  set activeTabIndex(index: number) {
    const tabs: ViewTab[] = [
      'routers',
      'services',
      'identities',
      'configs',
      'policies',
    ];
    this.activeTab = tabs[index] || 'routers';
  }

  private getHeaders(): HttpHeaders {
    const token = GlobalVariable.nvToken || localStorage.getItem('token');
    return new HttpHeaders({
      Token: token || '',
      'Content-Type': 'application/json',
    });
  }

  private createEmptyEntityForm(): EntityFormState {
    return {
      name: '',
      type: 'Default',
      semantic: 'AnyOf',
      configTypeId: '',
      k8sServiceRef: '',
      authPolicyId: 'default',
      updbUsername: '',
      externalId: '',
      defaultHostingCost: 0,
      defaultHostingPrecedence: 'default',
      roleAttributesText: '',
      serviceRolesText: '',
      identityRolesText: '',
      edgeRouterRolesText: '',
      postureCheckRolesText: '',
      configs: [],
      encryptionRequired: true,
      terminatorStrategy: 'smartrouting',
      maxIdleTime: '',
      dataJson: '{\n  \n}',
      tagsJson: '{}',
      cost: 0,
      disabled: false,
      noTraversal: false,
      isTunnelerEnabled: false,
      isAdmin: false,
    };
  }

  private setEntityForm(patch: Partial<EntityFormState>): void {
    this.entityForm = {
      ...this.createEmptyEntityForm(),
      ...patch,
    };
  }

  checkSessionAndLoad(): void {
    this.loading = true;
    this.error = '';

    this.http
      .get<any>('/microsegx/overview', { headers: this.getHeaders() })
      .subscribe({
        next: data => {
          this.applyOverviewState(
            data.zitiSession || null,
            data.zitiOverview || null
          );
          this.loading = false;

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
          this.error =
            err?.error?.error ||
            this.translate.instant('MICROSEGX.ZITI.LOGIN_FAILED');
        },
      });
  }

  refresh(silent = false): void {
    if (!silent) {
      this.loading = true;
      this.error = '';
    }

    this.http
      .get<any>('/microsegx/overview', { headers: this.getHeaders() })
      .subscribe({
        next: data => {
          this.applyOverviewState(
            data.zitiSession || null,
            data.zitiOverview || null
          );
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
          this.applyOverviewState(null, null);
          this.loading = false;
        },
        error: () => {
          this.loading = false;
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

  get configTypes(): ConfigType[] {
    return this.memoize('configTypes', `${this.overviewRevision}`, () =>
      this.sortByName(this.overview?.config_types || [])
    );
  }

  get authPolicies(): AuthPolicy[] {
    return this.memoize('authPolicies', `${this.overviewRevision}`, () =>
      this.sortByName(this.overview?.auth_policies || [])
    );
  }

  get postureChecks(): PostureCheck[] {
    return this.memoize('postureChecks', `${this.overviewRevision}`, () =>
      this.sortByName(this.overview?.posture_checks || [])
    );
  }

  get k8sServices(): K8sService[] {
    return this.memoize('k8sServices', `${this.overviewRevision}`, () =>
      [...(this.overview?.k8s_services || [])].sort((left, right) =>
        `${left.namespace || 'default'}/${left.name || ''}`.localeCompare(
          `${right.namespace || 'default'}/${right.name || ''}`
        )
      )
    );
  }

  get filteredRouters(): EdgeRouter[] {
    return this.memoize(
      'filteredRouters',
      `${this.overviewRevision}|${this.searchText}|${this.routerStatusFilter}|${this.routerDeploymentFilter}`,
      () => {
        let items = this.filterItems(
          this.sortByName(this.overview?.edge_routers || []),
          item => [
            item.name,
            item.hostname,
            ...(item.roleAttributes || []),
            this.getRouterWorkload(item)?.deploymentName,
            this.getRouterWorkload(item)?.publicHost,
          ]
        );

        if (this.routerStatusFilter !== 'all') {
          items = items.filter(router =>
            this.routerStatusFilter === 'online'
              ? !!router.isOnline
              : !router.isOnline
          );
        }

        if (this.routerDeploymentFilter !== 'all') {
          items = items.filter(router =>
            this.routerDeploymentFilter === 'deployed'
              ? !!this.getRouterWorkload(router)
              : !this.getRouterWorkload(router)
          );
        }

        return items;
      }
    );
  }

  get filteredServices(): ZitiService[] {
    return this.memoize(
      'filteredServices',
      `${this.overviewRevision}|${this.searchText}|${this.serviceEncryptionFilter}`,
      () => {
        let items = this.filterItems(
          this.sortByName(this.overview?.services || []),
          item => [
            item.name,
            item.terminatorStrategy,
            ...(item.roleAttributes || []),
            ...this.getServiceConfigNames(item),
          ]
        );

        if (this.serviceEncryptionFilter !== 'all') {
          items = items.filter(service =>
            this.serviceEncryptionFilter === 'required'
              ? service.encryptionRequired !== false
              : service.encryptionRequired === false
          );
        }

        return items;
      }
    );
  }

  get availableConfigs(): ZitiConfig[] {
    return this.memoize('availableConfigs', `${this.overviewRevision}`, () =>
      this.sortByName(this.overview?.configs || [])
    );
  }

  get identityRoleQuickOptions(): QuickRoleOption[] {
    return this.memoize(
      'identityRoleQuickOptions',
      `${this.overviewRevision}|${this.getLanguageCacheKey()}`,
      () =>
        this.buildQuickRoleOptions(
          this.overview?.identities || [],
          identity => identity.name,
          identity => identity.roleAttributes || [],
          this.translate.instant('MICROSEGX.ZITI.IDENTITIES.TITLE')
        )
    );
  }

  get serviceRoleQuickOptions(): QuickRoleOption[] {
    return this.memoize(
      'serviceRoleQuickOptions',
      `${this.overviewRevision}|${this.getLanguageCacheKey()}`,
      () =>
        this.buildQuickRoleOptions(
          this.overview?.services || [],
          service => service.name,
          service => service.roleAttributes || [],
          this.translate.instant('MICROSEGX.ZITI.SERVICES.TITLE')
        )
    );
  }

  get routerRoleQuickOptions(): QuickRoleOption[] {
    return this.memoize(
      'routerRoleQuickOptions',
      `${this.overviewRevision}|${this.getLanguageCacheKey()}`,
      () =>
        this.buildQuickRoleOptions(
          this.overview?.edge_routers || [],
          router => router.name,
          router => router.roleAttributes || [],
          this.translate.instant('MICROSEGX.ZITI.Routers.TITLE')
        )
    );
  }

  get postureCheckQuickOptions(): QuickRoleOption[] {
    return this.memoize(
      'postureCheckQuickOptions',
      `${this.overviewRevision}|${this.getLanguageCacheKey()}`,
      () =>
        this.sortByName(this.overview?.posture_checks || []).map(check => ({
          label: `@${check.name} · ${this.translate.instant('MICROSEGX.ZITI.POSTURE_CHECKS')}`,
          value: `@${check.id || check.name}`,
        }))
    );
  }

  get filteredIdentities(): Identity[] {
    return this.memoize(
      'filteredIdentities',
      `${this.overviewRevision}|${this.searchText}|${this.identityEnrollmentFilter}|${this.identityTypeFilter}`,
      () => {
        let items = this.filterItems(
          this.sortByName(this.overview?.identities || []),
          item => [
            item.name,
            item.type,
            item.authPolicyId,
            ...(item.roleAttributes || []),
            item.externalId,
          ]
        );

        if (this.identityEnrollmentFilter !== 'all') {
          items = items.filter(
            identity =>
              this.getIdentityEnrollmentState(identity) ===
              this.identityEnrollmentFilter
          );
        }

        if (this.identityTypeFilter !== 'all') {
          items = items.filter(identity =>
            this.identityTypeFilter === 'admin'
              ? !!identity.isAdmin
              : (identity.type ||
                  MicrosegxZitiComponent.DEFAULT_CONFIG_TYPE) ===
                this.identityTypeFilter
          );
        }

        return items;
      }
    );
  }

  get filteredConfigs(): ZitiConfig[] {
    return this.memoize(
      'filteredConfigs',
      `${this.overviewRevision}|${this.searchText}|${this.configTypeFilter}`,
      () => {
        let items = this.filterItems(
          this.sortByName(this.overview?.configs || []),
          item => [
            item.name,
            item.configType?.name,
            item.configTypeId,
            this.previewConfigData(item),
          ]
        );

        if (this.configTypeFilter !== 'all') {
          items = items.filter(
            item =>
              this.getConfigTypeName(item) === this.configTypeFilter ||
              item.configTypeId === this.configTypeFilter
          );
        }

        return items;
      }
    );
  }

  get activePolicies():
    | ServicePolicy[]
    | EdgeRouterPolicy[]
    | ServiceEdgeRouterPolicy[] {
    return this.memoize(
      'activePolicies',
      `${this.overviewRevision}|${this.searchText}|${this.policySemanticFilter}|${this.selectedPolicyType}`,
      () => {
        if (this.selectedPolicyType === 'edge-router-policies') {
          let items = this.filterItems(
            this.sortByName(this.overview?.edge_router_policies || []),
            item => [
              item.name,
              ...(item.identityRoles || []),
              ...(item.edgeRouterRoles || []),
            ]
          );
          if (this.policySemanticFilter !== 'all') {
            items = items.filter(
              item => (item.semantic || 'AnyOf') === this.policySemanticFilter
            );
          }
          return items;
        }

        if (this.selectedPolicyType === 'service-edge-router-policies') {
          let items = this.filterItems(
            this.sortByName(this.overview?.service_edge_router_policies || []),
            item => [
              item.name,
              ...(item.serviceRoles || []),
              ...(item.edgeRouterRoles || []),
            ]
          );
          if (this.policySemanticFilter !== 'all') {
            items = items.filter(
              item => (item.semantic || 'AnyOf') === this.policySemanticFilter
            );
          }
          return items;
        }

        let items = this.filterItems(
          this.sortByName(this.overview?.service_policies || []),
          item => [
            item.name,
            item.type,
            ...(item.identityRoles || []),
            ...(item.serviceRoles || []),
            ...(item.postureCheckRoles || []),
          ]
        );
        if (this.policySemanticFilter !== 'all') {
          items = items.filter(
            item => (item.semantic || 'AnyOf') === this.policySemanticFilter
          );
        }
        return items;
      }
    );
  }

  get identityTypeOptions(): string[] {
    return this.memoize(
      'identityTypeOptions',
      `${this.overviewRevision}`,
      () => {
        const values = new Set(
          (this.overview?.identities || [])
            .map(identity =>
              String(
                identity.type || MicrosegxZitiComponent.DEFAULT_CONFIG_TYPE
              ).trim()
            )
            .filter(Boolean)
        );

        if (
          (this.overview?.identities || []).some(identity => identity.isAdmin)
        ) {
          values.add('admin');
        }

        return Array.from(values).sort((left, right) =>
          left.localeCompare(right)
        );
      }
    );
  }

  get configTypeNames(): string[] {
    return this.memoize('configTypeNames', `${this.overviewRevision}`, () => {
      const values = new Set(
        (this.overview?.configs || [])
          .map(config => this.getConfigTypeName(config))
          .filter(Boolean)
      );
      return Array.from(values).sort((left, right) =>
        left.localeCompare(right)
      );
    });
  }

  get currentConfigTypeName(): string {
    if (this.selectedEntityType !== 'configs') {
      return '';
    }

    if (this.showCreateDialog) {
      return this.resolveConfigTypeName(this.entityForm.configTypeId);
    }

    const selectedConfig = this.selectedEntity as ZitiConfig | null;
    return this.resolveConfigTypeName(
      selectedConfig?.configType?.name || selectedConfig?.configTypeId || ''
    );
  }

  get selectedK8sService(): K8sService | null {
    return this.k8sServiceByRef.get(this.entityForm.k8sServiceRef) || null;
  }

  get isConfigTemplateSupported(): boolean {
    return ['host.v1', 'intercept.v1'].includes(this.currentConfigTypeName);
  }

  getPolicyHelperDescriptionKey(): string {
    switch (this.selectedEntityType) {
      case 'service-policies':
        return 'MICROSEGX.ZITI.POLICIES.HELPER_DESC_SERVICE';
      case 'edge-router-policies':
        return 'MICROSEGX.ZITI.POLICIES.HELPER_DESC_EDGE_ROUTER';
      case 'service-edge-router-policies':
        return 'MICROSEGX.ZITI.POLICIES.HELPER_DESC_SERVICE_EDGE_ROUTER';
      default:
        return 'MICROSEGX.ZITI.POLICIES.CREATE_HINT';
    }
  }

  private filterItems<T>(
    items: T[],
    values: (item: T) => Array<string | undefined | null>
  ): T[] {
    const search = this.searchText.trim().toLowerCase();
    if (!search) {
      return items;
    }

    return items.filter(item =>
      values(item).some(value =>
        String(value || '')
          .toLowerCase()
          .includes(search)
      )
    );
  }

  private sortByName<T extends { name?: string; id?: string }>(
    items: T[]
  ): T[] {
    return [...items].sort((left, right) =>
      `${left.name || ''}${left.id || ''}`.localeCompare(
        `${right.name || ''}${right.id || ''}`
      )
    );
  }

  formatDate(value?: string | number): string {
    return this.formatDateTime(value);
  }

  getExpiresAt(): string {
    return this.formatDateTime(this.session?.expires_at);
  }

  formatDateTime(value?: string | number): string {
    if (!value) {
      return '-';
    }

    const date =
      typeof value === 'number'
        ? new Date(value > 1e12 ? value : value * 1000)
        : new Date(value);

    if (Number.isNaN(date.getTime())) {
      return '-';
    }

    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    const hours = `${date.getHours()}`.padStart(2, '0');
    const minutes = `${date.getMinutes()}`.padStart(2, '0');
    const seconds = `${date.getSeconds()}`.padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  getActiveTabDescriptionKey(): string {
    switch (this.activeTab) {
      case 'routers':
        return 'MICROSEGX.ZITI.Routers.CREATE_HINT';
      case 'services':
        return 'MICROSEGX.ZITI.SERVICES.CREATE_HINT';
      case 'identities':
        return 'MICROSEGX.ZITI.IDENTITIES.CREATE_HINT';
      case 'configs':
        return 'MICROSEGX.ZITI.CONFIGS.CREATE_HINT';
      default:
        return 'MICROSEGX.ZITI.POLICIES.CREATE_HINT';
    }
  }

  getActiveCreateLabelKey(): string {
    switch (this.activeTab) {
      case 'routers':
        return 'MICROSEGX.ZITI.Routers.CREATE_ROUTER';
      case 'services':
        return 'MICROSEGX.ZITI.SERVICES.CREATE_SERVICE';
      case 'identities':
        return 'MICROSEGX.ZITI.IDENTITIES.CREATE_IDENTITY';
      case 'configs':
        return 'MICROSEGX.ZITI.CONFIGS.CREATE_CONFIG';
      default:
        return 'MICROSEGX.ZITI.POLICIES.CREATE';
    }
  }

  openActiveCreateDialog(): void {
    switch (this.activeTab) {
      case 'routers':
        this.openCreateRouterDialog();
        return;
      case 'services':
        this.openCreateServiceDialog();
        return;
      case 'identities':
        this.openCreateIdentityDialog();
        return;
      case 'configs':
        this.openCreateConfigDialog();
        return;
      case 'policies':
        this.openCreatePolicyDialog(this.selectedPolicyType);
        return;
    }
  }

  getRouterEndpoint(router: EdgeRouter): string {
    const workload = this.getRouterWorkload(router);
    if (workload?.publicHost) {
      const port =
        workload.advertisedPort || workload.nodePort || workload.servicePort;
      return `${workload.publicHost}:${port || '-'}`;
    }

    const tlsAddress = router.supportedProtocols?.tls;
    if (tlsAddress) {
      return tlsAddress;
    }

    return router.hostname || '-';
  }

  getRouterVersion(router: EdgeRouter): string {
    return router.versionInfo?.version || '-';
  }

  getRouterWorkloadState(router: EdgeRouter): string {
    const workload = this.getRouterWorkload(router);
    if (!workload) {
      return '-';
    }

    return `${workload.readyReplicas || 0}/${workload.replicas || 0}`;
  }

  getRouterTunnelState(router: EdgeRouter): 'ready' | 'pending' | 'disabled' {
    const workload = this.getRouterWorkload(router);
    if (workload?.tunnelMode === 'host') {
      return 'ready';
    }
    if (router.isTunnelerEnabled) {
      return 'pending';
    }
    return 'disabled';
  }

  getRouterTunnelLabelKey(router: EdgeRouter): string {
    switch (this.getRouterTunnelState(router)) {
      case 'ready':
        return 'MICROSEGX.ZITI.Routers.TUNNEL_READY';
      case 'pending':
        return 'MICROSEGX.ZITI.Routers.TUNNEL_PENDING';
      default:
        return 'MICROSEGX.ZITI.Routers.TUNNEL_DISABLED';
    }
  }

  getRouterTunnelClass(router: EdgeRouter): string {
    switch (this.getRouterTunnelState(router)) {
      case 'ready':
        return 'status-online';
      case 'pending':
        return 'status-paused';
      default:
        return 'status-offline';
    }
  }

  getIdentityTypeLabel(identity: Identity): string {
    return identity.isAdmin
      ? this.translate.instant('MICROSEGX.ZITI.TYPE_ADMIN')
      : this.translate.instant('MICROSEGX.ZITI.TYPE_STANDARD');
  }

  getIdentityPolicyName(identity: Identity): string {
    return identity.authPolicy?.name || identity.authPolicyId || 'default';
  }

  getRouterWorkload(router: EdgeRouter): RouterWorkload | undefined {
    if (router.k8sWorkload) {
      return router.k8sWorkload;
    }

    return (
      this.routerWorkloadById.get(router.id) ||
      this.routerWorkloadByName.get(router.name)
    );
  }

  getRouterRoles(router: EdgeRouter): string {
    return this.listPreview(router.roleAttributes);
  }

  getRouterWorkloadLabel(router: EdgeRouter): string {
    const workload = this.getRouterWorkload(router);
    if (!workload) {
      return '-';
    }
    const host = workload.publicHost
      ? `${workload.publicHost}:${workload.advertisedPort || workload.nodePort || '-'}`
      : `${workload.readyReplicas || 0}/${workload.replicas || 0}`;
    return `${workload.deploymentName || workload.serviceName || router.name} · ${host}`;
  }

  getServiceConfigNames(service: ZitiService): string[] {
    return this.serviceConfigNamesById.get(service.id) || [];
  }

  getServiceTerminators(service: ZitiService): ZitiTerminator[] {
    return this.terminatorsByServiceId.get(service.id) || [];
  }

  getServiceTerminatorCount(service: ZitiService): number {
    return this.getServiceTerminators(service).length;
  }

  getServiceHostingConfig(service: ZitiService): ZitiConfig | null {
    for (const configId of service.configs || []) {
      const config = this.configById.get(configId);
      const type = this.getConfigTypeName(config || ({} as ZitiConfig));
      if (!config) {
        continue;
      }
      if (type === 'host.v1' || type === 'host.v2') {
        return config;
      }
    }
    return null;
  }

  getServiceHostingTarget(service: ZitiService): string {
    const config = this.getServiceHostingConfig(service);
    if (!config) {
      return '-';
    }

    const type = this.getConfigTypeName(config);
    const data = config.data || {};
    if (type === 'host.v1') {
      const address = String(data.address || '').trim();
      const port = data.port ?? '-';
      const protocol = String(data.protocol || 'tcp').toLowerCase();
      return [address || '-', `${protocol}/${port}`].join(' · ');
    }

    if (type === 'host.v2') {
      const terminators = Array.isArray(data.terminators)
        ? data.terminators
        : [];
      if (terminators.length === 0) {
        return 'host.v2';
      }
      const first = terminators[0] || {};
      const address = String(first.address || '').trim();
      const port = first.port ?? '-';
      const protocol = String(first.protocol || 'tcp').toLowerCase();
      const extra = terminators.length > 1 ? ` +${terminators.length - 1}` : '';
      return `${[address || '-', `${protocol}/${port}`].join(' · ')}${extra}`;
    }

    return type || '-';
  }

  getServiceHostedRouters(service: ZitiService): string[] {
    const names = new Set<string>();
    for (const terminator of this.getServiceTerminators(service)) {
      const routerName = String(terminator.router?.name || '').trim();
      if (routerName) {
        names.add(routerName);
      }
    }
    return Array.from(names).sort((left, right) => left.localeCompare(right));
  }

  getServiceHostingStatus(
    service: ZitiService
  ): 'router' | 'host' | 'pending' | 'missing' {
    const terminators = this.getServiceTerminators(service);
    if (terminators.some(terminator => terminator.binding === 'tunnel')) {
      return 'router';
    }
    if (terminators.length > 0) {
      return 'host';
    }
    if (this.getServiceHostingConfig(service)) {
      return 'pending';
    }
    return 'missing';
  }

  getServiceHostingStatusKey(service: ZitiService): string {
    switch (this.getServiceHostingStatus(service)) {
      case 'router':
        return 'MICROSEGX.ZITI.SERVICES.HOSTING_ROUTER';
      case 'host':
        return 'MICROSEGX.ZITI.SERVICES.HOSTING_IDENTITY';
      case 'pending':
        return 'MICROSEGX.ZITI.SERVICES.HOSTING_PENDING';
      default:
        return 'MICROSEGX.ZITI.SERVICES.HOSTING_MISSING';
    }
  }

  getServiceHostingStatusClass(service: ZitiService): string {
    switch (this.getServiceHostingStatus(service)) {
      case 'router':
      case 'host':
        return 'status-online';
      case 'pending':
        return 'status-paused';
      default:
        return 'status-offline';
    }
  }

  getServiceHostingDetail(service: ZitiService): string {
    const routers = this.getServiceHostedRouters(service);
    if (routers.length > 0) {
      return `${routers.join(', ')} · ${this.getServiceTerminatorCount(service)} terminator`;
    }
    const target = this.getServiceHostingTarget(service);
    return target || '-';
  }

  getConfigName(configId: string): string {
    return this.configNameById.get(configId) || configId;
  }

  getConfigUsageCount(config: ZitiConfig): number {
    return this.configUsageCountById.get(config.id) || 0;
  }

  previewConfigData(config: ZitiConfig): string {
    const data = config.data || {};
    const keys = Object.keys(data);
    if (keys.length === 0) {
      return '-';
    }
    return keys.slice(0, 3).join(', ');
  }

  getConfigTypeName(config: ZitiConfig): string {
    return this.resolveConfigTypeName(
      config.configType?.name || config.configTypeId || ''
    );
  }

  getIdentityEnrollmentState(
    identity: Identity
  ): 'enrolled' | 'pending' | 'none' {
    return this.identityEnrollmentStateById.get(identity.id) || 'none';
  }

  getPolicySummary(
    policy: ServicePolicy | EdgeRouterPolicy | ServiceEdgeRouterPolicy
  ): string {
    if (this.selectedPolicyType === 'edge-router-policies') {
      const edgeRouterPolicy = policy as EdgeRouterPolicy;
      return `${edgeRouterPolicy.semantic || 'AnyOf'} · ${
        (edgeRouterPolicy.identityRoles || []).length
      } identity / ${(edgeRouterPolicy.edgeRouterRoles || []).length} router`;
    }

    if (this.selectedPolicyType === 'service-edge-router-policies') {
      const serviceRouterPolicy = policy as ServiceEdgeRouterPolicy;
      return `${serviceRouterPolicy.semantic || 'AnyOf'} · ${
        (serviceRouterPolicy.serviceRoles || []).length
      } service / ${(serviceRouterPolicy.edgeRouterRoles || []).length} router`;
    }

    const servicePolicy = policy as ServicePolicy;
    return `${servicePolicy.type || 'Dial'} · ${servicePolicy.semantic || 'AnyOf'} · ${
      (servicePolicy.identityRoles || []).length
    } identity / ${(servicePolicy.serviceRoles || []).length} service`;
  }

  getPolicyMatches(
    policy: ServicePolicy | EdgeRouterPolicy | ServiceEdgeRouterPolicy
  ): string {
    if (this.selectedPolicyType === 'edge-router-policies') {
      const edgeRouterPolicy = policy as EdgeRouterPolicy;
      return this.listPreview([
        ...(edgeRouterPolicy.identityRoles || []),
        ...(edgeRouterPolicy.edgeRouterRoles || []),
      ]);
    }

    if (this.selectedPolicyType === 'service-edge-router-policies') {
      const serviceRouterPolicy = policy as ServiceEdgeRouterPolicy;
      return this.listPreview([
        ...(serviceRouterPolicy.serviceRoles || []),
        ...(serviceRouterPolicy.edgeRouterRoles || []),
      ]);
    }

    const servicePolicy = policy as ServicePolicy;
    return this.listPreview([
      ...(servicePolicy.identityRoles || []),
      ...(servicePolicy.serviceRoles || []),
      ...(servicePolicy.postureCheckRoles || []),
    ]);
  }

  listPreview(items?: string[], max = 3): string {
    const values = (items || []).filter(Boolean);
    if (values.length === 0) {
      return '-';
    }
    if (values.length <= max) {
      return values.join(', ');
    }
    return `${values.slice(0, max).join(', ')} +${values.length - max}`;
  }

  isEntityBusy(type: string, entityId: string): boolean {
    return this.actionInProgress === `${type}:${entityId}`;
  }

  private setEntityBusy(
    type: string,
    entityId: string | undefined | null
  ): void {
    this.actionInProgress = entityId ? `${type}:${entityId}` : '';
  }

  openCreateRouterDialog(): void {
    this.selectedEntity = null;
    this.selectedEntityType = 'edge-routers';
    this.setEntityForm({
      tagsJson: '{}',
    });
    this.dialogError = '';
    this.showCreateDialog = true;
  }

  openEditRouterDialog(router: EdgeRouter): void {
    this.selectedEntity = router;
    this.selectedEntityType = 'edge-routers';
    this.setEntityForm({
      name: router.name,
      cost: router.cost || 0,
      roleAttributesText: (router.roleAttributes || []).join(', '),
      disabled: !!router.disabled,
      noTraversal: !!router.noTraversal,
      isTunnelerEnabled: !!router.isTunnelerEnabled,
      tagsJson: this.stringifyJson(router.tags || {}),
    });
    this.dialogError = '';
    this.showEditDialog = true;
  }

  openDeleteRouterDialog(router: EdgeRouter): void {
    this.selectedEntity = router;
    this.selectedEntityType = 'edge-routers';
    this.dialogError = '';
    this.showDeleteConfirm = true;
  }

  openRouterDeployDialog(router: EdgeRouter): void {
    const workload = this.getRouterWorkload(router);
    this.selectedEntity = router;
    this.routerDeployForm = {
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
    this.routerDeployForm = {
      publicHost: '',
      nodePort: null,
    };
  }

  deployRouter(): void {
    if (!this.selectedEntity) {
      this.dialogError = this.translate.instant('MICROSEGX.ZITI.ACTION_FAILED');
      return;
    }

    this.dialogLoading = true;
    this.dialogError = '';

    const body = {
      publicHost: this.routerDeployForm.publicHost || undefined,
      nodePort: this.routerDeployForm.nodePort || undefined,
    };

    this.http
      .post(
        `/microsegx/api/ziti/edge-routers/${this.selectedEntity.id}/deploy-k8s`,
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
    this.setEntityBusy('router-reenroll', router.id);

    this.http
      .post(
        `/microsegx/api/ziti/edge-routers/${router.id}/re-enroll`,
        {},
        { headers: this.getHeaders() }
      )
      .subscribe({
        next: () => {
          this.setEntityBusy('', '');
          this.refresh();
        },
        error: err => {
          this.setEntityBusy('', '');
          this.error =
            err?.error?.error ||
            this.translate.instant('MICROSEGX.ZITI.Routers.RE_ENROLL_FAILED');
        },
      });
  }

  deleteRouterK8s(router: EdgeRouter): void {
    this.selectedEntity = router;
    this.selectedEntityType = 'edge-router-k8s';
    this.dialogError = '';
    this.showDeleteConfirm = true;
  }

  openCreateServiceDialog(): void {
    this.selectedEntity = null;
    this.selectedEntityType = 'services';
    this.setEntityForm({
      encryptionRequired: true,
      tagsJson: '{}',
    });
    this.dialogError = '';
    this.showCreateDialog = true;
  }

  openEditServiceDialog(service: ZitiService): void {
    this.selectedEntity = service;
    this.selectedEntityType = 'services';
    this.setEntityForm({
      name: service.name,
      encryptionRequired: service.encryptionRequired ?? true,
      configs: [...(service.configs || [])],
      roleAttributesText: (service.roleAttributes || []).join(', '),
      terminatorStrategy: service.terminatorStrategy || 'smartrouting',
      maxIdleTime:
        service.maxIdleTimeMillis && service.maxIdleTimeMillis > 0
          ? `${service.maxIdleTimeMillis}ms`
          : '',
      tagsJson: this.stringifyJson(service.tags || {}),
    });
    this.dialogError = '';
    this.showEditDialog = true;
  }

  openDeleteServiceDialog(service: ZitiService): void {
    this.selectedEntity = service;
    this.selectedEntityType = 'services';
    this.dialogError = '';
    this.showDeleteConfirm = true;
  }

  get attachableRouters(): EdgeRouter[] {
    return this.memoize('attachableRouters', `${this.overviewRevision}`, () =>
      this.sortByName(this.overview?.edge_routers || [])
    );
  }

  get selectedAttachRouter(): EdgeRouter | null {
    return (
      this.attachableRouters.find(
        router => router.id === this.serviceAttachForm.routerId
      ) || null
    );
  }

  get selectedServiceEntity(): ZitiService | null {
    if (this.selectedEntityType !== 'services' || !this.selectedEntity) {
      return null;
    }
    return this.selectedEntity as ZitiService;
  }

  getSelectedAttachServiceTarget(): string {
    return this.selectedServiceEntity
      ? this.getServiceHostingTarget(this.selectedServiceEntity)
      : '-';
  }

  getSelectedAttachServiceConfigName(): string {
    return this.selectedServiceEntity
      ? this.getServiceHostingConfig(this.selectedServiceEntity)?.name || '-'
      : '-';
  }

  getSelectedAttachServiceStatusKey(): string {
    return this.selectedServiceEntity
      ? this.getServiceHostingStatusKey(this.selectedServiceEntity)
      : 'MICROSEGX.ZITI.SERVICES.HOSTING_MISSING';
  }

  canAttachServiceToRouter(service: ZitiService): boolean {
    return (
      !!this.getServiceHostingConfig(service) &&
      this.attachableRouters.length > 0
    );
  }

  openAttachServiceDialog(service: ZitiService): void {
    this.selectedEntity = service;
    this.selectedEntityType = 'services';
    this.serviceAttachForm = {
      routerId: this.attachableRouters[0]?.id || '',
      autoEnableRouter: true,
    };
    this.dialogError = '';
    this.showServiceAttachDialog = true;
  }

  closeServiceAttachDialog(): void {
    this.showServiceAttachDialog = false;
    this.selectedEntity = null;
    this.selectedEntityType = '';
    this.dialogLoading = false;
    this.dialogError = '';
    this.serviceAttachForm = {
      routerId: '',
      autoEnableRouter: true,
    };
  }

  attachServiceToRouter(): void {
    if (!this.selectedEntity) {
      this.dialogError = this.translate.instant('MICROSEGX.ZITI.ACTION_FAILED');
      return;
    }
    if (!this.serviceAttachForm.routerId) {
      this.dialogError = this.translate.instant(
        'MICROSEGX.ZITI.SERVICES.ATTACH_ROUTER_REQUIRED'
      );
      return;
    }

    this.dialogLoading = true;
    this.dialogError = '';

    this.http
      .post(
        `/microsegx/api/ziti/services/${this.selectedEntity.id}/attach-router`,
        {
          routerId: this.serviceAttachForm.routerId,
          autoEnableRouter: this.serviceAttachForm.autoEnableRouter,
          waitTimeoutSeconds: 20,
        },
        { headers: this.getHeaders() }
      )
      .subscribe({
        next: (response: any) => {
          this.dialogLoading = false;
          this.applyAttachRouterResult(response?.data || null);
          this.closeServiceAttachDialog();
          this.refresh(true);
        },
        error: err => {
          this.dialogError =
            err?.error?.error ||
            this.translate.instant(
              'MICROSEGX.ZITI.SERVICES.ATTACH_ROUTER_FAILED'
            );
          this.dialogLoading = false;
        },
      });
  }

  openCreateIdentityDialog(): void {
    this.selectedEntity = null;
    this.selectedEntityType = 'identities';
    this.setEntityForm({
      type: 'Default',
      authPolicyId: this.authPolicies[0]?.id || 'default',
      tagsJson: '{}',
    });
    this.dialogError = '';
    this.showCreateDialog = true;
  }

  openEditIdentityDialog(identity: Identity): void {
    this.selectedEntity = identity;
    this.selectedEntityType = 'identities';
    this.setEntityForm({
      name: identity.name,
      type: identity.type || 'Default',
      authPolicyId:
        identity.authPolicyId || this.authPolicies[0]?.id || 'default',
      roleAttributesText: (identity.roleAttributes || []).join(', '),
      externalId: identity.externalId || '',
      isAdmin: !!identity.isAdmin,
      defaultHostingCost: identity.defaultHostingCost || 0,
      defaultHostingPrecedence: identity.defaultHostingPrecedence || 'default',
      tagsJson: this.stringifyJson(identity.tags || {}),
    });
    this.dialogError = '';
    this.showEditDialog = true;
  }

  requestIdentityJwt(identity: Identity, rotate = false): void {
    this.setEntityBusy(
      rotate ? 'identity-jwt-rotate' : 'identity-jwt',
      identity.id
    );
    this.http
      .post<any>(
        `/microsegx/api/ziti/identities/${identity.id}/client-jwt`,
        {
          rotate,
          durationMinutes: 30,
        },
        { headers: this.getHeaders() }
      )
      .subscribe({
        next: response => {
          this.setEntityBusy('', '');
          const jwt = response?.data?.enrollment?.jwt || '';
          if (!jwt) {
            this.error = this.translate.instant('MICROSEGX.ZITI.JWT_FAILED');
            return;
          }
          this.downloadText(`${identity.name}.jwt`, jwt);
          this.refresh();
        },
        error: err => {
          this.setEntityBusy('', '');
          this.error =
            err?.error?.error ||
            this.translate.instant('MICROSEGX.ZITI.JWT_FAILED');
        },
      });
  }

  openDeleteIdentityDialog(identity: Identity): void {
    this.selectedEntity = identity;
    this.selectedEntityType = 'identities';
    this.dialogError = '';
    this.showDeleteConfirm = true;
  }

  openCreateConfigDialog(): void {
    const defaultTypeId = this.configTypes[0]?.id || '';
    this.selectedEntity = null;
    this.selectedEntityType = 'configs';
    this.setEntityForm({
      configTypeId: defaultTypeId,
      dataJson: this.stringifyJson(
        this.defaultConfigData(this.resolveConfigTypeName(defaultTypeId))
      ),
      tagsJson: '{}',
    });
    this.dialogError = '';
    this.showCreateDialog = true;
  }

  openEditConfigDialog(config: ZitiConfig): void {
    this.selectedEntity = config;
    this.selectedEntityType = 'configs';
    this.setEntityForm({
      name: config.name,
      configTypeId: config.configTypeId || '',
      dataJson: this.stringifyJson(config.data || {}),
      tagsJson: this.stringifyJson(config.tags || {}),
    });
    this.dialogError = '';
    this.showEditDialog = true;
  }

  openDeleteConfigDialog(config: ZitiConfig): void {
    this.selectedEntity = config;
    this.selectedEntityType = 'configs';
    this.dialogError = '';
    this.showDeleteConfirm = true;
  }

  openCreatePolicyDialog(policyType: PolicyType): void {
    this.selectedEntity = null;
    this.selectedEntityType = policyType;
    this.setEntityForm({
      type: 'Dial',
      semantic: 'AnyOf',
      tagsJson: '{}',
    });
    this.resetPolicyQuickAdd();
    this.dialogError = '';
    this.showCreateDialog = true;
  }

  openEditPolicyDialog(
    policy: ServicePolicy | EdgeRouterPolicy | ServiceEdgeRouterPolicy,
    policyType: PolicyType
  ): void {
    this.selectedEntity = policy;
    this.selectedEntityType = policyType;
    this.setEntityForm({
      name: policy.name,
      type: (policy as ServicePolicy).type || 'Dial',
      semantic: policy.semantic || 'AnyOf',
      identityRolesText: (
        (policy as ServicePolicy | EdgeRouterPolicy).identityRoles || []
      ).join(', '),
      serviceRolesText: (
        (policy as ServicePolicy | ServiceEdgeRouterPolicy).serviceRoles || []
      ).join(', '),
      edgeRouterRolesText: (
        (policy as EdgeRouterPolicy | ServiceEdgeRouterPolicy)
          .edgeRouterRoles || []
      ).join(', '),
      postureCheckRolesText: (
        (policy as ServicePolicy).postureCheckRoles || []
      ).join(', '),
      tagsJson: this.stringifyJson(policy.tags || {}),
    });
    this.resetPolicyQuickAdd();
    this.dialogError = '';
    this.showEditDialog = true;
  }

  openDeletePolicyDialog(
    policy: ServicePolicy | EdgeRouterPolicy | ServiceEdgeRouterPolicy,
    policyType: PolicyType
  ): void {
    if (this.isSystemManagedEntity(policy)) {
      this.dialogError = this.translate.instant(
        'MICROSEGX.ZITI.DELETE_SYSTEM_DENIED'
      );
      return;
    }
    this.selectedEntity = policy;
    this.selectedEntityType = policyType;
    this.dialogError = '';
    this.showDeleteConfirm = true;
  }

  createEntity(): void {
    this.submitEntity('create');
  }

  updateEntity(): void {
    this.submitEntity('edit');
  }

  private submitEntity(mode: 'create' | 'edit'): void {
    if (mode === 'edit' && !this.selectedEntity) {
      return;
    }

    let payload: Record<string, any>;
    try {
      payload = this.buildEntityPayload(mode === 'create');
    } catch (error: any) {
      this.dialogError =
        error?.message ||
        this.translate.instant('MICROSEGX.ZITI.ACTION_FAILED');
      return;
    }

    this.dialogLoading = true;
    this.dialogError = '';

    const request =
      mode === 'create'
        ? this.http.post(
            `/microsegx/api/ziti/${this.selectedEntityType}`,
            payload,
            {
              headers: this.getHeaders(),
            }
          )
        : this.http.patch(
            `/microsegx/api/ziti/${this.selectedEntityType}/${this.selectedEntity?.id}`,
            payload,
            { headers: this.getHeaders() }
          );

    request.subscribe({
      next: () => {
        this.dialogLoading = false;
        if (mode === 'create') {
          this.closeCreateDialog();
        } else {
          this.closeEditDialog();
        }
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
    if (!this.selectedEntity) {
      return;
    }

    if (this.isSystemManagedEntity(this.selectedEntity)) {
      this.dialogLoading = false;
      this.dialogError = this.translate.instant(
        'MICROSEGX.ZITI.DELETE_SYSTEM_DENIED'
      );
      return;
    }

    this.dialogLoading = true;
    this.dialogError = '';

    const endpoint =
      this.selectedEntityType === 'edge-router-k8s'
        ? `/microsegx/api/ziti/edge-routers/${this.selectedEntity.id}/deploy-k8s`
        : `/microsegx/api/ziti/${this.selectedEntityType}/${this.selectedEntity.id}`;

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

  private buildEntityPayload(isCreate: boolean): Record<string, any> {
    const form = this.entityForm;
    const name = form.name.trim();
    if (!name) {
      throw new Error(this.translate.instant('general.REQUIRED_SHORT'));
    }

    const tags = this.parseJson(form.tagsJson, 'Tags JSON');

    switch (this.selectedEntityType) {
      case 'edge-routers':
        return {
          name,
          cost: this.toNumber(form.cost, 0),
          disabled: !!form.disabled,
          noTraversal: !!form.noTraversal,
          isTunnelerEnabled: !!form.isTunnelerEnabled,
          roleAttributes: this.parseList(form.roleAttributesText),
          tags,
        };
      case 'services': {
        const payload: Record<string, any> = {
          name,
          configs: [...form.configs],
          roleAttributes: this.parseList(form.roleAttributesText),
          terminatorStrategy: form.terminatorStrategy.trim() || 'smartrouting',
          tags,
        };
        if (isCreate) {
          payload.encryptionRequired = !!form.encryptionRequired;
        }
        if (form.maxIdleTime.trim()) {
          payload.maxIdleTime = form.maxIdleTime.trim();
        }
        return payload;
      }
      case 'identities': {
        const payload: Record<string, any> = {
          name,
          authPolicyId: form.authPolicyId.trim() || 'default',
          roleAttributes: this.parseList(form.roleAttributesText),
          externalId: form.externalId.trim(),
          isAdmin: !!form.isAdmin,
          defaultHostingCost: this.toNumber(form.defaultHostingCost, 0),
          defaultHostingPrecedence:
            form.defaultHostingPrecedence.trim() || 'default',
          tags,
        };
        if (isCreate) {
          payload.type = form.type.trim() || 'Default';
          if (form.updbUsername.trim()) {
            payload.updbUsername = form.updbUsername.trim();
          }
        }
        return payload;
      }
      case 'configs': {
        const payload: Record<string, any> = {
          name,
          data: this.parseJson(form.dataJson, 'Config JSON'),
          tags,
        };
        if (isCreate) {
          payload.configTypeId = form.configTypeId;
        }
        return payload;
      }
      case 'service-policies':
        return {
          name,
          ...(isCreate ? { type: form.type || 'Dial' } : {}),
          semantic: form.semantic || 'AnyOf',
          identityRoles: this.parseList(form.identityRolesText),
          serviceRoles: this.parseList(form.serviceRolesText),
          postureCheckRoles: this.parseList(form.postureCheckRolesText),
          tags,
        };
      case 'edge-router-policies':
        return {
          name,
          semantic: form.semantic || 'AnyOf',
          identityRoles: this.parseList(form.identityRolesText),
          edgeRouterRoles: this.parseList(form.edgeRouterRolesText),
          tags,
        };
      case 'service-edge-router-policies':
        return {
          name,
          semantic: form.semantic || 'AnyOf',
          serviceRoles: this.parseList(form.serviceRolesText),
          edgeRouterRoles: this.parseList(form.edgeRouterRolesText),
          tags,
        };
      default:
        throw new Error(this.translate.instant('MICROSEGX.ZITI.ACTION_FAILED'));
    }
  }

  private parseList(value: string): string[] {
    return value
      .split(/[\n,]/)
      .map(item => item.trim())
      .filter(Boolean);
  }

  private parseJson(text: string, fieldLabel: string): Record<string, any> {
    const source = text.trim();
    if (!source) {
      return {};
    }

    try {
      const parsed = JSON.parse(source);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, any>;
      }
    } catch (_error) {
      // handled below
    }

    throw new Error(
      `${fieldLabel} ${this.translate.instant('MICROSEGX.ZITI.JSON_INVALID')}`
    );
  }

  private stringifyJson(value: Record<string, any>): string {
    return JSON.stringify(value || {}, null, 2);
  }

  private toNumber(value: any, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  onConfigTypeChanged(): void {
    if (!this.showCreateDialog || this.selectedEntityType !== 'configs') {
      return;
    }

    if (this.entityForm.k8sServiceRef && this.isConfigTemplateSupported) {
      this.applySelectedK8sServiceTemplate();
      return;
    }

    this.entityForm = {
      ...this.entityForm,
      dataJson: this.stringifyJson(
        this.defaultConfigData(this.currentConfigTypeName)
      ),
    };
  }

  onConfigK8sServiceChange(): void {
    if (this.selectedEntityType !== 'configs') {
      return;
    }

    const service = this.selectedK8sService;
    if (!service) {
      return;
    }

    if (!this.entityForm.name.trim()) {
      this.entityForm = {
        ...this.entityForm,
        name: `${service.name || 'service'}-${this.currentConfigTypeName || 'config'}`.replace(
          /\./g,
          '-'
        ),
      };
    }

    if (this.showCreateDialog && this.isConfigTemplateSupported) {
      this.applySelectedK8sServiceTemplate();
    }
  }

  appendQuickRole(
    field:
      | 'identityRolesText'
      | 'serviceRolesText'
      | 'edgeRouterRolesText'
      | 'postureCheckRolesText',
    value: string,
    selectionKey: 'identity' | 'service' | 'router' | 'postureCheck'
  ): void {
    const expression = String(value || '').trim();
    if (!expression) {
      return;
    }

    const existing = this.parseList(this.entityForm[field]);
    if (!existing.includes(expression)) {
      existing.push(expression);
    }

    this.entityForm = {
      ...this.entityForm,
      [field]: existing.join(', '),
    };
    this.policyQuickAdd = {
      ...this.policyQuickAdd,
      [selectionKey]: '',
    };
  }

  getK8sServiceRef(service: K8sService): string {
    return `${service.namespace || 'default'}/${service.name || ''}`;
  }

  getK8sServiceLabel(service: K8sService): string {
    const namespace = service.namespace || 'default';
    const type = service.type || 'ClusterIP';
    return `${namespace}/${service.name || '-'} · ${type}`;
  }

  getK8sServiceSummary(service?: K8sService | null): string {
    if (!service) {
      return '-';
    }

    const address =
      service.fqdn ||
      this.composeK8sServiceAddress(service) ||
      service.cluster_ip ||
      '-';
    const ports = (service.ports || [])
      .map(
        port =>
          `${port.protocol || 'tcp'}/${port.port || '-'}` +
          (port.name ? ` (${port.name})` : '')
      )
      .join(', ');
    return [address, ports].filter(Boolean).join(' · ');
  }

  applySelectedK8sServiceTemplate(): void {
    const service = this.selectedK8sService;
    if (!service) {
      return;
    }

    const port = this.getPreferredK8sPort(service);
    const protocol =
      String(port?.protocol || 'tcp').toLowerCase() === 'udp' ? 'udp' : 'tcp';
    const typeName = this.currentConfigTypeName;
    let data = this.defaultConfigData(typeName);

    if (typeName === 'host.v1') {
      data = {
        address: this.composeK8sServiceAddress(service),
        port: port?.port || 80,
        protocol,
      };
    } else if (typeName === 'intercept.v1') {
      data = {
        addresses: [
          `${service.name || 'service'}.${service.namespace || 'default'}.ziti`,
        ],
        portRanges: [
          {
            low: port?.port || 80,
            high: port?.port || 80,
          },
        ],
        protocols: [protocol],
      };
    }

    this.entityForm = {
      ...this.entityForm,
      dataJson: this.stringifyJson(data),
    };
  }

  private composeK8sServiceAddress(service: K8sService): string {
    const serviceName = String(service.name || '').trim();
    const namespace =
      String(service.namespace || 'default').trim() || 'default';
    if (!serviceName) {
      return '';
    }
    return `${serviceName}.${namespace}.svc.cluster.local`;
  }

  private getPreferredK8sPort(service: K8sService): K8sServicePort | null {
    return (service.ports || [])[0] || null;
  }

  private defaultConfigData(typeName: string): Record<string, any> {
    if (typeName === 'host.v1') {
      return {
        address: '',
        port: 80,
        protocol: 'tcp',
      };
    }

    if (typeName === 'intercept.v1') {
      return {
        addresses: [''],
        portRanges: [
          {
            low: 80,
            high: 80,
          },
        ],
        protocols: ['tcp'],
      };
    }

    if (typeName === 'host.v2') {
      return {
        terminators: [
          {
            address: '',
            port: 80,
            protocol: 'tcp',
          },
        ],
      };
    }

    return {};
  }

  private resolveConfigTypeName(typeIdOrName: string): string {
    const value = String(typeIdOrName || '').trim();
    if (!value) {
      return '';
    }

    return this.configTypeNameByValue.get(value) || value;
  }

  private buildQuickRoleOptions<
    T extends { id?: string; name?: string; roleAttributes?: string[] },
  >(
    items: T[],
    getName: (item: T) => string | undefined,
    getRoleAttributes: (item: T) => string[] | undefined,
    suffixLabel: string
  ): QuickRoleOption[] {
    const options = new Map<string, QuickRoleOption>();

    for (const item of this.sortByName(items as Array<T & { id?: string }>)) {
      const name = String(getName(item) || '').trim();
      if (name) {
        const exactMatchId = String(item.id || '').trim();
        options.set(`@${name}`, {
          label: `@${name} · ${suffixLabel}`,
          value: `@${exactMatchId || name}`,
        });
      }

      for (const role of getRoleAttributes(item) || []) {
        const normalized = String(role || '').trim();
        if (!normalized) {
          continue;
        }
        options.set(`#${normalized}`, {
          label: `#${normalized} · ${this.translate.instant('MICROSEGX.ZITI.POLICIES.ROLE_ATTRIBUTE')}`,
          value: `#${normalized}`,
        });
      }
    }

    return Array.from(options.values()).sort((left, right) =>
      left.label.localeCompare(right.label)
    );
  }

  private resetPolicyQuickAdd(): void {
    this.policyQuickAdd = {
      identity: '',
      service: '',
      router: '',
      postureCheck: '',
    };
  }

  private syncDialogBodyState(): void {
    if (typeof document === 'undefined') {
      return;
    }

    const shouldLock =
      this.showRouterDeployDialog ||
      this.showServiceAttachDialog ||
      this.showCreateDialog ||
      this.showEditDialog ||
      this.showDeleteConfirm;

    if (shouldLock === this.dialogBodyLocked) {
      return;
    }

    document.body.classList.toggle('microsegx-dialog-open', shouldLock);
    this.dialogBodyLocked = shouldLock;
  }

  private releaseDialogBodyState(): void {
    if (typeof document === 'undefined') {
      return;
    }

    if (this.dialogBodyLocked) {
      document.body.classList.remove('microsegx-dialog-open');
      this.dialogBodyLocked = false;
    }
  }

  private downloadText(fileName: string, content: string): void {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    window.URL.revokeObjectURL(url);
  }

  getEntityDialogTitleKey(mode: 'create' | 'edit'): string {
    switch (this.selectedEntityType) {
      case 'edge-routers':
        return mode === 'create'
          ? 'MICROSEGX.ZITI.Routers.CREATE_ROUTER'
          : 'MICROSEGX.ZITI.Routers.EDIT_ROUTER';
      case 'services':
        return mode === 'create'
          ? 'MICROSEGX.ZITI.SERVICES.CREATE_SERVICE'
          : 'MICROSEGX.ZITI.SERVICES.EDIT_SERVICE';
      case 'identities':
        return mode === 'create'
          ? 'MICROSEGX.ZITI.IDENTITIES.CREATE_IDENTITY'
          : 'MICROSEGX.ZITI.IDENTITIES.EDIT_IDENTITY';
      case 'configs':
        return mode === 'create'
          ? 'MICROSEGX.ZITI.CONFIGS.CREATE_CONFIG'
          : 'MICROSEGX.ZITI.CONFIGS.EDIT_CONFIG';
      case 'service-policies':
      case 'edge-router-policies':
      case 'service-edge-router-policies':
        return mode === 'create'
          ? 'MICROSEGX.ZITI.POLICIES.CREATE'
          : 'MICROSEGX.ZITI.POLICIES.EDIT';
      default:
        return 'MICROSEGX.ZITI.CREATE_ENTITY';
    }
  }

  getActivePolicyTitleKey(): string {
    switch (this.selectedPolicyType) {
      case 'edge-router-policies':
        return 'MICROSEGX.ZITI.POLICIES.EDGE_ROUTER_POLICIES';
      case 'service-edge-router-policies':
        return 'MICROSEGX.ZITI.POLICIES.SERVICE_EDGE_ROUTER_POLICIES';
      default:
        return 'MICROSEGX.ZITI.POLICIES.SERVICE_POLICIES';
    }
  }

  isSystemManagedEntity(entity: ZitiEntity | null | undefined): boolean {
    return !!entity?.isSystem;
  }

  getDeleteTooltip(entity: ZitiEntity | null | undefined): string {
    return this.translate.instant(
      this.isSystemManagedEntity(entity)
        ? 'MICROSEGX.ZITI.DELETE_SYSTEM_DENIED'
        : 'MICROSEGX.ZITI.DELETE_ENTITY'
    );
  }

  closeCreateDialog(): void {
    this.showCreateDialog = false;
    this.selectedEntity = null;
    this.selectedEntityType = '';
    this.entityForm = this.createEmptyEntityForm();
    this.resetPolicyQuickAdd();
    this.dialogLoading = false;
    this.dialogError = '';
  }

  closeEditDialog(): void {
    this.showEditDialog = false;
    this.selectedEntity = null;
    this.selectedEntityType = '';
    this.entityForm = this.createEmptyEntityForm();
    this.resetPolicyQuickAdd();
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

  private applyOverviewState(
    session: ZitiSession | null,
    overview: ZitiOverview | null
  ): void {
    this.session = session;
    this.overview = overview;
    this.overviewRevision += 1;
    this.memoCache.clear();
    this.rebuildOverviewLookups();
  }

  private applyAttachRouterResult(payload: any): void {
    if (!this.overview || !payload || typeof payload !== 'object') {
      return;
    }

    const edgeRouters = [...(this.overview.edge_routers || [])];
    const edgeRouterWorkloads = [
      ...(this.overview.edge_router_workloads || []),
    ];
    const identities = [...(this.overview.identities || [])];
    const servicePolicies = [...(this.overview.service_policies || [])];
    const edgeRouterPolicies = [...(this.overview.edge_router_policies || [])];
    const serviceEdgeRouterPolicies = [
      ...(this.overview.service_edge_router_policies || []),
    ];
    const terminators = [...(this.overview.terminators || [])];

    const nextOverview: ZitiOverview = {
      ...this.overview,
      edge_routers: edgeRouters,
      edge_router_workloads: edgeRouterWorkloads,
      identities,
      service_policies: servicePolicies,
      edge_router_policies: edgeRouterPolicies,
      service_edge_router_policies: serviceEdgeRouterPolicies,
      terminators,
    };

    this.replaceEntityInCollection(edgeRouters, payload.router);
    this.replaceRouterWorkload(edgeRouterWorkloads, payload.routerWorkload);
    this.replaceEntityInCollection(identities, payload.routerIdentity);
    this.replaceEntityInCollection(servicePolicies, payload.bindPolicy);
    this.replaceEntityInCollection(
      edgeRouterPolicies,
      payload.edgeRouterPolicy
    );
    this.replaceEntityInCollection(
      serviceEdgeRouterPolicies,
      payload.serviceEdgeRouterPolicy
    );
    this.replaceTerminator(terminators, payload.terminator);

    this.applyOverviewState(this.session, nextOverview);
  }

  private replaceEntityInCollection<T extends { id?: string; name?: string }>(
    collection: T[],
    entity: T | null | undefined
  ): void {
    if (!entity || (!entity.id && !entity.name)) {
      return;
    }

    const entityId = String(entity.id || '').trim();
    const entityName = String(entity.name || '').trim();
    const index = collection.findIndex(item => {
      const itemId = String(item?.id || '').trim();
      const itemName = String(item?.name || '').trim();
      return (
        (!!entityId && itemId === entityId) ||
        (!!entityName && itemName === entityName)
      );
    });

    if (index >= 0) {
      collection[index] = entity;
      return;
    }

    collection.push(entity);
  }

  private replaceRouterWorkload(
    collection: RouterWorkload[],
    workload: RouterWorkload | null | undefined
  ): void {
    if (!workload) {
      return;
    }

    const routerId = String(workload.routerId || '').trim();
    const routerName = String(workload.routerName || '').trim();
    const index = collection.findIndex(item => {
      const itemRouterId = String(item?.routerId || '').trim();
      const itemRouterName = String(item?.routerName || '').trim();
      return (
        (!!routerId && itemRouterId === routerId) ||
        (!!routerName && itemRouterName === routerName)
      );
    });

    if (index >= 0) {
      collection[index] = workload;
      return;
    }

    collection.push(workload);
  }

  private replaceTerminator(
    collection: ZitiTerminator[],
    terminator: ZitiTerminator | null | undefined
  ): void {
    if (!terminator || !terminator.id) {
      return;
    }

    const index = collection.findIndex(item => item?.id === terminator.id);
    if (index >= 0) {
      collection[index] = terminator;
      return;
    }

    collection.push(terminator);
  }

  private rebuildOverviewLookups(): void {
    this.routerWorkloadById.clear();
    this.routerWorkloadByName.clear();
    this.configNameById.clear();
    this.configById.clear();
    this.configUsageCountById.clear();
    this.serviceConfigNamesById.clear();
    this.terminatorsByServiceId.clear();
    this.identityEnrollmentStateById.clear();
    this.k8sServiceByRef.clear();
    this.configTypeNameByValue.clear();

    const overview = this.overview;
    if (!overview) {
      return;
    }

    for (const workload of overview.edge_router_workloads || []) {
      if (workload.routerId) {
        this.routerWorkloadById.set(workload.routerId, workload);
      }
      if (workload.routerName) {
        this.routerWorkloadByName.set(workload.routerName, workload);
      }
    }

    for (const configType of overview.config_types || []) {
      const name = String(configType.name || '').trim();
      const id = String(configType.id || '').trim();
      if (name) {
        this.configTypeNameByValue.set(name, name);
      }
      if (id) {
        this.configTypeNameByValue.set(id, name || id);
      }
    }

    for (const config of overview.configs || []) {
      this.configNameById.set(config.id, config.name || config.id);
      this.configById.set(config.id, config);
      this.configUsageCountById.set(config.id, 0);
    }

    for (const service of overview.services || []) {
      const configNames = (service.configs || []).map(
        configId => this.configNameById.get(configId) || configId
      );
      this.serviceConfigNamesById.set(service.id, configNames);

      for (const configId of service.configs || []) {
        this.configUsageCountById.set(
          configId,
          (this.configUsageCountById.get(configId) || 0) + 1
        );
      }
    }

    const pendingOttIdentityIds = new Set(
      (overview.enrollments || [])
        .filter(
          enrollment =>
            !!enrollment.identityId &&
            String(enrollment.method || '').toLowerCase() === 'ott'
        )
        .map(enrollment => String(enrollment.identityId))
    );

    for (const identity of overview.identities || []) {
      let state: 'enrolled' | 'pending' | 'none' = 'none';
      if (identity.hasEdgeRouterConnection || identity.hasApiSession) {
        state = 'enrolled';
      } else if (
        (!!identity.enrollment &&
          Object.keys(identity.enrollment).length > 0) ||
        pendingOttIdentityIds.has(identity.id)
      ) {
        state = 'pending';
      }
      this.identityEnrollmentStateById.set(identity.id, state);
    }

    for (const terminator of overview.terminators || []) {
      const serviceId = String(terminator.service?.id || '').trim();
      if (!serviceId) {
        continue;
      }
      const items = this.terminatorsByServiceId.get(serviceId) || [];
      items.push(terminator);
      this.terminatorsByServiceId.set(serviceId, items);
    }

    for (const service of overview.k8s_services || []) {
      this.k8sServiceByRef.set(this.getK8sServiceRef(service), service);
    }
  }

  private getLanguageCacheKey(): string {
    return this.translate.currentLang || this.translate.getDefaultLang() || '';
  }

  private memoize<T>(key: string, deps: string, compute: () => T): T {
    const cached = this.memoCache.get(key);
    if (cached && cached.deps === deps) {
      return cached.value as T;
    }

    const value = compute();
    this.memoCache.set(key, { deps, value });
    return value;
  }
}
