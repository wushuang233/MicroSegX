import {
  Component,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { MicrosegxHttpService } from '@common/api/microsegx-http.service';
import { GlobalConstant } from '@common/constants/global.constant';
import { NetworkRulesService } from '@common/services/network-rules.service';
import { UtilsService } from '@common/utils/app.utils';
import { MapConstant } from '@common/constants/map.constant';
import { PathConstant } from '@common/constants/path.constant';
import { GlobalVariable } from '@common/variables/global.variable';
import {
  MicrosegxAutoPolicyFeature,
  MicrosegxAutoPolicyRuleSummary,
  NetworkRule,
} from '@common/types';
import { GridOptions, GridApi } from 'ag-grid-community';
import { AuthUtilsService } from '@common/utils/auth.utils';
import { UpdateType } from '@common/types/network-rules/enum';
import { Subscription } from 'rxjs';
import { AddEditNetworkRuleModalComponent } from '@components/network-rules/partial/add-edit-network-rule-modal/add-edit-network-rule-modal.component';
import { MoveNetworkRulesModalComponent } from '@components/network-rules/partial/move-network-rules-modal/move-network-rules-modal.component';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmDialogComponent } from '@components/ui/confirm-dialog/confirm-dialog.component';
import { TranslateService } from '@ngx-translate/core';
import { DatePipe } from '@angular/common';
import { arrayToCsv } from '@common/utils/common.utils';
import { saveAs } from 'file-saver';
import { switchMap, filter } from 'rxjs/operators';
import { Router, NavigationStart } from '@angular/router';
import { GroupsService } from '@services/groups.service';
import { MultiClusterService } from '@services/multi-cluster.service';
import { Subject } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { NotificationService } from '@services/notification.service';
import { QuickFilterService } from '@components/quick-filter/quick-filter.service';
import * as $ from 'jquery';

const READONLY_RULE_MODIFIED = 46;
const UNPROMOTABLE_ENDPOINT_PATTERN = new RegExp(/^Host\:*|^Workload\:*/);
type RuleSourceFilter = 'all' | 'auto' | 'legacy' | 'legacy_preview' | 'user';

@Component({
  standalone: false,
  selector: 'app-network-rules',
  templateUrl: './network-rules.component.html',
  styleUrls: ['./network-rules.component.scss'],
})
export class NetworkRulesComponent implements OnInit, OnChanges, OnDestroy {
  @Input() isScoreImprovement: boolean = false;
  @Input() source!: string;
  @Input() groupName!: string;
  @Input() resizableHeight!: number;
  @Input() useQuickFilterService: boolean = false;

  refreshing$ = new Subject();
  navSource = GlobalConstant.NAV_SOURCE;
  eof = false;
  networkRuleErr = false;
  networkRules: Array<NetworkRule> = [];
  countOfGroundRule: number = 0;
  isWriteNetworkRuleAuthorized!: boolean;
  networkRuleOptions: any;
  gridOptions!: GridOptions;
  gridApi!: GridApi;
  gridHeight!: number;
  filtered: boolean = false;
  filteredCount: number = 0;
  selectedNetworkRules: Array<NetworkRule> = [];
  containsUnpromotableEndpoint: boolean = false;
  context = { componentParent: this };
  routeEventSubscription!: Subscription;
  isWriteGlobalRulesAuthorized: boolean = false;
  isPrinting: boolean = false;
  isIncludingCRD: boolean = false;
  isIncludingFed: boolean = false;
  readonlyNotificationMsgs: any;
  ruleCount: number = 0;
  ruleSourceFilter: RuleSourceFilter = 'all';
  autoClassFilter: 'all' | 'baseline' | 'periodic' | 'anomaly' = 'all';
  ruleSourceCounts = {
    all: 0,
    auto: 0,
    legacy: 0,
    legacyPreview: 0,
    user: 0,
  };
  autoRuleMap = new Map<number, MicrosegxAutoPolicyRuleSummary>();
  legacyPreviewRules: Array<NetworkRule> = [];
  selectedAutoRuleDetail: MicrosegxAutoPolicyRuleSummary | null = null;
  private w: any;
  private switchClusterSubscription;
  @ViewChild('networkRulePrintableReport') printableReportView!: ElementRef;
  @ViewChild('readonlyNotification') notificationTemplate;

