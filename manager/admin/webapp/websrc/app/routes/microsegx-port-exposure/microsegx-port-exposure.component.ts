import { AfterViewChecked, Component, OnDestroy, OnInit } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { TranslateService } from '@ngx-translate/core';
import { GlobalVariable } from '@common/variables/global.variable';

interface PortItem {
  key: string;
  protocol: string;
  port_name: string;
  service_port: number;
  target_port: string;
  public: boolean;
  public_type: string;
  public_port: number | null;
  node_port: number | null;
  effective_public_port: number | null;
}

interface PortRuntimeEvidence {
  items: ExposureItem[];
  openItems: ExposureItem[];
  listenerObserved: boolean;
  trafficObserved: boolean;
  publishedObserved: boolean;
}

interface ServiceControlItem {
  namespace: string;
  service_name: string;
  selector: Record<string, string>;
  service_type: string;
  public_service_type: string;
  node_port_range: string;
  public_service_name: string;
  manageable: boolean;
  disabled_reason: string | null;
  open_port_count: number;
  ports: PortItem[];
}

interface ServiceControls {
  enabled: boolean;
  public_service_type: string;
  node_port_range: string;
  service_count: number;
  open_port_count: number;
  items: ServiceControlItem[];
  error?: string;
}

interface ExposureItem {
  namespace: string;
  resource_kind: string;
  resource_name: string;
  group_name?: string;
  service_type?: string;
  exposure_type?: string;
  platform_role?: string | null;
  platform_roles?: string[];
  address: string;
  port: number;
  status: string;
  traffic_observed: boolean;
  listener_observed: boolean;
  latency_ms?: number;
  node_name?: string;
  port_name?: string | null;
  target_port?: string | null;
}

interface NodeInventoryAddress {
  address: string;
  address_type?: string | null;
}

interface NodeInventoryItem {
  name: string;
  addresses: NodeInventoryAddress[];
}

interface NodeExposureAddressSummary {
  address: string;
  addressType: string;
  items: ExposureItem[];
}

interface NodeExposureSummary {
  name: string;
  totalOpenCount: number;
  businessCount: number;
  platformCount: number;
  nodeCount: number;
  addresses: NodeExposureAddressSummary[];
}

interface ServiceCreatePortForm {
  name: string;
  protocol: 'TCP';
  servicePort: number | null;
  targetPort: string;
  nodePort: number | null;
}

interface ServiceCreateForm {
  namespace: string;
  serviceName: string;
  serviceType: 'ClusterIP' | 'NodePort' | 'LoadBalancer';
  selectorText: string;
  ports: ServiceCreatePortForm[];
}

type ServiceScope = 'all' | 'business' | 'platform';
type ExposureScope = 'all' | 'manageable' | 'platform' | 'node';
type ServiceRuntimeFilter =
  | 'all'
  | 'public'
  | 'listener'
  | 'traffic'
  | 'mismatch';

interface DashboardData {
  generated_at?: string;
  cluster?: {
    local_node_name: string;
    kubernetes_version: string;
  };
  external_exposure_summary?: {
    items: ExposureItem[];
    node_inventory?: NodeInventoryItem[];
    summary?: {
      item_count: number;
      resource_count: number;
      namespace_count: number;
      unique_address_count: number;
      open_count: number;
      traffic_observed_count: number;
    };
  };
  scan_state?: {
    scan_in_progress: boolean;
  };
  service_controls?: ServiceControls;
}

