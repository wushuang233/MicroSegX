import { Component, OnInit } from '@angular/core';
import { MicrosegxHttpService } from '@common/api/microsegx-http.service';
import { MicrosegxOverview } from '@common/types';

interface ExposureItem {
  namespace: string;
  resource_name: string;
  resource_kind: string;
  group_name?: string;
  port: number;
  protocol: string;
  traffic_observed: boolean;
  listener_observed: boolean;
  first_seen?: string;
  last_seen?: string;
}

interface ServiceControl {
  name: string;
  namespace: string;
  open_ports: number[];
  selector: Record<string, string>;
}

@Component({
  standalone: false,
  selector: 'app-microsegx-port-exposure',
  templateUrl: './microsegx-port-exposure.component.html',
  styleUrls: ['./microsegx-port-exposure.component.scss'],
})
export class MicrosegxPortExposureComponent implements OnInit {
  overview: MicrosegxOverview | null = null;
  loading = false;
  error = '';

  // Detailed data
  exposureItems: ExposureItem[] = [];
  serviceControls: ServiceControl[] = [];
  nodes: any[] = [];
  namespaces: string[] = [];

  // Filter state
  selectedNamespace = '';
  searchText = '';

  // View state
  viewTabIndex = 0;
  scanInProgress = false;

  // Table columns
  displayedColumns: string[] = ['namespace', 'resource', 'port', 'status'];
  serviceColumns: string[] = ['name', 'namespace', 'ports'];
  nodeColumns: string[] = ['name', 'ip', 'ports'];

  constructor(private microsegxHttpService: MicrosegxHttpService) {}

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.error = '';
    this.loading = true;

    this.microsegxHttpService.getOverview().subscribe({
      next: overview => {
        this.overview = overview;
        this.scanInProgress = overview.portExposure?.scanInProgress || false;
        this.loading = false;
        this.loadDetailedData();
      },
      error: err => {
        this.error = err?.error?.message || err?.message || '加载失败';
        this.loading = false;
      },
    });
  }

  loadDetailedData(): void {
    // Load exposure items
    this.microsegxHttpService.getExternalExposure().subscribe({
      next: (data: any) => {
        this.exposureItems = data?.items || [];
        this.nodes = data?.node_inventory || [];
      },
      error: () => {},
    });

    // Load service controls
    this.microsegxHttpService.getPortExposureServices().subscribe({
      next: (data: any) => {
        this.serviceControls = data?.services || [];
      },
      error: () => {},
    });

    // Load namespaces
    this.microsegxHttpService.getNamespaces().subscribe({
      next: (data: any) => {
        this.namespaces = data?.namespaces || [];
      },
      error: () => {},
    });
  }

  triggerScan(): void {
    this.scanInProgress = true;
    this.microsegxHttpService.triggerScan().subscribe({
      next: () => {
        this.pollScanStatus();
      },
      error: err => {
        this.error = err?.error?.message || '扫描启动失败';
        this.scanInProgress = false;
      },
    });
  }

  pollScanStatus(): void {
    const poll = () => {
      this.microsegxHttpService.getScanStatus().subscribe({
        next: (data: any) => {
          if (data?.scan_in_progress) {
            setTimeout(poll, 2000);
          } else {
            this.scanInProgress = false;
            this.refresh();
          }
        },
        error: () => {
          this.scanInProgress = false;
        },
      });
    };
    poll();
  }

  get filteredExposureItems(): ExposureItem[] {
    let items = this.exposureItems;

    if (this.selectedNamespace) {
      items = items.filter(i => i.namespace === this.selectedNamespace);
    }

    if (this.searchText) {
      const search = this.searchText.toLowerCase();
      items = items.filter(
        i =>
          i.resource_name?.toLowerCase().includes(search) ||
          i.namespace?.toLowerCase().includes(search) ||
          i.resource_kind?.toLowerCase().includes(search)
      );
    }

    return items;
  }

  get filteredServiceControls(): ServiceControl[] {
    let services = this.serviceControls;

    if (this.selectedNamespace) {
      services = services.filter(s => s.namespace === this.selectedNamespace);
    }

    if (this.searchText) {
      const search = this.searchText.toLowerCase();
      services = services.filter(
        s =>
          s.name?.toLowerCase().includes(search) ||
          s.namespace?.toLowerCase().includes(search)
      );
    }

    return services;
  }

  get uniqueNamespaces(): string[] {
    const ns = new Set<string>();
    this.exposureItems.forEach(i => ns.add(i.namespace));
    this.serviceControls.forEach(s => ns.add(s.namespace));
    return Array.from(ns).sort();
  }

  formatPort(ports: number | number[]): string {
    if (Array.isArray(ports)) {
      return ports.map(p => p.toString()).join(', ');
    }
    return ports?.toString() || '-';
  }

  getStatusClass(item: ExposureItem): string {
    if (item.traffic_observed) return 'status-warning';
    if (item.listener_observed) return 'status-info';
    return 'status-ok';
  }
}