  constructor(
    private networkRulesService: NetworkRulesService,
    private groupsService: GroupsService,
    private authUtilsService: AuthUtilsService,
    private dialog: MatDialog,
    private translate: TranslateService,
    private datePipe: DatePipe,
    private utils: UtilsService,
    private microsegxHttpService: MicrosegxHttpService,
    private multiClusterService: MultiClusterService,
    public router: Router,
    private quickFilterService: QuickFilterService,
    private notificationService: NotificationService
  ) {
    this.w = GlobalVariable.window;
  }

  ngOnInit(): void {
    this.isWriteGlobalRulesAuthorized =
      this.authUtilsService.getDisplayFlag('write_network_rule');
    this.bindRouteEventListener();
    this.gridHeight =
      this.w.innerHeight -
      (this.source === GlobalConstant.NAV_SOURCE.SELF ? 245 : 300);
    this.isWriteNetworkRuleAuthorized =
      this.authUtilsService.getDisplayFlag('write_network_rule') &&
      (this.source !== GlobalConstant.NAV_SOURCE.GROUP &&
      this.source !== GlobalConstant.NAV_SOURCE.SELF
        ? this.authUtilsService.getDisplayFlag('multi_cluster_w')
        : true);
    this.gridOptions = this.networkRulesService.configGrid(
      this.isWriteNetworkRuleAuthorized,
      this.source,
      this.isScoreImprovement
    );
    this.gridOptions.onGridReady = params => {
      const $win = $(GlobalVariable.window);
      if (params && params.api) {
        this.gridApi = params.api;
      }
      const fitGrid = () => {
        if (!params || !params.api) {
          return;
        }
        params.api.sizeColumnsToFit();
        params.api.refreshHeader();
        params.api.resetRowHeights();
      };
      setTimeout(() => {
        if (params && params.api) {
          if (this.useQuickFilterService) {
            this.quickFilterService.textInput$.subscribe((value: string) => {
              this.quickFilterService.onFilterChange(
                value,
                this.gridOptions,
                this.gridApi
              );
            });
          }
          fitGrid();
        }
      }, 300);
      $win.on(GlobalConstant.AG_GRID_RESIZE, () => {
        setTimeout(() => {
          fitGrid();
        }, 100);
      });
    };
    this.gridOptions.onSelectionChanged = () => {
      this.selectedNetworkRules = this.gridApi!.getSelectedRows();
      this.isIncludingCRD = this.selectedNetworkRules.some(rule => {
        return rule.cfg_type === GlobalConstant.CFG_TYPE.GROUND;
      });
      this.isIncludingFed = this.selectedNetworkRules.some(rule => {
        return (
          rule.cfg_type === GlobalConstant.CFG_TYPE.FED &&
          this.source === GlobalConstant.NAV_SOURCE.SELF
        );
      });
      this.containsUnpromotableEndpoint = this.selectedNetworkRules.some(
        rule => {
          return (
            UNPROMOTABLE_ENDPOINT_PATTERN.test(rule.from) ||
            UNPROMOTABLE_ENDPOINT_PATTERN.test(rule.to)
          );
        }
      );
      const selectedAutoRule = this.selectedNetworkRules.find(
        rule => rule.rule_source === 'auto'
      );
      if (selectedAutoRule?.id) {
        this.openAutoRuleDetail(selectedAutoRule.id);
      } else {
        this.selectedAutoRuleDetail = null;
      }
    };
    if (!this.isScoreImprovement) {
      this.networkRulesService.getAutoCompleteData(this.source).subscribe(
        ([groupList, hostList, appList]) => {
          this.networkRuleOptions = {
            groupList,
            hostList,
            appList,
          };
        },
        error => {
          console.error(error);
        }
      );
    }
    this.loadAutoPolicyRules();
    this.loadLegacyPreviewRules();
    this.refresh();

    //refresh the page when it switched to a remote cluster
    this.switchClusterSubscription =
      this.multiClusterService.onClusterSwitchedEvent$.subscribe(() => {
        this.refresh();
      });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (
      changes.groupName &&
      changes.groupName.previousValue &&
      changes.groupName.previousValue !== changes.groupName.currentValue
    ) {
      this.refresh();
    }
  }