@Component({
  standalone: false,
  selector: 'app-microsegx-port-exposure',
  templateUrl: './microsegx-port-exposure.component.html',
  styleUrls: ['./microsegx-port-exposure.component.scss'],
})
export class MicrosegxPortExposureComponent
  implements OnInit, AfterViewChecked, OnDestroy
{
  private readonly autoRefreshIntervalMs = 8000;
  private readonly platformNamespaces = new Set([
    'cert-manager',
    'kube-system',
    'kube-public',
    'kube-node-lease',
    'local-path-storage',
    'microsegx',
    'openziti',
    'port-audit',
  ]);
  dashboard: DashboardData | null = null;
  loading = false;
  error = '';
  scanInProgress = false;

  statusFilter = 'all';
  typeFilter = 'all';
  searchText = '';
  serviceStateFilter = 'all';
  serviceRuntimeFilter: ServiceRuntimeFilter = 'all';
  servicePublishTypeFilter = 'all';
  servicePortScopeFilter = 'all';
  serviceScopeFilter: ServiceScope = 'all';
  exposureScopeFilter: ExposureScope = 'all';

  selectedService: ServiceControlItem | null = null;
  selectedPort: PortItem | null = null;
  showPortDialog = false;
  showServiceCreateDialog = false;
  showServiceDeleteDialog = false;
  portDialogMode: 'open' | 'close' = 'open';
  requestedNodePort: number | null = null;
  portDialogLoading = false;
  portDialogError = '';
  serviceCreateLoading = false;
  serviceCreateError = '';
  serviceDeleteLoading = false;
  serviceDeleteError = '';
  serviceToDelete: ServiceControlItem | null = null;
  serviceCreateForm: ServiceCreateForm = this.createEmptyServiceCreateForm();

  usedNodePorts: Set<number> = new Set();

  exposureColumns = [
    'namespace',
    'scope',
    'resource',
    'type',
    'address',
    'port',
    'status',
    'traffic',
  ];

  serviceColumns = [
    'namespace',
    'scope',
    'service',
    'state',
    'runtime',
    'ports',
    'actions',
  ];

  exposureTypes: string[] = [];
  viewMode: 'exposure' | 'services' = 'exposure';
  auxiliaryWorkspaceTab: 'summary' | 'ziti' = 'summary';
  private dialogBodyLocked = false;
  private autoRefreshTimer: number | null = null;
  private scanStatusTimer: number | null = null;
  private refreshInFlight = false;
  private readonly portRuntimeMap = new Map<string, PortRuntimeEvidence>();
  private nodeExposureSummariesCache: NodeExposureSummary[] = [];
  private readonly handleVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && !document.hidden) {
      this.triggerAutoRefresh(true);
    }
  };
  private readonly handleWindowFocus = (): void => {
    this.triggerAutoRefresh(true);
  };

  constructor(
    private http: HttpClient,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.setViewMode('exposure');
    this.refresh();
    this.startAutoRefresh();
  }

  ngAfterViewChecked(): void {
    this.syncDialogBodyState();
  }

  ngOnDestroy(): void {
    this.stopAutoRefresh();
    this.clearScanStatusTimer();
    this.releaseDialogBodyState();
  }

  setViewMode(nextMode: 'exposure' | 'services'): void {
    this.viewMode = nextMode;

    if (nextMode !== 'services') {
      this.closeServiceCreateDialog();
      this.closeServiceDeleteDialog();
    }
  }

  setAuxiliaryWorkspaceTab(nextTab: 'summary' | 'ziti'): void {
    this.auxiliaryWorkspaceTab = nextTab;
  }

  private getHeaders(): HttpHeaders {
    const token = GlobalVariable.nvToken || localStorage.getItem('token');
    return new HttpHeaders({
      Token: token || '',
      'Content-Type': 'application/json',
    });
  }

  refresh(silent = false): void {
    if (this.refreshInFlight) {
      return;
    }

    if (!silent) {
      this.loading = true;
      this.error = '';
    }
    this.refreshInFlight = true;

    this.http
      .get<DashboardData>('/microsegx/api/dashboard', {
        headers: this.getHeaders(),
      })
      .subscribe({
        next: data => {
          this.dashboard = data;
          this.scanInProgress = data.scan_state?.scan_in_progress || false;
          this.error = '';
          this.loading = false;
          this.refreshInFlight = false;
          this.rebuildDerivedState();
        },
        error: err => {
          if (!silent || !this.dashboard) {
            this.error =
              err?.error?.message ||
              err?.message ||
              this.translate.instant('MICROSEGX.LOAD_FAILED');
          }
          this.loading = false;
          this.refreshInFlight = false;
        },
      });
  }

  private rebuildDerivedState(): void {
    this.updateExposureTypes();
    this.updateUsedNodePorts();
    this.updatePortRuntimeMap();
    this.updateNodeExposureSummaries();
  }

  private updateExposureTypes(): void {
    const items = this.dashboard?.external_exposure_summary?.items || [];
    const types = new Set(
      items
        .map(item => (item.exposure_type || '').trim())
        .filter((type): type is string => !!type)
    );
    this.exposureTypes = Array.from(types).sort((left, right) =>
      left.localeCompare(right)
    );
  }

  private updateUsedNodePorts(): void {
    const ports = new Set<number>();
    const items = this.dashboard?.service_controls?.items || [];
    for (const service of items) {
      for (const port of service.ports) {
        if (port.node_port && port.public) {
          ports.add(port.node_port);
        }
      }
    }

    const exposures = this.dashboard?.external_exposure_summary?.items || [];
    for (const exposure of exposures) {
      if (exposure.port >= 30000 && exposure.port <= 32767) {
        ports.add(exposure.port);
      }
    }

    this.usedNodePorts = ports;
  }

  private updatePortRuntimeMap(): void {
    this.portRuntimeMap.clear();

    for (const service of this.allServiceControlItems) {
      for (const port of service.ports || []) {
        const key = this.getServicePortEvidenceKey(
          service.namespace,
          service.service_name,
          port
        );
        const items = this.findMatchingExposureItems(service, port);
        const openItems = items.filter(item => item.status === 'open');
        this.portRuntimeMap.set(key, {
          items,
          openItems,
          listenerObserved: openItems.some(item => item.listener_observed),
          trafficObserved: openItems.some(item => item.traffic_observed),
          publishedObserved: openItems.length > 0,
        });
      }
    }
  }

  private updateNodeExposureSummaries(): void {
    const nodeInventory =
      this.dashboard?.external_exposure_summary?.node_inventory || [];
    const openItems = this.allExposureItems.filter(
      item => item.status === 'open'
    );
    const addressIndex = new Map<string, ExposureItem[]>();

    for (const item of openItems) {
      const address = String(item.address || '').trim();
      if (!address) {
        continue;
      }

      const current = addressIndex.get(address) || [];
      current.push(item);
      addressIndex.set(address, current);
    }

    this.nodeExposureSummariesCache = nodeInventory
      .map(node => {
        const addresses = (node.addresses || [])
          .map(addressInfo => {
            const items = [
              ...(addressIndex.get(addressInfo.address) || []),
            ].sort(
              (left, right) =>
                left.port - right.port ||
                `${left.namespace}/${left.resource_name}`.localeCompare(
                  `${right.namespace}/${right.resource_name}`
                )
            );
            return {
              address: addressInfo.address,
              addressType: addressInfo.address_type || '',
              items,
            };
          })
          .filter(addressInfo => addressInfo.items.length > 0);

        const nodeItems = addresses.flatMap(addressInfo => addressInfo.items);
        return {
          name: node.name,
          totalOpenCount: nodeItems.length,
          businessCount: nodeItems.filter(
            item => this.getExposureScope(item) === 'manageable'
          ).length,
          platformCount: nodeItems.filter(
            item => this.getExposureScope(item) === 'platform'
          ).length,
          nodeCount: nodeItems.filter(
            item => this.getExposureScope(item) === 'node'
          ).length,
          addresses,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  triggerScan(): void {
    this.scanInProgress = true;
    this.http
      .post('/microsegx/api/scan', {}, { headers: this.getHeaders() })
      .subscribe({
        next: () => this.pollScanStatus(),
        error: () => {
          this.error = this.translate.instant('MICROSEGX.SCAN_FAILED');
          this.scanInProgress = false;
        },
      });
  }

  private pollScanStatus(): void {
    this.clearScanStatusTimer();
    this.scanStatusTimer = window.setTimeout(() => {
      this.scanStatusTimer = null;
      this.http
        .get<DashboardData>('/microsegx/api/dashboard', {
          headers: this.getHeaders(),
        })
        .subscribe({
          next: data => {
            if (data.scan_state?.scan_in_progress) {
              this.pollScanStatus();
              return;
            }
            this.scanInProgress = false;
            this.refresh(true);
          },
          error: () => {
            this.scanInProgress = false;
          },
        });
    }, 2000);
  }

  private startAutoRefresh(): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.stopAutoRefresh();
    this.autoRefreshTimer = window.setInterval(() => {
      this.triggerAutoRefresh();
    }, this.autoRefreshIntervalMs);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('focus', this.handleWindowFocus);
  }

  private stopAutoRefresh(): void {
    if (this.autoRefreshTimer !== null) {
      window.clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
    document.removeEventListener(
      'visibilitychange',
      this.handleVisibilityChange
    );
    window.removeEventListener('focus', this.handleWindowFocus);
  }

  private clearScanStatusTimer(): void {
    if (this.scanStatusTimer !== null) {
      window.clearTimeout(this.scanStatusTimer);
      this.scanStatusTimer = null;
    }
  }

  private triggerAutoRefresh(force = false): void {
    if (!force && !this.shouldAutoRefresh()) {
      return;
    }
    if (force && this.refreshInFlight) {
      return;
    }
    this.refresh(true);
  }

  private shouldAutoRefresh(): boolean {
    return (
      typeof document !== 'undefined' &&
      !document.hidden &&
      !this.loading &&
      !this.refreshInFlight &&
      !this.scanInProgress &&
      !this.portDialogLoading &&
      !this.serviceCreateLoading &&
      !this.serviceDeleteLoading &&
      !this.hasOpenDialog()
    );
  }

  get exposureItems(): ExposureItem[] {
    let items = [...this.allExposureItems];

    if (this.exposureScopeFilter !== 'all') {
      items = items.filter(
        item => this.getExposureScope(item) === this.exposureScopeFilter
      );
    }

    if (this.statusFilter !== 'all') {
      items = items.filter(item => item.status === this.statusFilter);
    }

    if (this.typeFilter !== 'all') {
      items = items.filter(item => item.exposure_type === this.typeFilter);
    }

    if (this.searchText.trim()) {
      const search = this.searchText.trim().toLowerCase();
      items = items.filter(
        item =>
          item.namespace?.toLowerCase().includes(search) ||
          item.resource_name?.toLowerCase().includes(search) ||
          item.resource_kind?.toLowerCase().includes(search) ||
          item.address?.toLowerCase().includes(search) ||
          String(item.port || '').includes(search)
      );
    }

    return items.sort((left, right) => {
      const leftScore = left.status === 'open' ? 0 : 1;
      const rightScore = right.status === 'open' ? 0 : 1;
      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }
      return `${left.namespace}/${left.resource_name}`.localeCompare(
        `${right.namespace}/${right.resource_name}`
      );
    });
  }

  get serviceControls(): ServiceControlItem[] {
    let items = [...this.allServiceControlItems];

    if (this.serviceScopeFilter !== 'all') {
      items = items.filter(
        item => this.getServiceScope(item) === this.serviceScopeFilter
      );
    }

    if (this.serviceStateFilter !== 'all') {
      items = items.filter(
        item => this.getServiceStateKey(item) === this.serviceStateFilter
      );
    }

    if (this.serviceRuntimeFilter !== 'all') {
      items = items.filter(item => this.matchesServiceRuntimeFilter(item));
    }

    if (this.servicePublishTypeFilter !== 'all') {
      items = items.filter(
        item => item.public_service_type === this.servicePublishTypeFilter
      );
    }

    if (this.servicePortScopeFilter !== 'all') {
      items = items.filter(item => {
        switch (this.servicePortScopeFilter) {
          case 'public':
            return item.open_port_count > 0;
          case 'nodeport':
            return item.ports.some(
              port => port.public && port.public_type === 'NodePort'
            );
          case 'private':
            return item.open_port_count === 0;
          default:
            return true;
        }
      });
    }

    if (this.searchText.trim()) {
      const search = this.searchText.trim().toLowerCase();
      items = items.filter(item =>
        this.getServiceSearchTokens(item).some(token => token.includes(search))
      );
    }

    return items.sort((left, right) =>
      `${left.namespace}/${left.service_name}`.localeCompare(
        `${right.namespace}/${right.service_name}`
      )
    );
  }

  get servicePublishTypes(): string[] {
    const types = new Set(
      (this.dashboard?.service_controls?.items || [])
        .map(item => String(item.public_service_type || '').trim())
        .filter(Boolean)
    );
    return Array.from(types).sort((left, right) => left.localeCompare(right));
  }

  get summary() {
    return this.dashboard?.external_exposure_summary?.summary;
  }

  get manageableServiceCount(): number {
    return this.allServiceControlItems.length;
  }

  get manageableOpenPortCount(): number {
    return this.allServiceControlItems.reduce(
      (total, item) => total + (+item.open_port_count || 0),
      0
    );
  }

  get infrastructureExposurePortCount(): number {
    return this.allExposureItems.filter(
      item =>
        this.getExposureScope(item) === 'platform' && item.status === 'open'
    ).length;
  }

  get nodeListenerPortCount(): number {
    return this.allExposureItems.filter(
      item => this.getExposureScope(item) === 'node' && item.status === 'open'
    ).length;
  }

  get clusterInfo() {
    return this.dashboard?.cluster;
  }

  get generatedAt(): string {
    return this.dashboard?.generated_at || '-';
  }

  formatDateTime(value?: string | number): string {
    if (!value || value === '-') {
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

  get serviceControlsEnabled(): boolean {
    return this.dashboard?.service_controls?.enabled || false;
  }

  get managedServiceCount(): number {
    return this.dashboard?.service_controls?.service_count || 0;
  }

  get nodeExposureSummaries(): NodeExposureSummary[] {
    return this.nodeExposureSummariesCache;
  }

  get visiblePublishedServicePortCount(): number {
    return this.serviceControls.reduce(
      (total, item) => total + this.getServicePublishedPortCount(item),
      0
    );
  }

  get visibleListenerServicePortCount(): number {
    return this.serviceControls.reduce(
      (total, item) => total + this.getServiceListenerPortCount(item),
      0
    );
  }

  get visibleTrafficServicePortCount(): number {
    return this.serviceControls.reduce(
      (total, item) => total + this.getServiceTrafficPortCount(item),
      0
    );
  }

  get visibleMismatchServicePortCount(): number {
    return this.serviceControls.reduce(
      (total, item) => total + this.getServiceMismatchPortCount(item),
      0
    );
  }

  get openPortCount(): number {
    return (
      this.dashboard?.service_controls?.open_port_count ||
      this.summary?.open_count ||
      0
    );
  }

  get trafficEvidenceCount(): number {
    return this.summary?.traffic_observed_count || 0;
  }

  get exposedObjectCount(): number {
    return this.summary?.resource_count || 0;
  }

  get recordCount(): number {
    return this.summary?.item_count || 0;
  }

  get namespaceCount(): number {
    return this.summary?.namespace_count || 0;
  }

  get uniqueAddressCount(): number {
    return this.summary?.unique_address_count || 0;
  }

  get currentInventoryCount(): number {
    return this.viewMode === 'services'
      ? this.serviceControls.length
      : this.exposureItems.length;
  }

  get nodePortRange(): { start: number; end: number } {
    const range =
      this.dashboard?.service_controls?.node_port_range || '30000-32767';
    const [start, end] = range.split('-').map(value => parseInt(value, 10));
    return {
      start: start || 30000,
      end: end || 32767,
    };
  }

  isK8sSystemNamespace(namespace: string): boolean {
    return this.isPlatformNamespace(namespace);
  }

  getServiceScope(item: ServiceControlItem): 'business' | 'platform' {
    return this.isPlatformNamespace(item.namespace) ? 'platform' : 'business';
  }

  getServiceScopeLabelKey(item: ServiceControlItem): string {
    return this.getServiceScope(item) === 'platform'
      ? 'MICROSEGX.PORT_EXPOSURE.SCOPE_PLATFORM'
      : 'MICROSEGX.PORT_EXPOSURE.SCOPE_BUSINESS';
  }

  getExposureScope(item: ExposureItem): 'manageable' | 'platform' | 'node' {
    const namespace = String(item.namespace || '').trim();
    const resourceKind = String(item.resource_kind || '')
      .trim()
      .toLowerCase();
    const exposureType = String(item.exposure_type || '')
      .trim()
      .toLowerCase();

    if (
      namespace === '-' ||
      resourceKind === 'node' ||
      exposureType === 'nodelistener'
    ) {
      return 'node';
    }

    if (this.isManageableExposure(item)) {
      return 'manageable';
    }

    if (resourceKind === 'service') {
      return 'platform';
    }

    if (this.isPlatformNamespace(namespace) || Boolean(item.platform_role)) {
      return 'platform';
    }

    return 'manageable';
  }

  getExposureScopeLabelKey(item: ExposureItem): string {
    switch (this.getExposureScope(item)) {
      case 'node':
        return 'MICROSEGX.PORT_EXPOSURE.SCOPE_NODE';
      case 'manageable':
        return 'MICROSEGX.PORT_EXPOSURE.SCOPE_MANAGEABLE';
      case 'platform':
        return 'MICROSEGX.PORT_EXPOSURE.SCOPE_PLATFORM';
      default:
        return 'MICROSEGX.PORT_EXPOSURE.SCOPE_MANAGEABLE';
    }
  }

  getServiceStateKey(item: ServiceControlItem): 'open' | 'secured' | 'blocked' {
    if (!item.manageable) {
      return 'blocked';
    }
    return item.open_port_count > 0 ? 'open' : 'secured';
  }

  getServiceStateLabelKey(item: ServiceControlItem): string {
    const state = this.getServiceStateKey(item);
    if (state === 'blocked') {
      return 'MICROSEGX.PORT_EXPOSURE.CONTROL_BLOCKED';
    }
    return state === 'open'
      ? 'MICROSEGX.PORT_EXPOSURE.STATUS_OPEN'
      : 'MICROSEGX.PORT_EXPOSURE.STATUS_CLOSED';
  }

  getStatusClass(item: ExposureItem): string {
    if (item.status === 'open') {
      if (item.traffic_observed) {
        return 'status-warning';
      }
      if (item.listener_observed) {
        return 'status-info';
      }
      return 'status-open';
    }

    return 'status-closed';
  }

  getServiceStateClass(item: ServiceControlItem): string {
    if (this.getServiceStateKey(item) === 'blocked') {
      return 'state-blocked';
    }
    return item.open_port_count > 0 ? 'state-open' : 'state-secured';
  }

  getServicePublishedPortCount(item: ServiceControlItem): number {
    return item.ports.filter(port => port.public).length;
  }

  getServiceListenerPortCount(item: ServiceControlItem): number {
    return item.ports.filter(port => {
      const runtime = this.getPortRuntimeState(item, port);
      return runtime === 'listener' || runtime === 'traffic';
    }).length;
  }

  getServiceTrafficPortCount(item: ServiceControlItem): number {
    return item.ports.filter(
      port => this.getPortRuntimeState(item, port) === 'traffic'
    ).length;
  }

  getServiceMismatchPortCount(item: ServiceControlItem): number {
    return item.ports.filter(port => {
      const runtime = this.getPortRuntimeState(item, port);
      return runtime === 'published' || runtime === 'unobserved';
    }).length;
  }

  getPublicPortDisplay(port: PortItem): string {
    if (!port.public) {
      return '-';
    }
    if (port.public_type === 'NodePort') {
      return port.node_port?.toString() || '-';
    }
    return (
      port.effective_public_port?.toString() ||
      port.public_port?.toString() ||
      '-'
    );
  }

  getTrafficClass(item: ExposureItem): string {
    if (item.traffic_observed) {
      return 'traffic-observed';
    }
    if (item.listener_observed) {
      return 'traffic-listener';
    }
    return 'traffic-none';
  }

  getPortRuntimeState(
    service: ServiceControlItem,
    port: PortItem
  ): 'private' | 'traffic' | 'listener' | 'published' | 'unobserved' {
    if (!port.public) {
      return 'private';
    }

    const evidence = this.getPortRuntimeEvidence(service, port);
    if (evidence.trafficObserved) {
      return 'traffic';
    }
    if (evidence.listenerObserved) {
      return 'listener';
    }
    if (evidence.publishedObserved) {
      return 'published';
    }
    return 'unobserved';
  }

  getPortRuntimeClass(service: ServiceControlItem, port: PortItem): string {
    switch (this.getPortRuntimeState(service, port)) {
      case 'traffic':
        return 'runtime-traffic';
      case 'listener':
        return 'runtime-listener';
      case 'published':
        return 'runtime-published';
      case 'unobserved':
        return 'runtime-unobserved';
      default:
        return 'runtime-private';
    }
  }

  getPortRuntimeLabelKey(service: ServiceControlItem, port: PortItem): string {
    switch (this.getPortRuntimeState(service, port)) {
      case 'traffic':
        return 'MICROSEGX.PORT_EXPOSURE.RUNTIME_TRAFFIC';
      case 'listener':
        return 'MICROSEGX.PORT_EXPOSURE.RUNTIME_LISTENER';
      case 'published':
        return 'MICROSEGX.PORT_EXPOSURE.RUNTIME_PUBLISHED';
      case 'unobserved':
        return 'MICROSEGX.PORT_EXPOSURE.RUNTIME_UNOBSERVED';
      default:
        return 'MICROSEGX.PORT_EXPOSURE.RUNTIME_PRIVATE';
    }
  }

  getPortRuntimeMatches(
    service: ServiceControlItem,
    port: PortItem
  ): ExposureItem[] {
    return this.getPortRuntimeEvidence(service, port).openItems;
  }

  getPortRuntimeAddressHint(
    service: ServiceControlItem,
    port: PortItem
  ): string {
    const items = this.getPortRuntimeMatches(service, port);
    if (items.length === 0) {
      return '-';
    }

    const addresses = Array.from(
      new Set(
        items.map(item => String(item.address || '').trim()).filter(Boolean)
      )
    );
    return addresses.join(', ');
  }

  openPortDialog(
    service: ServiceControlItem,
    port: PortItem,
    mode: 'open' | 'close'
  ): void {
    this.selectedService = service;
    this.selectedPort = port;
    this.portDialogMode = mode;
    this.requestedNodePort = mode === 'open' ? this.suggestNodePort() : null;
    this.portDialogError = '';
    this.showPortDialog = true;
  }

  openServiceCreateDialog(): void {
    this.serviceCreateForm = this.createEmptyServiceCreateForm();
    this.serviceCreateError = '';
    this.serviceCreateLoading = false;
    this.showServiceCreateDialog = true;
  }

  closeServiceCreateDialog(): void {
    this.showServiceCreateDialog = false;
    this.serviceCreateLoading = false;
    this.serviceCreateError = '';
    this.serviceCreateForm = this.createEmptyServiceCreateForm();
    this.syncDialogBodyState();
  }

  requestDeleteService(service: ServiceControlItem): void {
    this.serviceToDelete = service;
    this.serviceDeleteError = '';
    this.serviceDeleteLoading = false;
    this.showServiceDeleteDialog = true;
  }

  closeServiceDeleteDialog(): void {
    this.showServiceDeleteDialog = false;
    this.serviceDeleteLoading = false;
    this.serviceDeleteError = '';
    this.serviceToDelete = null;
    this.syncDialogBodyState();
  }

  closePortDialog(): void {
    this.showPortDialog = false;
    this.selectedService = null;
    this.selectedPort = null;
    this.portDialogLoading = false;
    this.portDialogError = '';
    this.syncDialogBodyState();
  }

  isNodePortUsed(port: number): boolean {
    return this.usedNodePorts.has(port);
  }

  suggestNodePort(): number {
    const range = this.nodePortRange;
    for (let candidate = range.start; candidate <= range.end; candidate += 1) {
      if (!this.isNodePortUsed(candidate)) {
        return candidate;
      }
    }
    return range.start;
  }

  executePortToggle(): void {
    if (!this.selectedService || !this.selectedPort) {
      return;
    }

    this.portDialogLoading = true;
    this.portDialogError = '';

    const expose = this.portDialogMode === 'open';
    const body = {
      namespace: this.selectedService.namespace,
      service_name: this.selectedService.service_name,
      port_key: this.selectedPort.key,
      expose,
      public_port: expose ? this.requestedNodePort : null,
    };

    this.http
      .post('/microsegx/api/service-controls/toggle', body, {
        headers: this.getHeaders(),
      })
      .subscribe({
        next: () => {
          this.portDialogLoading = false;
          this.closePortDialog();
          this.refresh();
        },
        error: err => {
          this.portDialogError =
            err?.error?.error ||
            this.translate.instant(
              'MICROSEGX.PORT_EXPOSURE.PORT_TOGGLE_FAILED'
            );
          this.portDialogLoading = false;
        },
      });
  }

  toggleAllPorts(service: ServiceControlItem, expose: boolean): void {
    const portsToToggle = service.ports.filter(port =>
      expose ? !port.public : port.public
    );
    if (portsToToggle.length === 0) {
      return;
    }

    this.portDialogLoading = true;
    this.togglePortsSequentially(service, portsToToggle, expose);
  }

  private togglePortsSequentially(
    service: ServiceControlItem,
    ports: PortItem[],
    expose: boolean
  ): void {
    if (ports.length === 0) {
      this.portDialogLoading = false;
      this.refresh();
      return;
    }

    const port = ports[0];
    const body = {
      namespace: service.namespace,
      service_name: service.service_name,
      port_key: port.key,
      expose,
      public_port: expose ? this.suggestNodePort() : null,
    };

    this.http
      .post('/microsegx/api/service-controls/toggle', body, {
        headers: this.getHeaders(),
      })
      .subscribe({
        next: () => {
          this.togglePortsSequentially(service, ports.slice(1), expose);
        },
        error: () => {
          this.togglePortsSequentially(service, ports.slice(1), expose);
        },
      });
  }

  addServiceCreatePort(): void {
    this.serviceCreateForm.ports = [
      ...this.serviceCreateForm.ports,
      this.createEmptyServicePortForm(),
    ];
  }

  removeServiceCreatePort(index: number): void {
    if (this.serviceCreateForm.ports.length <= 1) {
      return;
    }
    this.serviceCreateForm.ports = this.serviceCreateForm.ports.filter(
      (_, currentIndex) => currentIndex !== index
    );
  }

  onServiceCreateTypeChange(): void {
    if (this.serviceCreateForm.serviceType !== 'NodePort') {
      this.serviceCreateForm.ports = this.serviceCreateForm.ports.map(port => ({
        ...port,
        nodePort: null,
      }));
    }
  }

  submitServiceCreate(): void {
    this.serviceCreateError = '';

    let selector: Record<string, string>;
    try {
      selector = this.parseSelectorText(this.serviceCreateForm.selectorText);
    } catch (error: any) {
      this.serviceCreateError =
        error?.message ||
        this.translate.instant('MICROSEGX.PORT_EXPOSURE.SERVICE_CREATE_FAILED');
      return;
    }

    const ports = this.serviceCreateForm.ports.map((port, index) => ({
      name: String(port.name || '').trim(),
      protocol: 'TCP',
      service_port: Number(port.servicePort || 0),
      target_port: String(port.targetPort || '').trim(),
      node_port:
        this.serviceCreateForm.serviceType === 'NodePort'
          ? port.nodePort
          : null,
    }));

    this.serviceCreateLoading = true;
    this.http
      .post(
        '/microsegx/api/service-controls/services',
        {
          namespace: String(this.serviceCreateForm.namespace || '').trim(),
          service_name: String(this.serviceCreateForm.serviceName || '').trim(),
          service_type: this.serviceCreateForm.serviceType,
          selector,
          labels: {},
          annotations: {},
          ports,
        },
        {
          headers: this.getHeaders(),
        }
      )
      .subscribe({
        next: () => {
          this.serviceCreateLoading = false;
          this.closeServiceCreateDialog();
          this.setViewMode('services');
          this.refresh();
        },
        error: err => {
          this.serviceCreateError =
            err?.error?.error ||
            err?.error?.message ||
            this.translate.instant(
              'MICROSEGX.PORT_EXPOSURE.SERVICE_CREATE_FAILED'
            );
          this.serviceCreateLoading = false;
        },
      });
  }

  confirmDeleteService(): void {
    if (!this.serviceToDelete) {
      return;
    }

    this.serviceDeleteLoading = true;
    this.serviceDeleteError = '';
    this.http
      .delete('/microsegx/api/service-controls/services', {
        headers: this.getHeaders(),
        body: {
          namespace: this.serviceToDelete.namespace,
          service_name: this.serviceToDelete.service_name,
        },
      })
      .subscribe({
        next: () => {
          this.serviceDeleteLoading = false;
          this.closeServiceDeleteDialog();
          this.refresh();
        },
        error: err => {
          this.serviceDeleteError =
            err?.error?.error ||
            err?.error?.message ||
            this.translate.instant(
              'MICROSEGX.PORT_EXPOSURE.SERVICE_DELETE_FAILED'
            );
          this.serviceDeleteLoading = false;
        },
      });
  }

  private getServiceSearchTokens(item: ServiceControlItem): string[] {
    const portTokens = item.ports.flatMap(port => [
      port.port_name,
      port.protocol,
      `${port.service_port}`,
      `${port.service_port}/${port.protocol}`,
      `${port.target_port || ''}`,
      `${port.public_port || ''}`,
      `${port.node_port || ''}`,
      `${port.effective_public_port || ''}`,
      port.public_type,
      port.public ? 'public' : 'private',
    ]);

    return [
      item.namespace,
      item.service_name,
      item.public_service_type,
      item.service_type,
      item.public_service_name,
      item.node_port_range,
      ...portTokens,
    ]
      .map(token =>
        String(token || '')
          .trim()
          .toLowerCase()
      )
      .filter(Boolean);
  }

  private createEmptyServiceCreateForm(): ServiceCreateForm {
    return {
      namespace: this.getDefaultCreateNamespace(),
      serviceName: '',
      serviceType: 'ClusterIP',
      selectorText: '',
      ports: [this.createEmptyServicePortForm()],
    };
  }

  private createEmptyServicePortForm(): ServiceCreatePortForm {
    return {
      name: '',
      protocol: 'TCP',
      servicePort: null,
      targetPort: '',
      nodePort: null,
    };
  }

  private getDefaultCreateNamespace(): string {
    const businessService = this.allServiceControlItems.find(
      item => this.getServiceScope(item) === 'business'
    );
    return businessService?.namespace || 'default';
  }

  private parseSelectorText(selectorText: string): Record<string, string> {
    const selector: Record<string, string> = {};
    const parts = String(selectorText || '')
      .split(/[\n,]+/)
      .map(item => item.trim())
      .filter(Boolean);

    if (parts.length === 0) {
      throw new Error(
        this.translate.instant(
          'MICROSEGX.PORT_EXPOSURE.SERVICE_SELECTOR_REQUIRED'
        )
      );
    }

    for (const part of parts) {
      const [key, ...valueParts] = part.split('=');
      const normalizedKey = String(key || '').trim();
      const normalizedValue = valueParts.join('=').trim();
      if (!normalizedKey || !normalizedValue) {
        throw new Error(
          this.translate.instant(
            'MICROSEGX.PORT_EXPOSURE.SERVICE_SELECTOR_FORMAT'
          )
        );
      }
      selector[normalizedKey] = normalizedValue;
    }

    return selector;
  }

  private matchesServiceRuntimeFilter(item: ServiceControlItem): boolean {
    switch (this.serviceRuntimeFilter) {
      case 'public':
        return this.getServicePublishedPortCount(item) > 0;
      case 'listener':
        return this.getServiceListenerPortCount(item) > 0;
      case 'traffic':
        return this.getServiceTrafficPortCount(item) > 0;
      case 'mismatch':
        return this.getServiceMismatchPortCount(item) > 0;
      default:
        return true;
    }
  }

  private get allServiceControlItems(): ServiceControlItem[] {
    return this.dashboard?.service_controls?.items || [];
  }

  private get allExposureItems(): ExposureItem[] {
    return this.dashboard?.external_exposure_summary?.items || [];
  }

  private isManageableExposure(item: ExposureItem): boolean {
    const namespace = String(item.namespace || '').trim();
    const resourceName = String(item.resource_name || '').trim();
    const port = Number(item.port || 0);
    if (!namespace || !resourceName || !port) {
      return false;
    }

    return this.allServiceControlItems.some(service => {
      if (
        String(service.namespace || '').trim() !== namespace ||
        String(service.service_name || '').trim() !== resourceName
      ) {
        return false;
      }

      return (service.ports || []).some(candidate => {
        const publicPort =
          candidate.effective_public_port ||
          candidate.public_port ||
          candidate.node_port ||
          candidate.service_port;
        return Number(publicPort || 0) === port;
      });
    });
  }

  private isPlatformNamespace(namespace?: string): boolean {
    const normalized = String(namespace || '')
      .trim()
      .toLowerCase();
    return (
      normalized.startsWith('kube-') || this.platformNamespaces.has(normalized)
    );
  }

  private getServicePortEvidenceKey(
    namespace: string,
    serviceName: string,
    port: PortItem
  ): string {
    const publicPort =
      port.effective_public_port ||
      port.public_port ||
      port.node_port ||
      port.service_port;
    return `${namespace}::${serviceName}::${publicPort}`;
  }

  private getPortRuntimeEvidence(
    service: ServiceControlItem,
    port: PortItem
  ): PortRuntimeEvidence {
    return (
      this.portRuntimeMap.get(
        this.getServicePortEvidenceKey(
          service.namespace,
          service.service_name,
          port
        )
      ) || {
        items: [],
        openItems: [],
        listenerObserved: false,
        trafficObserved: false,
        publishedObserved: false,
      }
    );
  }

  private findMatchingExposureItems(
    service: ServiceControlItem,
    port: PortItem
  ): ExposureItem[] {
    if (!port.public) {
      return [];
    }

    const publicPort =
      port.effective_public_port ||
      port.public_port ||
      port.node_port ||
      port.service_port;

    return this.allExposureItems.filter(item => {
      const namespace = String(item.namespace || '').trim();
      const resourceName = String(item.resource_name || '').trim();
      const groupName = String(item.group_name || '').trim();
      return (
        namespace === service.namespace &&
        Number(item.port || 0) === Number(publicPort || 0) &&
        (resourceName === service.service_name ||
          groupName === service.service_name)
      );
    });
  }

  private hasOpenDialog(): boolean {
    return (
      this.showPortDialog ||
      this.showServiceCreateDialog ||
      this.showServiceDeleteDialog
    );
  }

  private syncDialogBodyState(): void {
    if (typeof document === 'undefined') {
      return;
    }

    const dialogOpen = this.hasOpenDialog();
    if (dialogOpen === this.dialogBodyLocked) {
      return;
    }

    document.body.classList.toggle('microsegx-dialog-open', dialogOpen);
    this.dialogBodyLocked = dialogOpen;
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
}
