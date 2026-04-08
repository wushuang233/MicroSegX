import { Component, OnInit } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { GlobalVariable } from '@common/variables/global.variable';
import { TranslateService } from '@ngx-translate/core';

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
  address: string;
  port: number;
  status: string;
  traffic_observed: boolean;
  listener_observed: boolean;
  latency_ms?: number;
}

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
export class MicrosegxPortExposureComponent implements OnInit {
  dashboard: DashboardData | null = null;
  loading = false;
  error = '';
  scanInProgress = false;

  // Filter state
  statusFilter = 'all';
  typeFilter = 'all';
  searchText = '';
  hideK8sSystem = false;

  // Port toggle state
  selectedService: ServiceControlItem | null = null;
  selectedPort: PortItem | null = null;
  showPortDialog = false;
  portDialogMode: 'open' | 'close' = 'open';
  requestedNodePort: number | null = null;
  portDialogLoading = false;
  portDialogError = '';

  // Used NodePorts for duplicate detection
  usedNodePorts: Set<number> = new Set();

  // Table columns for exposure view
  exposureColumns = [
    'namespace',
    'resource',
    'type',
    'address',
    'port',
    'status',
    'traffic',
  ];

  // Table columns for service control view
  serviceColumns = ['namespace', 'service', 'type', 'ports', 'actions'];

  exposureTypes: string[] = [];
  viewMode: 'exposure' | 'services' = 'services';