  ngOnDestroy(): void {
    this.unbindRouteEventListener();

    if (this.switchClusterSubscription) {
      this.switchClusterSubscription.unsubscribe();
    }
  }

  autoPolicyClassLabel(value?: string): string {
    switch (
      String(value || '')
        .trim()
        .toLowerCase()
    ) {
      case 'baseline':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.CLASS_BASELINE');
      case 'periodic':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.CLASS_PERIODIC');
      case 'anomaly':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.CLASS_ANOMALY');
      default:
        return (
          value ||
          this.translate.instant('MICROSEGX.AUTO_POLICY.CLASS_OBSERVING')
        );
    }
  }

  autoPolicyCompileStateLabel(value?: string): string {
    switch (
      String(value || '')
        .trim()
        .toLowerCase()
    ) {
      case 'active':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.STATE_ACTIVE');
      case 'scheduled':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.STATE_SCHEDULED');
      case 'expired':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.STATE_EXPIRED');
      case 'inactive':
      case '':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.STATE_INACTIVE');
      default:
        return (
          value ||
          this.translate.instant('MICROSEGX.AUTO_POLICY.STATE_INACTIVE')
        );
    }
  }

  autoPolicyActionLabel(value?: string): string {
    switch (
      String(value || '')
        .trim()
        .toLowerCase()
    ) {
      case 'allow':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.ACTION_ALLOW');
      case 'deny':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.ACTION_DENY');
      default:
        return this.translate.instant('MICROSEGX.AUTO_POLICY.ACTION_OBSERVE');
    }
  }

  formatAutoPolicyTimestamp(timestamp?: number): string {
    if (!timestamp) {
      return '--';
    }

    return (
      this.datePipe.transform(timestamp * 1000, 'yyyy-MM-dd HH:mm:ss') || '--'
    );
  }

  refresh = () => {
    this.refreshing$.next(true);
    this.selectedNetworkRules = [];
    this.selectedAutoRuleDetail = null;
    if (!this.isScoreImprovement) {
      this.loadAutoPolicyRules();
      this.loadLegacyPreviewRules();
    }
    if (
      this.source === GlobalConstant.NAV_SOURCE.GROUP ||
      this.source === GlobalConstant.NAV_SOURCE.FED_GROUP
    ) {
      if (this.isScoreImprovement) this.getServiceRules();
      else this.getGroupPolicy();
    } else {
      this.getNetworkRules();
    }
  };

  filterCountChanged(results: number) {
    setTimeout(() => this.syncDisplayedRuleCount(results), 0);
  }

  applyRuleSourceFilter = (value: RuleSourceFilter) => {
    this.ruleSourceFilter = value;
    if (value !== 'auto') {
      this.autoClassFilter = 'all';
    }
    this.updateGridRowData();
  };

  applyAutoClassFilter = (
    value: 'all' | 'baseline' | 'periodic' | 'anomaly'
  ) => {
    this.autoClassFilter = value;
    this.updateGridRowData();
  };

  updateGridData = (
    updatedNetworkRules: Array<NetworkRule>,
    targetIndex: number,
    updateType: UpdateType,
    targetId: number = 0
  ) => {
    switch (updateType) {
      case UpdateType.AddToTop:
        this.insertRule(updatedNetworkRules[0], -1);
        break;
      case UpdateType.Insert:
        this.insertRule(updatedNetworkRules[0], targetIndex);
        break;
      case UpdateType.Edit:
        this.replaceRule(updatedNetworkRules[0], targetIndex);
        break;
      case UpdateType.MoveBefore:
        this.moveRules(updatedNetworkRules, targetId, updateType);
        break;
      case UpdateType.MoveAfter:
        this.moveRules(updatedNetworkRules, targetId, updateType);
        break;
    }
  };

