import { Component, OnInit } from '@angular/core';
import { MicrosegxHttpService } from '@common/api/microsegx-http.service';
import { MicrosegxOverview } from '@common/types';

interface ZitiRouter {
  name: string;
  online: boolean;
  version?: string;
  ip_address?: string;
}

interface ZitiService {
  name: string;
  dns_hostname?: string;
  port?: number;
}

interface ZitiIdentity {
  name: string;
  type?: string;
  is_default?: boolean;
}

@Component({
  standalone: false,
  selector: 'app-microsegx-ziti',
  templateUrl: './microsegx-ziti.component.html',
  styleUrls: ['./microsegx-ziti.component.scss'],
})
export class MicrosegxZitiComponent implements OnInit {
  overview: MicrosegxOverview | null = null;
  loading = false;
  error = '';

  // Detailed data
  routers: ZitiRouter[] = [];
  services: ZitiService[] = [];
  identities: ZitiIdentity[] = [];
  configs: any[] = [];

  // View state
  viewTabIndex = 0;

  // Table columns
  routerColumns: string[] = ['name', 'status', 'ip', 'version'];
  serviceColumns: string[] = ['name', 'dns', 'port'];
  identityColumns: string[] = ['name', 'type', 'default'];

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
        this.loading = false;
        if (overview.ziti?.available) {
          this.loadDetailedData();
        }
      },
      error: err => {
        this.error = err?.error?.message || err?.message || '加载失败';
        this.loading = false;
      },
    });
  }

  loadDetailedData(): void {
    // Load routers
    this.microsegxHttpService.getZitiRouters().subscribe({
      next: (data: any) => {
        this.routers = data?.routers || [];
      },
      error: () => {},
    });

    // Load services
    this.microsegxHttpService.getZitiServices().subscribe({
      next: (data: any) => {
        this.services = data?.services || [];
      },
      error: () => {},
    });

    // Load identities
    this.microsegxHttpService.getZitiIdentities().subscribe({
      next: (data: any) => {
        this.identities = data?.identities || [];
      },
      error: () => {},
    });

    // Load configs
    this.microsegxHttpService.getZitiConfigs().subscribe({
      next: (data: any) => {
        this.configs = data?.configs || [];
      },
      error: () => {},
    });
  }

  get aliveRouters(): ZitiRouter[] {
    return this.routers.filter(r => r.online);
  }

  get offlineRouters(): ZitiRouter[] {
    return this.routers.filter(r => !r.online);
  }

  get controllerStatusClass(): string {
    if (this.overview?.ziti?.controllerError) return 'status-error';
    if (this.overview?.ziti?.available) return 'status-ok';
    return 'status-warning';
  }

  get controllerStatusText(): string {
    if (this.overview?.ziti?.controllerError)
      return this.overview.ziti.controllerError;
    if (this.overview?.ziti?.available) return 'Connected';
    return 'Not configured';
  }
}
