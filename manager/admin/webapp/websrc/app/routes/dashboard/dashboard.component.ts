import {
  Component,
  OnInit,
  ViewChild,
  ElementRef,
  OnDestroy,
} from '@angular/core';
import { GlobalVariable } from '@common/variables/global.variable';
import { GlobalConstant } from '@common/constants/global.constant';
import { DashboardService } from '@services/dashboard.service';
import { SystemSummaryDetails, InternalSystemInfo } from '@common/types';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { ActivatedRoute } from '@angular/router';
import { AssetsHttpService } from '@common/api/assets-http.service';
import { MicrosegxHttpService } from '@common/api/microsegx-http.service';
import { MicrosegxOverview } from '@common/types';
import { ReportByNamespaceModalComponent } from './report-by-namespace-modal/report-by-namespace-modal.component';
import { isAuthorized } from '@common/utils/common.utils';
import { SummaryService } from '@services/summary.service';

@Component({
  standalone: false,
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent implements OnInit, OnDestroy {
  @ViewChild('dashboardReport') printableReport!: ElementRef;
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

  isGlobalUser: boolean = false;
  summaryInfo!: SystemSummaryDetails;
  scoreInfo!: InternalSystemInfo | null;
  isPrinting: boolean = false;
  iskube: boolean = false;
  reportDialog!: MatDialogRef<any>;
  reportDomain: string = '';
  reportInfo: any;
  isShowingScore: boolean = false;
  microsegxOverview: MicrosegxOverview | null = null;

  securityEvents: any;
  details: any;
  get hostsCount(): number {
    return this.summaryInfo?.hosts || 0;
  }
  get podsCount(): number {
    return this.summaryInfo?.running_pods || 0;
  }
  get protectedContainersCount(): number {
    return (this.details?.containers || []).filter(
      container => container.state === 'protect'
    ).length;
  }
  get monitorContainersCount(): number {
    return (this.details?.containers || []).filter(
      container => container.state === 'monitor'
    ).length;
  }
  get discoverContainersCount(): number {
    return (this.details?.containers || []).filter(
      container => container.state === 'discover'
    ).length;
  }
  get quarantinedContainersCount(): number {
    return (this.details?.containers || []).filter(
      container => container.state === 'quarantined'
    ).length;
  }
  get riskScoreValue(): number | string {
    return this.scoreInfo?.security_scores?.security_risk_score ?? '--';
  }
  get criticalEventsTotal(): number {
    return this.sumSeries(
      this.securityEvents?.criticalSecurityEvents?.summary?.critical
    );
  }
  get warningEventsTotal(): number {
    return this.sumSeries(
      this.securityEvents?.criticalSecurityEvents?.summary?.warning
    );
  }
  get ingressExposureCount(): number {
    return this.scoreInfo?.ingress?.length || 0;
  }
  get egressExposureCount(): number {
    return this.scoreInfo?.egress?.length || 0;
  }
  get cveDbVersion(): string {
    return this.summaryInfo?.cvedb_version || '-';
  }
  get workloadInventoryCount(): number {
    const containerCount = (this.details?.containers || []).length;
    return containerCount || this.podsCount || 0;
  }
  get workloadCoveredCount(): number {
    return (
      this.protectedContainersCount +
      this.monitorContainersCount +
      this.discoverContainersCount +
      this.quarantinedContainersCount
    );
  }
  get microsegxOpenPorts(): number {
    return this.microsegxOverview?.portExposure?.openPorts || 0;
  }
  get microsegxManagedServices(): number {
    return this.microsegxOverview?.portExposure?.managedServices || 0;
  }
  get microsegxExposedTargets(): number {
    return this.microsegxOverview?.portExposure?.exposedTargets || 0;
  }
  get microsegxAliveRouters(): number {
    return this.microsegxOverview?.ziti?.aliveRouters || 0;
  }
  get microsegxZitiServices(): number {
    return this.microsegxOverview?.ziti?.services || 0;
  }
  get microsegxZitiIdentities(): number {
    return this.microsegxOverview?.ziti?.identities || 0;
  }
  get microsegxControllerUrl(): string {
    return this.microsegxOverview?.ziti?.defaultControllerUrl || '-';
  }
  get microsegxFabricAvailable(): boolean {
    return Boolean(this.microsegxOverview?.ziti?.available);
  }
  get microsegxManageableServices(): number {
    return this.microsegxServiceControls.length;
  }
  get microsegxManageableOpenPorts(): number {
    return this.microsegxServiceControls.reduce(
      (total, item) => total + (+item?.open_port_count || 0),
      0
    );
  }
  get microsegxInfrastructureExposurePorts(): number {
    return this.microsegxExposureItems.filter(
      item =>
        this.getExposureScope(item) === 'platform' && item?.status === 'open'
    ).length;
  }
  get microsegxNodeListenerPorts(): number {
    return this.microsegxExposureItems.filter(
      item => this.getExposureScope(item) === 'node' && item?.status === 'open'
    ).length;
  }
  get microsegxPublishedServices(): number {
    const serviceIds = new Set(
      this.microsegxTerminators
        .map(
          item => item?.serviceId || item?.service?.id || item?.service?.name
        )
        .filter(Boolean)
    );
    return serviceIds.size || this.microsegxZitiServices;
  }
  get microsegxConnectedIdentities(): number {
    return this.microsegxIdentities.filter(
      identity =>
        Boolean(identity?.hasEdgeRouterConnection) ||
        String(identity?.edgeRouterConnectionStatus || '').toLowerCase() ===
          'online'
    ).length;
  }
  get microsegxTerminatorCount(): number {
    return this.microsegxTerminators.length;
  }
  get leadRiskContainer(): any {
    return this.details?.highPriorityVulnerabilities?.containers
      ?.top5Containers?.[0];
  }

  constructor(
    private activatedRoute: ActivatedRoute,
    private dashboardService: DashboardService,
    private assetsHttpService: AssetsHttpService,
    private microsegxHttpService: MicrosegxHttpService,
    private summaryService: SummaryService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.securityEvents = this.activatedRoute.snapshot.data['securityEvents'];
    this.dashboardService
      .getDashboardDetails()
      .subscribe(d => (this.details = d));

    const resource = {
      seeScore: {
        global: 1,
        namespace: 1,
      },
    };
    this.isShowingScore = isAuthorized(
      GlobalVariable.user.roles,
      resource.seeScore
    );
    this.isGlobalUser = GlobalVariable.user?.global_permissions.length > 0;
    this.getBasicData();
    this.dashboardService.refreshEvent$.subscribe(refresh => {
      if (refresh) this.getBasicData(true);
    });
    this.loadMicrosegxOverview();

    if (!GlobalVariable.hasInitializedSummary) {
      this.getSummary();
    }
  }

  ngOnDestroy(): void {
    GlobalVariable.hasInitializedSummary = false;
  }

  openDashboardReportList = () => {
    this.assetsHttpService.getDomain().subscribe(
      (response: any) => {
        const RESOURCELIST = ['_images', '_nodes', '_containers'];
        let domainList = response.domains
          .filter(domain => !RESOURCELIST.includes(domain.name))
          .map(domain => domain.name);
        this.getDashboardReportListModal(domainList);
      },
      error => {
        console.warn(error);
        this.getDashboardReportListModal([]);
      }
    );
  };

  printDashboardReport = (domain: string = '', reportInfo: any = null) => {
    this.reportInfo = domain
      ? reportInfo
      : {
          scoreInfo: this.scoreInfo,
          summaryInfo: this.summaryInfo,
          dashboardSecurityEventInfo: {
            topSecurityEvents:
              this.securityEvents.criticalSecurityEvents['top_security_events'],
            securityEventSummary:
              this.securityEvents.criticalSecurityEvents['summary'],
          },
          dashboardDetailsInfo: {
            isAutoScanOn: this.details.autoScanConfig,
            highPriorityVulnerabilities:
              this.details.highPriorityVulnerabilities,
            containers: this.details.containers,
            services: this.details.services,
            applications: this.details.applications2,
          },
        };

    this.reportDialog?.close();

    setTimeout(() => {
      this.reportDomain = domain;
      this.isPrinting = true;
      setInterval(() => {
        if (this.printableReport) {
          window.print();
          this.isPrinting = false;
        }
      }, 500);
    }, 500);
  };

  private getBasicData = (isRefeshing = false) => {
    if (!isRefeshing) {
      const response = this.activatedRoute.snapshot.data['basicData'];
      this.handleBasicData(response);
    } else {
      this.dashboardService
        .getScoreData(GlobalVariable.user?.global_permissions.length > 0, null)
        .subscribe(this.handleBasicData.bind(this));
    }
  };

  private handleBasicData(response: InternalSystemInfo) {
    this.scoreInfo = null;
    this.summaryInfo = GlobalVariable.summary as SystemSummaryDetails;
    this.scoreInfo = response as InternalSystemInfo;

    this.iskube = this.summaryInfo.platform
      .toLowerCase()
      .includes(GlobalConstant.KUBE);
  }

  private getDashboardReportListModal = (domainList: string[]) => {
    this.reportDialog = this.dialog.open(ReportByNamespaceModalComponent, {
      width: '300px',
      data: {
        domainList: domainList,
        printDashboardReport: this.printDashboardReport,
        isGlobalUser: this.isGlobalUser,
      },
      hasBackdrop: false,
      position: { right: '25px', top: '80px' },
    });
  };

  private getSummary = () => {
    this.summaryService.refreshSummary();
  };

  private loadMicrosegxOverview = () => {
    this.microsegxHttpService.getOverview().subscribe({
      next: overview => {
        this.microsegxOverview = overview;
      },
      error: () => {
        this.microsegxOverview = null;
      },
    });
  };

  private sumSeries(series: any[]): number {
    return (series || []).reduce(
      (total, point) => total + (+point?.[1] || 0),
      0
    );
  }

  private get microsegxServiceControls(): any[] {
    return this.microsegxOverview?.dashboard?.service_controls?.items || [];
  }

  private get microsegxExposureItems(): any[] {
    return (
      this.microsegxOverview?.dashboard?.external_exposure_summary?.items || []
    );
  }

  private get microsegxTerminators(): any[] {
    return this.microsegxOverview?.zitiOverview?.terminators || [];
  }

  private get microsegxIdentities(): any[] {
    return this.microsegxOverview?.zitiOverview?.identities || [];
  }

  private isPlatformNamespace(namespace?: string): boolean {
    const normalized = String(namespace || '')
      .trim()
      .toLowerCase();
    return (
      normalized.startsWith('kube-') || this.platformNamespaces.has(normalized)
    );
  }

  private getExposureScope(item: any): 'manageable' | 'platform' | 'node' {
    const namespace = String(item?.namespace || '')
      .trim()
      .toLowerCase();
    const resourceKind = String(item?.resource_kind || '')
      .trim()
      .toLowerCase();
    const exposureType = String(item?.exposure_type || '')
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
    if (this.isPlatformNamespace(namespace) || Boolean(item?.platform_role)) {
      return 'platform';
    }
    return 'manageable';
  }

  private isManageableExposure(item: any): boolean {
    const namespace = String(item?.namespace || '').trim();
    const resourceName = String(item?.resource_name || '').trim();
    const port = Number(item?.port || 0);
    if (!namespace || !resourceName || !port) {
      return false;
    }

    return this.microsegxServiceControls.some(service => {
      if (
        String(service?.namespace || '').trim() !== namespace ||
        String(service?.service_name || '').trim() !== resourceName
      ) {
        return false;
      }

      return (service?.ports || []).some(candidate => {
        const publicPort =
          candidate?.effective_public_port ||
          candidate?.public_port ||
          candidate?.node_port ||
          candidate?.service_port;
        return Number(publicPort || 0) === port;
      });
    });
  }
}