  constructor(
    private http: HttpClient,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.refresh();
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

  updateExposureTypes(): void {
    const items = this.dashboard?.external_exposure_summary?.items || [];
    const types = new Set(items.map(i => i.exposure_type).filter(Boolean));
    this.exposureTypes = Array.from(types) as string[];
  }

  updateUsedNodePorts(): void {
    const ports = new Set<number>();
    const items = this.dashboard?.service_controls?.items || [];
    for (const service of items) {
      for (const port of service.ports) {
        if (port.node_port && port.public) {
          ports.add(port.node_port);
        }
      }
    }
    // Also add from exposure items
    const exposures = this.dashboard?.external_exposure_summary?.items || [];
    for (const exp of exposures) {
      if (exp.port >= 30000 && exp.port <= 32767) {
        ports.add(exp.port);
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
        error: err => {
          this.error = this.translate.instant('MICROSEGX.SCAN_FAILED');
          this.scanInProgress = false;
        },
      });
  }

  pollScanStatus(): void {
    setTimeout(() => {
      this.http
        .get<{
          scan_in_progress: boolean;
        }>('/microsegx/api/dashboard', { headers: this.getHeaders() })
        .subscribe({
          next: data => {
            if (data.scan_in_progress) {
              this.pollScanStatus();
            } else {
              this.scanInProgress = false;
              this.refresh();
            }
          },
          error: () => {
            this.scanInProgress = false;
          },
        });
    }, 2000);
  }

  get exposureItems(): ExposureItem[] {
    let items = this.dashboard?.external_exposure_summary?.items || [];

    // Filter by status
    if (this.statusFilter !== 'all') {
      items = items.filter(i => i.status === this.statusFilter);
    }

    // Filter by exposure type
    if (this.typeFilter !== 'all') {
      items = items.filter(i => i.exposure_type === this.typeFilter);
    }

    // Filter by search text
    if (this.searchText) {
      const search = this.searchText.toLowerCase();
      items = items.filter(
        i =>
          i.namespace?.toLowerCase().includes(search) ||
          i.resource_name?.toLowerCase().includes(search) ||
          i.address?.toLowerCase().includes(search) ||
          i.port?.toString().includes(search)
      );
    }

    // Hide K8s system components
    if (this.hideK8sSystem) {
      items = items.filter(i => !this.isK8sSystemNamespace(i.namespace));
    }

    return items;
  }

  get serviceControls(): ServiceControlItem[] {
    let items = this.dashboard?.service_controls?.items || [];

    // Filter by search text
    if (this.searchText) {
      const search = this.searchText.toLowerCase();
      items = items.filter(
        i =>
          i.namespace?.toLowerCase().includes(search) ||
          i.service_name?.toLowerCase().includes(search)
      );
    }

    // Hide K8s system components
    if (this.hideK8sSystem) {
      items = items.filter(i => !this.isK8sSystemNamespace(i.namespace));
    }

    return items;
  }

  get serviceControlsEnabled(): boolean {
    return this.dashboard?.service_controls?.enabled || false;
  }

  get nodePortRange(): { start: number; end: number } {
    const range =
      this.dashboard?.service_controls?.node_port_range || '30000-32767';
    const parts = range.split('-');
    return {
      start: parseInt(parts[0]) || 30000,
      end: parseInt(parts[1]) || 32767,
    };
  }

  get summary() {
    return this.dashboard?.external_exposure_summary?.summary;
  }

  get clusterInfo() {
    return this.dashboard?.cluster;
  }

  get generatedAt(): string {
    return this.dashboard?.generated_at || '-';
  }

  isK8sSystemNamespace(ns: string): boolean {
    const systemNs = [
      'kube-system',
      'kube-public',
      'kube-node-lease',
      'local-path-storage',
    ];
    return systemNs.includes(ns);
  }

  getStatusClass(item: ExposureItem): string {
    if (item.status === 'open') {
      if (item.traffic_observed) return 'status-warning';
      if (item.listener_observed) return 'status-info';
      return 'status-ok';
    }
    return 'status-error';
  }

  // Port toggle functions
  openPortDialog(
    service: ServiceControlItem,
    port: PortItem,
    mode: 'open' | 'close'
  ): void {
    this.selectedService = service;
    this.selectedPort = port;
    this.portDialogMode = mode;
    this.requestedNodePort = null;
    this.portDialogError = '';
    this.showPortDialog = true;
  }

  closePortDialog(): void {
    this.showPortDialog = false;
    this.selectedService = null;
    this.selectedPort = null;
    this.portDialogLoading = false;
    this.portDialogError = '';
  }

  isNodePortUsed(port: number): boolean {
    return this.usedNodePorts.has(port);
  }

  suggestNodePort(): number {
    const range = this.nodePortRange;
    for (let p = range.start; p <= range.end; p++) {
      if (!this.isNodePortUsed(p)) {
        return p;
      }
    }
    return range.start;
  }

  executePortToggle(): void {
    if (!this.selectedService || !this.selectedPort) return;

    this.portDialogLoading = true;
    this.portDialogError = '';

    const expose = this.portDialogMode === 'open';
    const body = {
      namespace: this.selectedService.namespace,
      service_name: this.selectedService.service_name,
      port_key: this.selectedPort.key,
      expose: expose,
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
            this.translate.instant('MICROSEGX.PORT_TOGGLE_FAILED');
          this.portDialogLoading = false;
        },
      });
  }

  togglePortQuick(service: ServiceControlItem, port: PortItem): void {
    // Quick toggle: if open, close it; if closed, open with auto-assigned port
    if (port.public) {
      this.openPortDialog(service, port, 'close');
    } else {
      this.requestedNodePort = this.suggestNodePort();
      this.selectedService = service;
      this.selectedPort = port;
      this.portDialogMode = 'open';
      this.portDialogError = '';
      this.executePortToggle();
    }
  }

  getPublicPortDisplay(port: PortItem): string {
    if (!port.public) return '-';
    if (port.public_type === 'NodePort') {
      return port.node_port?.toString() || '-';
    }
    return port.public_port?.toString() || '-';
  }

  getPortStatusBadge(port: PortItem): string {
    return port.public ? 'open' : 'closed';
  }

  toggleAllPorts(service: ServiceControlItem, expose: boolean): void {
    // Toggle all ports in a service
    const portsToToggle = service.ports.filter(p =>
      expose ? !p.public : p.public
    );
    if (portsToToggle.length === 0) return;

    // Start with the first port
    const port = portsToToggle[0];
    if (expose) {
      this.requestedNodePort = this.suggestNodePort();
    }
    this.selectedService = service;
    this.selectedPort = port;
    this.portDialogMode = expose ? 'open' : 'close';
    this.portDialogError = '';

    const body = {
      namespace: service.namespace,
      service_name: service.service_name,
      port_key: port.key,
      expose: expose,
      public_port: expose ? this.requestedNodePort : null,
    };

    this.portDialogLoading = true;

    this.http
      .post('/microsegx/api/service-controls/toggle', body, {
        headers: this.getHeaders(),
      })
      .subscribe({
        next: () => {
          // Continue with remaining ports
          const remainingPorts = portsToToggle.slice(1);
          if (remainingPorts.length > 0) {
            this.togglePortsSequentially(service, remainingPorts, expose);
          } else {
            this.portDialogLoading = false;
            this.refresh();
          }
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

  private togglePortsSequentially(
    service: ServiceControlItem,
    ports: PortItem[],
    expose: boolean
  ): void {
    if (ports.length === 0) {
      this.refresh();
      return;
    }

    const port = ports[0];
    const body = {
      namespace: service.namespace,
      service_name: service.service_name,
      port_key: port.key,
      expose: expose,
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
          // Continue even if one fails
          this.togglePortsSequentially(service, ports.slice(1), expose);
        },
      });
  }
}