  isNetworkRuleDirty = (): Boolean => {
    return this.networkRulesService.isNetworkRuleChanged;
  };

  addNetworkRuleToTop = () => {
    this.dialog.open(AddEditNetworkRuleModalComponent, {
      width: '80%',
      data: {
        opType: GlobalConstant.MODAL_OP.ADD,
        networkRuleOptions: this.networkRuleOptions,
        index: -1,
        source: this.source,
        cfgType:
          this.source === GlobalConstant.NAV_SOURCE.FED_POLICY
            ? GlobalConstant.SCOPE.FED
            : GlobalConstant.SCOPE.LOCAL,
        updateGridData: this.updateGridData,
      },
    });
  };

  openMoveNetworkRulesModal = () => {
    this.dialog.open(MoveNetworkRulesModalComponent, {
      width: '450px',
      data: {
        selectedNetworkRules: this.selectedNetworkRules,
        networkRules: this.networkRules,
        updateGridData: this.updateGridData,
      },
    });
  };

  promoteRuleOnTop = () => {
    let payload = {
      request: {
        ids: this.selectedNetworkRules.map(rule => rule.id),
      },
    };
    this.networkRulesService.promoteNetworkRulesData(payload).subscribe(
      () => {
        this.notificationService.open(
          this.translate.instant('policy.message.PROMOTE_OK')
        );
        setTimeout(() => {
          this.refresh();
        }, 2000);
      },
      error => {
        this.notificationService.openError(
          error.error,
          this.translate.instant('policy.message.PROMOTE_NG')
        );
      }
    );
  };

