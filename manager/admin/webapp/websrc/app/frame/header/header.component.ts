import {
  Component,
  Inject,
  Injector,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { MultiClusterService } from '@services/multi-cluster.service';
import { Router } from '@angular/router';
import screenfull from 'screenfull';

import { SwitchersService } from '@core/switchers/switchers.service';
import { MenuService } from '@core/menu/menu.service';
import { MapConstant } from '@common/constants/map.constant';
import { Cluster, ClusterData } from '@common/types';
import {
  LOCAL_STORAGE,
  SESSION_STORAGE,
  StorageService,
} from 'ngx-webstorage-service';
import { GlobalConstant } from '@common/constants/global.constant';
import { GlobalVariable } from '@common/variables/global.variable';
import { NotificationService } from '@services/notification.service';
import { TranslateService } from '@ngx-translate/core';
import { isAuthorized, isValidBased64 } from '@common/utils/common.utils';
import { AuthUtilsService } from '@common/utils/auth.utils';
import { CommonHttpService } from '@common/api/common-http.service';
import { AuthService } from '@services/auth.service';
import { SettingsService } from '@services/settings.service';
import { switchMap, take } from 'rxjs/operators';
import { FrameService } from '../frame.service';
import { environment } from '../../../environments/environment';
import { TranslatorService } from '@core/translator/translator.service';

@Component({
  standalone: false,
  selector: 'app-header',
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss'],
})
export class HeaderComponent implements OnInit, OnDestroy {
  private readonly routeMeta: Record<
    string,
    { titleKey: string; captionKey?: string }
  > = {
    '/profile': {
      titleKey: 'enum.MY_PROFILE',
    },
    '/federated-policy': {
      titleKey: 'enum.FED_POLICY',
    },
    '/multi-cluster': {
      titleKey: 'enum.MULTI_CLUSTER',
    },
    '/dashboard': {
      titleKey: 'customUi.header.routes.dashboard',
      captionKey: 'customUi.header.captions.dashboard',
    },
    '/graph': {
      titleKey: 'sidebar.nav.NETWORK_ACTIVITY',
    },
    '/platforms': {
      titleKey: 'scan.PLATFORM',
    },
    '/domains': {
      titleKey: 'sidebar.nav.NAMESPACES',
    },
    '/hosts': {
      titleKey: 'sidebar.nav.NODES',
    },
    '/workloads': {
      titleKey: 'customUi.header.routes.workloads',
      captionKey: 'customUi.header.captions.workloads',
    },
    '/regScan': {
      titleKey: 'customUi.header.routes.registries',
      captionKey: 'customUi.header.captions.registries',
    },
    '/controllers': {
      titleKey: 'sidebar.nav.SYSTEM_COMPONENTS',
    },
    '/admission-control': {
      titleKey: 'sidebar.nav.ADMISSION_CONTROL',
    },
    '/group': {
      titleKey: 'sidebar.nav.GROUP',
    },
    '/policy': {
      titleKey: 'sidebar.nav.POLICY',
    },
    '/response-policy': {
      titleKey: 'sidebar.nav.RESPONSE_POLICY',
    },
    '/dlp-sensors': {
      titleKey: 'sidebar.nav.DLP_SENSORS',
    },
    '/waf-sensors': {
      titleKey: 'sidebar.nav.WAF_SENSORS',
    },
    '/scan': {
      titleKey: 'customUi.header.routes.vulnerabilities',
      captionKey: 'customUi.header.captions.vulnerabilities',
    },
    '/cveProfile': {
      titleKey: 'cveProfile.TITLE',
    },
    '/bench': {
      titleKey: 'sidebar.nav.BENCH',
    },
    '/cisProfile': {
      titleKey: 'cis.COMPLIANCE_PROFILE',
    },
    '/event': {
      titleKey: 'sidebar.nav.EVENT',
    },
    '/security-event': {
      titleKey: 'customUi.header.routes.securityEvents',
      captionKey: 'customUi.header.captions.securityEvents',
    },
    '/audit': {
      titleKey: 'sidebar.nav.AUDIT',
    },
    '/settings': {
      titleKey: 'sidebar.nav.SETTING',
    },
    '/signature-verifiers': {
      titleKey: 'sidebar.nav.SIGSTORE_VERIFIERS',
    },
    '/support': {
      titleKey: 'customUi.header.routes.support',
      captionKey: 'customUi.header.captions.support',
    },
  };
  navCollapsed = true;
  menuItems: Array<any> = [];
  router: Router = <Router>{};
  clusterName: string = '';
  clusterNameError: boolean = false;
  clusters: Cluster[] = [];
  primaryClusterRestVersion: string = '';
  clustersError: boolean = false;
  isMasterRole: boolean = false;
  isMemberRole: boolean = false;
  isStandaloneRole: boolean = false;
  isOnRemoteCluster: boolean = false;
  selectedCluster: Cluster | undefined;
  isSUSESSO: boolean = false;
  primaryMasterName: string = '';
  managedClusterName: string = '';
  isAllowedToOperateMultiCluster: boolean = false;
  isAllowedToRedirectMultiCluster: boolean = false;
  isFedQueryAllowed: boolean = false;
  get gravatarEnabled() {
    return GlobalVariable.gravatar;
  }

  email = '';
  username = '';
  displayRole = '';
  pageTitle = '';
  pageCaption = '';

  isNavSearchVisible: boolean = false;
  isPreviewMode: boolean = environment.previewMode;
  private _clusterSwitchedSubScription;
  private _multiClusterSubScription;
  private _getRebrandCustomValuesSubscription;
  private _clusterNameSubScription;
  public isAuthReadConfig: boolean = false;

  @ViewChild('fsbutton', { static: true }) fsbutton;

  constructor(
    public menu: MenuService,
    public notificationService: NotificationService,
    public multiClusterService: MultiClusterService,
    public translateService: TranslateService,
    public translatorService: TranslatorService,
    public switchers: SwitchersService,
    public authUtilsService: AuthUtilsService,
    public injector: Injector,
    private authService: AuthService,
    private commonHttpService: CommonHttpService,
    private settingsService: SettingsService,
    private frameService: FrameService,
    @Inject(SESSION_STORAGE) private sessionStorage: StorageService,
    @Inject(LOCAL_STORAGE) private localStorage: StorageService
  ) {
    this.menuItems = menu.getMenu().slice(0, 4);
  }

  ngOnInit() {
    if (
      !GlobalVariable.customPageHeaderColor &&
      !GlobalVariable.customPageHeaderContent
    ) {
      this.retrieveCustomizedUIContent();
    }

    this.isSUSESSO = GlobalVariable.isSUSESSO;
    this.isNavSearchVisible = false;
    this.router = this.injector.get(Router);

    this.router.events.subscribe(() => {
      window.scrollTo(0, 0);
      this.navCollapsed = true;
      this.refreshRouteContext();
    });
    this.translateService.onLangChange.subscribe(() => {
      this.refreshRouteContext();
    });
    this.refreshRouteContext();

    const resource = {
      multiClusterOp: {
        global: 2,
      },
      redirectAuth: {
        global: 3,
      },
      manageAuth: {
        global: 2,
      },
      policyAuth: {
        global: 3,
      },
      fedQueryAllowed: {
        global: 1,
      },
    };

    if (GlobalVariable.user) {
      this.isAllowedToOperateMultiCluster =
        isAuthorized(GlobalVariable.user.roles, resource.multiClusterOp) ||
        this.authUtilsService.getGlobalPermissionDisplayFlag('multi_cluster');
      this.isAllowedToRedirectMultiCluster =
        isAuthorized(GlobalVariable.user.roles, resource.redirectAuth) ||
        this.authUtilsService.getGlobalPermissionDisplayFlag('multi_cluster');
      this.isAuthReadConfig =
        this.authUtilsService.getGlobalPermissionDisplayFlag('read_config');
      this.isFedQueryAllowed =
        isAuthorized(GlobalVariable.user.roles, resource.fedQueryAllowed) ||
        this.authUtilsService.getGlobalPermissionDisplayFlag('multi_cluster');
    }

    this.initMultiClusters();

    this.email = this.localStorage.get(
      GlobalConstant.LOCAL_STORAGE_TOKEN
    )?.emailHash;
    this.username = this.localStorage.get(
      GlobalConstant.LOCAL_STORAGE_TOKEN
    )?.token?.username;
    const role = this.localStorage.get(GlobalConstant.LOCAL_STORAGE_TOKEN)
      ?.token?.role;
    this.displayRole = role
      ? role
      : GlobalVariable.user.token.server
            .toLowerCase()
            .includes(MapConstant.SERVER_TYPE.RANCHER)
        ? 'Rancher User'
        : 'Namespace User';

    this._clusterSwitchedSubScription =
      this.multiClusterService.onClusterSwitchedEvent$.subscribe(() => {
        const currentUrl = this.router.url;
        this.router
          .navigateByUrl('/', { skipLocationChange: true })
          .then(() => {
            this.router.navigate([currentUrl]);
          });
      });

    this._multiClusterSubScription =
      this.multiClusterService.onRefreshClustersEvent$.subscribe(() => {
        this.initMultiClusters();
      });

    this._multiClusterSubScription =
      this.multiClusterService.onManageMemberClusterEvent$.subscribe(() => {
        this.initMultiClusters();
      });

    this._clusterNameSubScription =
      this.multiClusterService.onClusterNameChangeEvent$.subscribe(data => {
        this.clusterName = this.multiClusterService.clusterName;
      });
  }

  ngOnDestroy() {
    if (this._clusterSwitchedSubScription) {
      this._clusterSwitchedSubScription.unsubscribe();
    }

    if (this._multiClusterSubScription) {
      this._multiClusterSubScription.unsubscribe();
    }

    if (this._getRebrandCustomValuesSubscription) {
      this._getRebrandCustomValuesSubscription.unsubscribe();
    }
    if (this._clusterNameSubScription) {
      this._clusterNameSubScription.unsubscribe();
    }
  }

  toggleUserBlock(event) {
    event.preventDefault();
  }

  openNavSearch(event) {
    event.preventDefault();
    event.stopPropagation();
    this.setNavSearchVisible(true);
  }

  setNavSearchVisible(stat: boolean) {
    this.isNavSearchVisible = stat;
  }

  getNavSearchVisible() {
    return this.isNavSearchVisible;
  }

  get languages(): { code: string; text: string }[] {
    return this.translatorService.getAvailableLanguages();
  }

  get activeLanguageLabel(): string {
    const current = this.translateService.currentLang || 'en';
    return (
      this.languages.find(language => language.code === current)?.text ||
      'English'
    );
  }

  setLanguage(lang: string): void {
    this.translatorService.useLanguage(lang);
    this.refreshRouteContext();
  }

  toggleOffsidebar() {
    this.switchers.toggleFrameSwitcher('offsidebarOpen');
  }

  toggleCollapsedSidebar() {
    this.switchers.toggleFrameSwitcher('isCollapsed');
    this.frameService.dispatchToggleSidebarEvent();
  }

  isCollapsedText() {
    return this.switchers.getFrameSwitcher('isCollapsedText');
  }

  focusMainContainer(event: MouseEvent) {
    const element = event.view?.window.document.getElementById(
      'main-content'
    ) as HTMLElement | undefined;
    const focusable = element?.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable) {
      (focusable[0] as HTMLElement).focus();
    }
  }

  toggleFullScreen(event) {
    if (screenfull.enabled) {
      screenfull.toggle();
    }
  }

  goProfile() {
    this.router.navigate(['profile']);
  }

  goMultiCluster() {
    this.router.navigate(['multi-cluster']);
  }

  goFederatedPolicy() {
    this.router.navigate(['federated-policy']);
  }

  initMultiClusters() {
    if (this.isAuthReadConfig) {
      this.getClusterName();
    }

    if (this.isFedQueryAllowed) {
      this.getClusters();
    }
  }

  getClusterName() {
    this.multiClusterService.getClusterName('navbar').subscribe({
      next: clusterName => {
        this.clusterName = clusterName;
      },
      error: err => {
        this.clusterName = '';
        this.clusterNameError = true;
      },
    });
  }
  getClusters() {
    this.multiClusterService
      .getClusters()
      .pipe()
      .subscribe({
        next: (data: ClusterData) => {
          if (!data) {
            // Handle null data - set default values
            this.clusters = [];
            this.isMemberRole = false;
            this.isMasterRole = false;
            this.isStandaloneRole = true;
            GlobalVariable.isMaster = false;
            GlobalVariable.isMember = false;
            GlobalVariable.isStandAlone = true;
            return;
          }
          this.clusters = data.clusters || [];
          //get primary cluster's rest_version
          const primaryCluster = this.clusters.find(
            cluster =>
              cluster.clusterType === GlobalConstant.CLUSTER_TYPES.MASTER
          );
          this.primaryClusterRestVersion = primaryCluster
            ? primaryCluster.rest_version
            : '';
          this.multiClusterService.primaryClusterRestVersion =
            this.primaryClusterRestVersion;
          //init the cluster role
          this.isMemberRole = data.fed_role === MapConstant.FED_ROLES.MEMBER;
          this.isMasterRole = data.fed_role === MapConstant.FED_ROLES.MASTER;
          this.isStandaloneRole = data.fed_role === '';
          GlobalVariable.isMaster = this.isMasterRole;
          GlobalVariable.isMember = this.isMemberRole;
          GlobalVariable.isStandAlone = this.isStandaloneRole;

          const resource = {
            multiClusterOp: {
              global: 2,
            },
            manageAuth: {
              global: 3,
            },
            multiClusterView: {
              global: 1,
            },
          };

          this.isAllowedToRedirectMultiCluster =
            this.authUtilsService.getGlobalPermissionDisplayFlag(
              'multi_cluster'
            ) ||
            (isAuthorized(GlobalVariable.user.roles, resource.multiClusterOp) &&
              data.fed_role !== MapConstant.FED_ROLES.MASTER);

          //get the status of the chosen cluster
          const sessionCluster = this.localStorage.get(
            GlobalConstant.LOCAL_STORAGE_CLUSTER
          );
          const clusterInSession = sessionCluster
            ? JSON.parse(sessionCluster)
            : null;
          if (clusterInSession) {
            this.isOnRemoteCluster = clusterInSession.isRemote;
            GlobalVariable.isRemote = clusterInSession.isRemote;
          } else {
            GlobalVariable.isRemote = false;
          }

          if (GlobalVariable.isMaster) {
            this.isAllowedToOperateMultiCluster =
              isAuthorized(GlobalVariable.user.roles, resource.manageAuth) ||
              this.authUtilsService.getGlobalPermissionDisplayFlag(
                'multi_cluster'
              );
            if (clusterInSession !== null) {
              this.selectedCluster = clusterInSession;
            } else {
              this.selectedCluster = this.clusters.find(cluster => {
                return cluster.clusterType === MapConstant.FED_ROLES.MASTER;
              });
            }
          }

          if (GlobalVariable.isMember) {
            this.isAllowedToOperateMultiCluster =
              isAuthorized(
                GlobalVariable.user.roles,
                resource.multiClusterView
              ) ||
              this.authUtilsService.getGlobalPermissionDisplayFlag(
                'multi_cluster'
              );
            this.clusters.forEach(cluster => {
              if (cluster.clusterType === MapConstant.FED_ROLES.MASTER) {
                this.primaryMasterName = cluster.name;
              } else {
                this.managedClusterName = cluster.name;
              }
            });
          }
          this.multiClusterService.dispatchGetClustersFinishEvent();
        },
        error: error => {
          this.clustersError = true;
        },
      });
  }

  redirectCluster(cluster: Cluster) {
    const currentID = this.selectedCluster?.id;
    const selectedID = cluster.id;

    //early exit if the selected cluster is the same as the current one
    if (currentID === selectedID) return;

    //Determine new selected ID based on cluster type
    const newCurrentID =
      this.selectedCluster?.clusterType === MapConstant.FED_ROLES.MASTER
        ? ''
        : currentID;

    const selectedItem = this.clusters.find(
      clusterNode => clusterNode.id === cluster.id
    );

    const newSelectedID =
      selectedItem?.clusterType === MapConstant.FED_ROLES.MASTER
        ? ''
        : selectedID;

    // Function to handle successful cluster switch
    const handleSuccess = () => {
      this.selectedCluster = selectedItem;
      this.isOnRemoteCluster =
        this.selectedCluster?.clusterType !== MapConstant.FED_ROLES.MASTER;
      this.multiClusterService.refreshSummary();
      this.multiClusterService.dispatchSwitchEvent();

      // Save and restore the selected cluster
      GlobalVariable.isRemote = this.isOnRemoteCluster;
      const clusterData = {
        isRemote: this.isOnRemoteCluster,
        id: this.selectedCluster?.id,
        name: this.selectedCluster?.name,
      };
      this.localStorage.set(
        GlobalConstant.LOCAL_STORAGE_CLUSTER,
        JSON.stringify(clusterData)
      );
    };

    // Function to handle errors
    const handleError = (error: any) => {
      this.notificationService.openError(
        error,
        this.translateService.instant(
          'multiCluster.messages.redirect_failure',
          { name: cluster.name }
        )
      );
    };

    // Refresh the token to update the remote_global_permissions if necessary and switch cluster
    if (
      !(
        GlobalVariable.user?.remote_global_permissions &&
        GlobalVariable.user?.remote_global_permissions.length > 0
      ) ||
      !(
        GlobalVariable.user?.extra_permissions &&
        GlobalVariable.user?.extra_permissions.length > 0
      )
    ) {
      this.authService
        .refreshToken(
          GlobalVariable.window.location.href.includes(
            GlobalConstant.PROXY_VALUE
          )
        )
        .pipe(
          switchMap((userInfo: any) => {
            // Update global variables
            GlobalVariable.user = userInfo;
            GlobalVariable.nvToken = userInfo.token.token;
            GlobalVariable.isSUSESSO = userInfo.is_suse_authenticated;
            GlobalVariable.user.global_permissions =
              userInfo.token.global_permissions;
            GlobalVariable.user.remote_global_permissions =
              userInfo.token.remote_global_permissions;
            GlobalVariable.user.domain_permissions =
              userInfo.token.domain_permissions;
            GlobalVariable.user.extra_permissions =
              userInfo.token.extra_permissions;
            this.localStorage.set(
              GlobalConstant.LOCAL_STORAGE_TOKEN,
              GlobalVariable.user
            );

            // Perform the cluster switch
            return this.multiClusterService.switchCluster(
              newSelectedID,
              newCurrentID
            );
          })
        )
        .subscribe({
          next: handleSuccess,
          error: handleError,
        });
    } else {
      this.multiClusterService
        .switchCluster(newSelectedID, newCurrentID)
        .subscribe({
          next: handleSuccess,
          error: handleError,
        });
    }
  }

  retrieveCustomizedUIContent() {
    this._getRebrandCustomValuesSubscription = this.commonHttpService
      .getRebrandCustomValues()
      .subscribe(value => {
        if (value.customLoginLogo) {
          GlobalVariable.customLoginLogo = isValidBased64(value.customLoginLogo)
            ? atob(value.customLoginLogo)
            : value.customLoginLogo;
        }

        if (value.customPolicy) {
          GlobalVariable.customPolicy = isValidBased64(value.customPolicy)
            ? atob(value.customPolicy)
            : value.customPolicy;
        }

        if (value.customPageHeaderContent) {
          GlobalVariable.customPageHeaderContent = isValidBased64(
            value.customPageHeaderContent
          )
            ? atob(value.customPageHeaderContent)
            : value.customPageHeaderContent;
        }

        if (value.customPageHeaderColor) {
          GlobalVariable.customPageHeaderColor = isValidBased64(
            value.customPageHeaderColor
          )
            ? atob(value.customPageHeaderColor)
            : value.customPageHeaderColor;
        }

        if (value.customPageFooterContent) {
          GlobalVariable.customPageFooterContent = isValidBased64(
            value.customPageFooterContent
          )
            ? atob(value.customPageFooterContent)
            : value.customPageFooterContent;
        }

        if (value.customPageFooterColor) {
          GlobalVariable.customPageFooterColor = isValidBased64(
            value.customPageFooterColor
          )
            ? atob(value.customPageFooterColor)
            : value.customPageFooterColor;
        } else if (GlobalVariable.customPageHeaderColor) {
          GlobalVariable.customPageFooterColor =
            GlobalVariable.customPageHeaderColor;
        }

        this.authService.notifyEnvironmentVariablesRetrieved();
      });
  }

  logout() {
    this.router.navigate(['logout']);
  }
  reloadSSO() {
    let timeoutPath = this.localStorage.get(
      GlobalConstant.LOCAL_STORAGE_ORIGINAL_URL
    );
    this.localStorage.clear();
    if (timeoutPath)
      this.localStorage.set(
        GlobalConstant.LOCAL_STORAGE_ORIGINAL_URL,
        timeoutPath
      );
    GlobalVariable.user = null;
    GlobalVariable.sidebarDone = false;
    GlobalVariable.versionDone = false;
    GlobalVariable.isFooterReady = false;
    this.router.navigate(['login']);
  }

  private refreshRouteContext(): void {
    const currentUrl = this.router.url.split('?')[0];
    const matchedRoute =
      Object.keys(this.routeMeta).find(route => currentUrl.startsWith(route)) ||
      '/dashboard';
    const routeInfo = this.routeMeta[matchedRoute];
    this.pageTitle = this.translateService.instant(routeInfo.titleKey);
    this.pageCaption = routeInfo.captionKey
      ? this.translateService.instant(routeInfo.captionKey)
      : this.switchers.getAppSwitcher('description');
  }
}
