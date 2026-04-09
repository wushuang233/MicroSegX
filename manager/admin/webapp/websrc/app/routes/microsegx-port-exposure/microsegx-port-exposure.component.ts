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
}

type ServiceScope = 'all' | 'business' | 'platform';
type ExposureScope = 'all' | 'manageable' | 'platform' | 'node';

interface DashboardData {
  generated_at?: string;
  cluster?: {
    local_node_name: string;
    kubernetes_version: string;
  };
  external_exposure_summary?: {
    items: ExposureItem[];
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
  servicePublishTypeFilter = 'all';
  servicePortScopeFilter = 'all';
  serviceScopeFilter: ServiceScope = 'all';
  exposureScopeFilter: ExposureScope = 'all';

  selectedService: ServiceControlItem | null = null;
  selectedPort: PortItem | null = null;
  showPortDialog = false;
  portDialogMode: 'open' | 'close' = 'open';
  requestedNodePort: number | null = null;
  portDialogLoading = false;
  portDialogError = '';

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
    'ports',
    'actions',
  ];

  exposureTypes: string[] = [];
  viewMode: 'exposure' | 'services' = 'services';
  private dialogBodyLocked = false;

  constructor(
    private http: HttpClient,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.refresh();
  }

  ngAfterViewChecked(): void {
    this.syncDialogBodyState();
  }

  ngOnDestroy(): void {
    this.releaseDialogBodyState();
  }

  private getHeaders(): HttpHeaders {
    const token = GlobalVariable.nvToken || localStorage.getItem('token');
    return new HttpHeaders({
      Token: token || '',
      'Content-Type': 'application/json',
    });
  }

  refresh(): void {
    this.loading = true;
    this.error = '';

    this.http
      .get<DashboardData>('/microsegx/api/dashboard', {
        headers: this.getHeaders(),
      })
      .subscribe({
        next: data => {
          this.dashboard = data;
          this.scanInProgress = data.scan_state?.scan_in_progress || false;
          this.loading = false;
          this.updateExposureTypes();
          this.updateUsedNodePorts();
        },
        error: err => {
          this.error =
            err?.error?.message ||
            err?.message ||
            this.translate.instant('MICROSEGX.LOAD_FAILED');
          this.loading = false;
        },
      });
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
    setTimeout(() => {
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
            this.refresh();
          },
          error: () => {
            this.scanInProgress = false;
          },
        });
    }, 2000);
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

  private syncDialogBodyState(): void {
    if (typeof document === 'undefined') {
      return;
    }

    if (this.showPortDialog === this.dialogBodyLocked) {
      return;
    }

    document.body.classList.toggle(
      'microsegx-dialog-open',
      this.showPortDialog
    );
    this.dialogBodyLocked = this.showPortDialog;
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