  removeNetworkRules = () => {
    let ids = this.selectedNetworkRules
      .map(rule => rule.id)
      .filter(id => id !== -1);
    let idsMsg = ids.map(id => {
      return id >= GlobalConstant.NEW_ID_SEED.NETWORK_RULE
        ? `New-${id - GlobalConstant.NEW_ID_SEED.NETWORK_RULE + 1}`
        : id;
    });
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      maxWidth: '700px',
      data: {
        message: `${this.translate.instant(
          'policy.dialog.REMOVE'
        )} ${idsMsg.join(', ')}`,
        isSync: true,
      },
    });
    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.maskingDeletedRows(ids);
      }
    });
  };

  private getServiceRules = () => {
    let httpService = '';
    if (this.groupName === 'nodes') {
      httpService = 'getGroupInfo';
    } else {
      httpService = 'getService';
    }
    this.groupsService[httpService](this.groupName)
      .pipe(finalize(() => this.refreshing$.next(false)))
      .subscribe({
        next: service => {
          this.ruleCount = this.countDisplayRules(service.policy_rules);
          this.filteredCount = this.ruleCount;
          this.filtered = false;
          this.gridApi!.setGridOption('rowData', service.policy_rules);
        },
        error: err => {
          console.warn(err);
          if (err.status !== GlobalConstant.STATUS_NOT_FOUND) {
            this.gridOptions.overlayNoRowsTemplate =
              this.utils.getOverlayTemplateMsg(err);
          }
          this.ruleCount = 0;
          this.filteredCount = 0;
          this.filtered = false;
          this.gridApi!.setGridOption('rowData', []);
        },
      });
  };

  private getGroupPolicy = () => {
    this.groupsService
      .getGroupInfo(this.groupName)
      .pipe(finalize(() => this.refreshing$.next(false)))
      .subscribe(
        (response: any) => {
          this.ruleCount = this.countDisplayRules(response.policy_rules);
          this.filteredCount = this.ruleCount;
          this.filtered = false;
          this.gridApi!.setGridOption('rowData', response.policy_rules);
        },
        error => {
          console.error(error);
        }
      );
  };

  private getNetworkRules = () => {
    this.eof = false;
    this.networkRulesService.isNetworkRuleChanged = false;
    this.networkRuleErr = false;
    this.networkRules = [];
    this.createRuleWorker();
    this.utils.loadPagedData(
      PathConstant.POLICY_URL,
      this.source === GlobalConstant.NAV_SOURCE.FED_POLICY
        ? {
            start: 0,
            limit: MapConstant.PAGE.NETWORK_RULES,
            scope: GlobalConstant.SCOPE.FED,
          }
        : {
            start: 0,
            limit: MapConstant.PAGE.NETWORK_RULES,
          },
      null,
      this.mergeRulesByWebWorkerClient,
      this.handleError
    );
  };

  submit = () => {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      maxWidth: '700px',
      data: {
        message: this.translate.instant('policy.POLICY_DEPLOY_CONFIRM'),
      },
    });
    // listen to confirm subject
    dialogRef.componentInstance.confirm
      .pipe(
        switchMap(() => {
          return this.networkRulesService.submitNetworkRule(
            this.networkRules,
            this.source
          );
        })
      )
      .subscribe(
        res => {
          console.log(res);
          this.notificationService.open(
            this.translate.instant('policy.dialog.content.SUBMIT_OK')
          );
          // close dialog
          dialogRef.componentInstance.onCancel();
          dialogRef.componentInstance.loading = false;
          // confirm actions
          setTimeout(() => {
            this.gridApi!.deselectAll();
            this.networkRulesService.squence =
              GlobalConstant.NEW_ID_SEED.NETWORK_RULE;
            this.getNetworkRules();
          }, 2000);
        },
        error => {
          console.log('error', error);
          if (!MapConstant.USER_TIMEOUT.includes(error.status)) {
            if (
              error.status === 400 &&
              error.error &&
              error.error.code === READONLY_RULE_MODIFIED
            ) {
              this.notificationService.open(
                `${this.utils.getAlertifyMsg(
                  error,
                  this.translate.instant('policy.dialog.content.SUBMIT_NG'),
                  false
                )} -
                Read-only rule ID is: ${error.error.read_only_rule_ids.join(
                  ', '
                )}.\n
                You can click revert button on the rule to rollback your change.`,
                GlobalConstant.NOTIFICATION_TYPE.ERROR
              );
              // this.readonlyNotificationMsgs =
              //   `${this.utils.getAlertifyMsg(error, this.translate.instant("policy.dialog.content.SUBMIT_NG"), false)}<br/>
              //   Read-only rule ID is: ${error.error.read_only_rule_ids.join(", ")}<br/>
              //   You can click revert button on the rule to rollback your change.`;
              // this.notificationService.openHtmlError(this.readonlyNotificationMsgs, this.notificationTemplate);
              this.changeState4ReadOnlyRules(error.error.read_only_rule_ids);
            } else {
              this.notificationService.openError(
                error.error,
                this.translate.instant('policy.dialog.content.SUBMIT_NG')
              );
            }
            dialogRef.componentInstance.onCancel();
            dialogRef.componentInstance.loading = false;
          }
        }
      );
  };

  exportCsv = () => {
    let reportData: Array<any> = [];
    this.gridApi!.forEachNodeAfterFilterAndSort((node, index) => {
      if (node.data.id > 0) {
        reportData.push({
          sequence: index + 1,
          id: node.data.id,
          comment: node.data.comment,
          from: node.data.from,
          to: node.data.to,
          applications: node.data.applications,
          ports: node.data.ports,
          action: node.data.action,
          type: MapConstant.DISPLAY_CFG_TYPE_MAP[
            node.data.cfg_type.toLowerCase()
          ],
          status: node.data.disable ? 'disabled' : 'enabled',
          updated_at: this.datePipe.transform(
            node.data.last_modified_timestamp * 1000,
            'yyyy-MM-dd HH:mm:ss'
          ),
        });
      }
    });

    let csv = arrayToCsv(reportData);
    let blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    saveAs(
      blob,
      `Network_rules_Reports_${this.utils.parseDatetimeStr(new Date())}.csv`
    );
  };

  print = () => {
    this.isPrinting = true;
    setInterval(() => {
      if (this.printableReportView) {
        window.print();
        this.isPrinting = false;
      }
    }, 500);
  };

  private createRuleWorker = () => {};

  private loadAutoPolicyRules = () => {
    this.microsegxHttpService.getAutoPolicyRules().subscribe({
      next: response => {
        this.autoRuleMap = new Map(
          (response.rules || []).map(rule => [rule.id, rule])
        );
        this.networkRules = this.decorateNetworkRules(this.networkRules);
        this.updateGridRowData();
      },
      error: () => {
        this.autoRuleMap = new Map();
        this.networkRules = this.decorateNetworkRules(this.networkRules);
        this.updateGridRowData();
      },
    });
  };

  private loadLegacyPreviewRules = () => {
    this.microsegxHttpService.getAutoPolicyFeatures().subscribe({
      next: response => {
        this.legacyPreviewRules = this.buildLegacyPreviewRules(
          response.features || []
        );
        this.updateGridRowData();
      },
      error: () => {
        this.legacyPreviewRules = [];
        this.updateGridRowData();
      },
    });
  };

  private openAutoRuleDetail = (id: number) => {
    this.microsegxHttpService.getAutoPolicyRuleDetail(id).subscribe({
      next: response => {
        this.selectedAutoRuleDetail = response.rule;
      },
      error: () => {
        this.selectedAutoRuleDetail = null;
      },
    });
  };

  private decorateNetworkRules = (rules: Array<NetworkRule>) => {
    return (rules || []).map(rule => {
      if (!rule || rule.id <= 0) {
        return rule;
      }
      const autoRule = this.autoRuleMap.get(rule.id);
      const isLegacyLearned =
        !!rule.learned ||
        String(rule.cfg_type || '').toLowerCase() ===
          GlobalConstant.CFG_TYPE.LEARNED;
      return {
        ...rule,
        rule_source: autoRule ? 'auto' : isLegacyLearned ? 'legacy' : 'user',
        auto_policy_class: autoRule?.class || '',
        auto_policy_confidence: autoRule?.confidence || 0,
        auto_policy_active: autoRule?.active_now || false,
        auto_policy_last_observed_timestamp:
          autoRule?.last_observed_timestamp || 0,
        auto_policy_expires_timestamp: autoRule?.expires_timestamp || 0,
        auto_policy_periodic_slots: autoRule?.periodic_slots || [],
        auto_policy_reason_codes: autoRule?.reason_codes || [],
      };
    });
  };

  private buildLegacyPreviewRules = (
    features: Array<MicrosegxAutoPolicyFeature>
  ): Array<NetworkRule> => {
    const seen = new Set<string>();
    const previewRules: Array<NetworkRule> = [];
    const sortedFeatures = [...(features || [])].sort((left, right) => {
      return (right.last_seen_timestamp || 0) - (left.last_seen_timestamp || 0);
    });

    sortedFeatures.forEach(feature => {
      if (!feature || !feature.from || !feature.to) {
        return;
      }

      const ports = (feature.ports || [])
        .map(port => String(port || '').trim())
        .filter(port => !!port)
        .join(',');
      const applications =
        feature.is_app && feature.application ? [`${feature.application}`] : [];
      const key = [
        feature.from,
        feature.to,
        feature.is_app ? `app:${feature.application || ''}` : `ports:${ports}`,
      ].join('|');
      if (seen.has(key)) {
        return;
      }
      seen.add(key);

      previewRules.push({
        id: -100000 - previewRules.length,
        comment: this.translate.instant(
          'MICROSEGX.AUTO_POLICY.LEGACY_PREVIEW_COMMENT'
        ),
        from: feature.from,
        to: feature.to,
        applications,
        ports: ports || 'any',
        action: 'allow',
        cfg_type: GlobalConstant.CFG_TYPE.LEARNED,
        disable: true,
        created_timestamp: feature.last_seen_timestamp || 0,
        last_modified_timestamp: feature.last_seen_timestamp || 0,
        learned: true,
        priority: 0,
        match_counter: feature.historical_windows || 0,
        last_match_timestamp: feature.last_seen_timestamp || 0,
        state: GlobalConstant.NETWORK_RULES_STATE.READONLY,
        rule_source: 'legacy_preview',
        legacy_preview: true,
      });
    });

    return previewRules;
  };

  private getGridRules = (): Array<NetworkRule> => {
    return [...this.networkRules, ...this.legacyPreviewRules];
  };

  private getFilteredRules = (rules: Array<NetworkRule>) => {
    return (rules || []).filter(rule => {
      if (!rule || rule.id === -1) {
        return true;
      }
      if (this.ruleSourceFilter === 'all') {
        return rule.rule_source !== 'legacy_preview';
      }
      if (this.ruleSourceFilter === 'auto' && rule.rule_source !== 'auto') {
        return false;
      }
      if (this.ruleSourceFilter === 'legacy' && rule.rule_source !== 'legacy') {
        return false;
      }
      if (
        this.ruleSourceFilter === 'legacy_preview' &&
        rule.rule_source !== 'legacy_preview'
      ) {
        return false;
      }
      if (this.ruleSourceFilter === 'user' && rule.rule_source !== 'user') {
        return false;
      }
      if (
        this.ruleSourceFilter === 'auto' &&
        this.autoClassFilter !== 'all' &&
        rule.auto_policy_class !== this.autoClassFilter
      ) {
        return false;
      }
      return true;
    });
  };

  private updateGridRowData = () => {
    if (!this.gridApi) {
      return;
    }
    const gridRules = this.getGridRules();
    this.updateRuleSourceCounts(gridRules);
    const filteredRules = this.getFilteredRules(gridRules);
    this.ruleCount = this.countDisplayRules(filteredRules);
    this.filteredCount = this.ruleCount;
    this.filtered = false;
    this.gridApi.setGridOption('rowData', filteredRules);
    setTimeout(() => this.syncDisplayedRuleCount(), 0);
  };

  private countDisplayRules = (rules: Array<NetworkRule>) => {
    return (rules || []).filter(rule => rule && rule.id !== -1).length;
  };

  private updateRuleSourceCounts = (rules: Array<NetworkRule>) => {
    const counts = {
      all: 0,
      auto: 0,
      legacy: 0,
      legacyPreview: 0,
      user: 0,
    };
    (rules || []).forEach(rule => {
      if (!rule || rule.id === -1) {
        return;
      }
      if (rule.rule_source === 'auto') {
        counts.all++;
        counts.auto++;
      } else if (rule.rule_source === 'legacy') {
        counts.all++;
        counts.legacy++;
      } else if (rule.rule_source === 'legacy_preview') {
        counts.legacyPreview++;
      } else {
        counts.all++;
        counts.user++;
      }
    });
    this.ruleSourceCounts = counts;
    if (this.ruleSourceFilter === 'legacy' && counts.legacy === 0) {
      this.ruleSourceFilter = 'all';
    }
  };

  private countVisibleGridRules = () => {
    if (!this.gridApi) {
      return this.ruleCount;
    }

    let count = 0;
    this.gridApi.forEachNodeAfterFilter(node => {
      if (node.data && node.data.id !== -1) {
        count++;
      }
    });
    return count;
  };

  private syncDisplayedRuleCount = (fallback?: number) => {
    const sourceFilteredCount = this.countDisplayRules(
      this.getFilteredRules(this.getGridRules())
    );
    const visibleCount = this.gridApi
      ? this.countVisibleGridRules()
      : Math.max(0, Number(fallback || sourceFilteredCount));
    this.ruleCount = sourceFilteredCount;
    this.filteredCount = visibleCount;
    this.filtered = visibleCount !== sourceFilteredCount;
  };

  private changeState4ReadOnlyRules = readOnlyruleIds => {
    readOnlyruleIds.forEach(readOnlyruleId => {
      let index = this.networkRules.findIndex(
        rule => rule.id === readOnlyruleId
      );
      this.networkRules[index].state =
        GlobalConstant.NETWORK_RULES_STATE.READONLY;
    });
    console.log('this.networkRules', this.networkRules);
    this.updateGridRowData();
  };

  private mergeRulesByWebWorkerClient = (rulesBlock: Array<any>) => {
    let eof = rulesBlock.length < MapConstant.PAGE.NETWORK_RULES;
    this.networkRules = this.decorateNetworkRules(
      this.networkRules.concat(rulesBlock)
    );
    this.networkRulesService.networkRuleBackup = JSON.parse(
      JSON.stringify(this.networkRules)
    );
    this.renderNetworkRule(this.networkRules, eof);
  };

  private handleError = () => {
    this.networkRuleErr = true;
    this.renderNetworkRule([], true);
  };

  private renderNetworkRule = (networkRules, eof) => {
    this.eof = eof;
    if (networkRules.some(row => row.id === -1)) {
      networkRules.pop();
    }
    if (this.eof) {
      networkRules.push({
        id: -1,
        from: this.translate.instant('policy.DEFAULT_RULE'),
        to: '',
        application: [],
        ports: '',
        action: '',
        last_modified_timestamp: '',
      });
    }
    this.networkRules = this.decorateNetworkRules(networkRules);
    this.updateGridRowData();
    if (this.eof) this.refreshing$.next(false);
  };

  private insertRule = (
    updatedNetworkRule: NetworkRule,
    targetIndex: number
  ) => {
    this.networkRules.splice(targetIndex, 0, updatedNetworkRule);
    this.networkRules = this.decorateNetworkRules(this.networkRules);
    this.networkRulesService.isNetworkRuleChanged = true;
    setTimeout(() => {
      this.updateGridRowData();
      // this.gridApi!.redrawRows();
      this.gridApi!.ensureIndexVisible(targetIndex, 'top');
    }, 500);
  };

  private replaceRule = (
    updatedNetworkRule: NetworkRule,
    targetIndex: number
  ) => {
    this.networkRules.splice(targetIndex, 1, updatedNetworkRule);
    this.networkRules = this.decorateNetworkRules(this.networkRules);
    this.updateGridRowData();
    this.networkRulesService.isNetworkRuleChanged = true;
    setTimeout(() => {
      this.gridApi!.ensureIndexVisible(targetIndex, 'top');
    }, 500);
  };

  private moveRules = (
    selectedNetworkRules: Array<NetworkRule>,
    targetId: number,
    moveType: UpdateType
  ) => {
    let selectedRuleId = selectedNetworkRules.map(rule => rule.id);
    let networkRulesTmp = this.networkRules.filter(rule => {
      return !selectedRuleId.includes(rule.id);
    });
    let targetIndex = networkRulesTmp.findIndex(rule => rule.id === targetId);
    if (moveType === UpdateType.MoveBefore) {
      networkRulesTmp.splice(targetIndex, 0, ...selectedNetworkRules);
    } else {
      networkRulesTmp.splice(targetIndex + 1, 0, ...selectedNetworkRules);
    }
    this.networkRules = networkRulesTmp;
    this.updateGridRowData();
    // this.gridApi!.redrawRows();
    this.networkRulesService.isNetworkRuleChanged = true;
    this.selectedNetworkRules = [];
  };

  private maskingDeletedRows = (ids: Array<number>) => {
    const idSet = new Set(ids);
    this.networkRules = this.networkRules.map(rule => {
      if (idSet.has(rule.id) && rule.id !== -1) {
        rule.remove = true;
      }
      return rule;
    });
    this.updateGridRowData();
    // this.gridApi!.redrawRows();
    this.networkRulesService.isNetworkRuleChanged = true;
  };

  private bindRouteEventListener = () => {
    const currentRoute = this.router.routerState;
    if (!this.routeEventSubscription) {
      this.routeEventSubscription = this.router.events
        .pipe(
          filter((event): event is NavigationStart => {
            return (
              event instanceof NavigationStart &&
              `#${currentRoute.snapshot.url}` === location.hash
            );
          })
        )
        .subscribe(() => {
          if (
            this.isNetworkRuleDirty() &&
            !confirm(this.translate.instant('policy.dialog.reminder.MESSAGE'))
          ) {
            this.router.navigateByUrl(currentRoute.snapshot.url, {
              skipLocationChange: true,
            });
          }
        });
    }
  };

  private unbindRouteEventListener = () => {
    this.routeEventSubscription.unsubscribe();
  };
}
