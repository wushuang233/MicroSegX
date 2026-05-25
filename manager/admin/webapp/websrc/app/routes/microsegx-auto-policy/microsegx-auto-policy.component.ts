import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { MicrosegxHttpService } from '@common/api/microsegx-http.service';
import {
  MicrosegxAutoPolicyEvent,
  MicrosegxAutoPolicyEditableClass,
  MicrosegxAutoPolicyFeature,
  MicrosegxAutoPolicyRuleSummary,
  MicrosegxAutoPolicyStatus,
} from '@common/types';
import { TranslateService } from '@ngx-translate/core';
import { forkJoin, of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

type AutoPolicyMode = 'legacy' | 'shadow' | 'enforce';

interface AutoPolicyEndpointOption {
  key: string;
  label: string;
  namespace: string;
  workload: string;
  group: string;
}

interface AutoPolicyEditForm {
  class: MicrosegxAutoPolicyEditableClass;
  from: string;
  to: string;
  ports: string;
  confidence: number;
  periodicDays: number[];
  periodicStartTime: string;
  periodicEndTime: string;
  periodicRanges: AutoPolicyTimeRange[];
  periodicSchedules: AutoPolicyScheduleBlock[];
  ttlMinutes: number;
  reason: string;
}

interface AutoPolicyPeriodicOption {
  value: number;
  label: string;
}

interface AutoPolicyLocalSlotWindow {
  day: number;
  startMinutes: number;
  endMinutes: number;
}

interface AutoPolicyTimeRange {
  startTime: string;
  endTime: string;
}

interface AutoPolicyScheduleBlock {
  days: number[];
  ranges: AutoPolicyTimeRange[];
}

interface AutoPolicySlotRange {
  day: number;
  startMinutes: number;
  endMinutes: number;
}

@Component({
  standalone: false,
  selector: 'app-microsegx-auto-policy',
  templateUrl: './microsegx-auto-policy.component.html',
  styleUrls: ['./microsegx-auto-policy.component.scss'],
})
export class MicrosegxAutoPolicyComponent implements OnInit, OnDestroy {
  private readonly autoRefreshIntervalMs = 30000;
  private readonly featureRenderLimit = 200;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private refreshInFlight = false;

  loading = false;
  modeSaving = false;
  error = '';

  status: MicrosegxAutoPolicyStatus | null = null;
  modeControl: AutoPolicyMode = 'shadow';
  rules: MicrosegxAutoPolicyRuleSummary[] = [];
  features: MicrosegxAutoPolicyFeature[] = [];
  events: MicrosegxAutoPolicyEvent[] = [];
  private filteredRulesCache: MicrosegxAutoPolicyRuleSummary[] = [];
  private pagedRulesCache: MicrosegxAutoPolicyRuleSummary[] = [];
  private filteredFeaturesCache: MicrosegxAutoPolicyFeature[] = [];
  private visibleFeaturesCache: MicrosegxAutoPolicyFeature[] = [];
  private visibleEventsCache: MicrosegxAutoPolicyEvent[] = [];
  private ruleNamespaceOptionsCache: string[] = [];
  private ruleEndpointOptionsCache: AutoPolicyEndpointOption[] = [];
  private featureNamespaceOptionsCache: string[] = [];
  private featureEndpointOptionsCache: AutoPolicyEndpointOption[] = [];
  private createEndpointOptionsCache: AutoPolicyEndpointOption[] = [];
  private trafficSourceOptionsCache: string[] = [];
  private rulePageCountCache = 1;
  private rulePageStartCache = 0;
  private rulePageEndCache = 0;
  private featurePageCountCache = 1;
  private featurePageStartCache = 0;
  private featurePageEndCache = 0;
  private currentPageAllSelectedCache = false;
  private hasObservedCandidatesCache = false;
  @ViewChild('autoPolicyEditDialog')
  private autoPolicyEditDialog?: ElementRef<HTMLDialogElement>;

  activeTabIndex = 0;
  searchText = '';
  ruleClassFilter = 'all';
  ruleNamespaceFilter: string[] = [];
  ruleEndpointFilter: string[] = [];
  ruleTrafficSourceFilter = 'all';
  ruleRuntimeFilter = 'all';
  featureStageFilter = 'all';
  featureClassFilter = 'all';
  featureNamespaceFilter: string[] = [];
  featureEndpointFilter: string[] = [];
  featureTrafficSourceFilter = 'all';
  rulePageIndex = 0;
  readonly rulePageSize = 20;
  featurePageIndex = 0;
  readonly featurePageSize = 30;
  selectedRuleIds = new Set<number>();
  deletingRules = false;

  selectedRuleId: number | null = null;
  selectedRuleDetail: MicrosegxAutoPolicyRuleSummary | null = null;
  selectedFeatureKey = '';
  selectedFeature: MicrosegxAutoPolicyFeature | null = null;
  detailMode: 'rule' | 'feature' | 'empty' = 'empty';
  editingRule: MicrosegxAutoPolicyRuleSummary | null = null;
  creatingRule = false;
  editForm: AutoPolicyEditForm = this.defaultEditForm();
  editSaving = false;
  editError = '';

  constructor(
    private microsegxHttpService: MicrosegxHttpService,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.refresh();
    this.refreshTimer = setInterval(
      () => this.refresh(false),
      this.autoRefreshIntervalMs
    );
  }

  ngOnDestroy(): void {
    this.closeNativeEditDialog();
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  get totalAutoRules(): number {
    if (!this.status) {
      return this.rules.length;
    }
    return (
      (this.status.baseline_rule_count || 0) +
      (this.status.periodic_rule_count || 0) +
      (this.status.anomaly_rule_count || 0)
    );
  }

  get latestChangeSummary(): string {
    if (!this.status) {
      return '';
    }
    return this.translate.instant(
      'MICROSEGX.AUTO_POLICY.LATEST_CHANGE_SUMMARY',
      {
        promotion: this.status.promotion_count || 0,
        delete: this.status.delete_count || 0,
      }
    );
  }

  get filteredRules(): MicrosegxAutoPolicyRuleSummary[] {
    return this.filteredRulesCache;
  }

  get pagedRules(): MicrosegxAutoPolicyRuleSummary[] {
    return this.pagedRulesCache;
  }

  get rulePageCount(): number {
    return this.rulePageCountCache;
  }

  get rulePageStart(): number {
    return this.rulePageStartCache;
  }

  get rulePageEnd(): number {
    return this.rulePageEndCache;
  }

  get ruleNamespaceOptions(): string[] {
    return this.ruleNamespaceOptionsCache;
  }

  get ruleEndpointOptions(): AutoPolicyEndpointOption[] {
    return this.ruleEndpointOptionsCache;
  }

  get featureNamespaceOptions(): string[] {
    return this.featureNamespaceOptionsCache;
  }

  get featureEndpointOptions(): AutoPolicyEndpointOption[] {
    return this.featureEndpointOptionsCache;
  }

  get createEndpointOptions(): AutoPolicyEndpointOption[] {
    return this.createEndpointOptionsCache;
  }

  get trafficSourceOptions(): string[] {
    return this.trafficSourceOptionsCache;
  }

  get selectedRuleCount(): number {
    return this.selectedRuleIds.size;
  }

  get currentPageAllSelected(): boolean {
    return this.currentPageAllSelectedCache;
  }

  get filteredFeatures(): MicrosegxAutoPolicyFeature[] {
    return this.filteredFeaturesCache;
  }

  get visibleFeatures(): MicrosegxAutoPolicyFeature[] {
    return this.visibleFeaturesCache;
  }

  get featurePageCount(): number {
    return this.featurePageCountCache;
  }

  get featurePageStart(): number {
    return this.featurePageStartCache;
  }

  get featurePageEnd(): number {
    return this.featurePageEndCache;
  }

  get visibleEvents(): MicrosegxAutoPolicyEvent[] {
    return this.visibleEventsCache;
  }

  get protectModeActive(): boolean {
    return this.modeControl === 'enforce';
  }

  get hasObservedCandidates(): boolean {
    return this.hasObservedCandidatesCache;
  }

  private computeFilteredRules(): MicrosegxAutoPolicyRuleSummary[] {
    const search = this.searchText.trim().toLowerCase();
    return this.rules.filter(rule => {
      if (
        this.ruleClassFilter !== 'all' &&
        rule.class !== this.ruleClassFilter
      ) {
        return false;
      }
      if (!this.matchesNamespaceFilter(rule, this.ruleNamespaceFilter)) {
        return false;
      }
      if (!this.matchesEndpointFilter(rule, this.ruleEndpointFilter)) {
        return false;
      }
      if (
        this.ruleTrafficSourceFilter !== 'all' &&
        this.trafficSourceValue(rule) !== this.ruleTrafficSourceFilter
      ) {
        return false;
      }
      if (this.ruleRuntimeFilter === 'stale' && !rule.stale) {
        return false;
      }
      if (this.ruleRuntimeFilter === 'live' && rule.stale) {
        return false;
      }
      if (!search) {
        return true;
      }
      const haystack = [
        rule.class,
        rule.rule?.from,
        rule.rule?.to,
        rule.rule?.action,
        rule.rule?.ports,
        rule.display_key,
        rule.namespace,
        rule.business,
        this.trafficSourceLabel(rule.traffic_source),
        this.ruleSourceLabel(rule),
        this.ruleRuntimeLabel(rule),
        ...this.endpointSearchTerms(rule),
        ...(rule.rule?.applications || []),
        ...(rule.reason_codes || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(search);
    });
  }

  private buildTrafficSourceOptions(): string[] {
    const values = new Set<string>([
      'direct',
      'ingress',
      'zero_trust',
      'system',
    ]);
    this.rules.forEach(rule => values.add(this.trafficSourceValue(rule)));
    this.features.forEach(feature =>
      values.add(this.trafficSourceValue(feature))
    );
    return Array.from(values).filter(Boolean);
  }

  private computeFilteredFeatures(): MicrosegxAutoPolicyFeature[] {
    const search = this.searchText.trim().toLowerCase();
    return this.features.filter(feature => {
      if (
        this.featureStageFilter !== 'all' &&
        feature.stage !== this.featureStageFilter
      ) {
        return false;
      }
      if (
        this.featureClassFilter !== 'all' &&
        (feature.class_hint || '') !== this.featureClassFilter
      ) {
        return false;
      }
      if (!this.matchesNamespaceFilter(feature, this.featureNamespaceFilter)) {
        return false;
      }
      if (!this.matchesEndpointFilter(feature, this.featureEndpointFilter)) {
        return false;
      }
      if (
        this.featureTrafficSourceFilter !== 'all' &&
        this.trafficSourceValue(feature) !== this.featureTrafficSourceFilter
      ) {
        return false;
      }
      if (!search) {
        return true;
      }
      const haystack = [
        feature.feature_key,
        feature.display_key,
        feature.from,
        feature.to,
        feature.namespace,
        feature.business,
        this.trafficSourceLabel(feature.traffic_source),
        ...this.endpointSearchTerms(feature),
        feature.action_hint,
        feature.class_hint,
        ...(feature.ports || []),
        ...(feature.fqdns || []),
        ...(feature.reason_codes || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(search);
    });
  }

  private rebuildDerivedState(): void {
    this.ruleNamespaceOptionsCache = this.namespaceOptions(this.rules);
    this.ruleEndpointOptionsCache = this.endpointOptions(
      this.rules,
      this.ruleNamespaceFilter
    );
    this.featureNamespaceOptionsCache = this.namespaceOptions(this.features);
    this.featureEndpointOptionsCache = this.endpointOptions(
      this.features,
      this.featureNamespaceFilter
    );
    this.createEndpointOptionsCache = this.endpointOptions([
      ...this.rules,
      ...this.features,
    ]);
    this.trafficSourceOptionsCache = this.buildTrafficSourceOptions();

    this.filteredRulesCache = this.computeFilteredRules();
    this.rulePageCountCache = Math.max(
      1,
      Math.ceil(this.filteredRulesCache.length / this.rulePageSize)
    );
    this.rulePageIndex = Math.min(
      Math.max(0, this.rulePageIndex),
      this.rulePageCountCache - 1
    );
    const rulePageStartIndex = this.rulePageIndex * this.rulePageSize;
    this.pagedRulesCache = this.filteredRulesCache.slice(
      rulePageStartIndex,
      rulePageStartIndex + this.rulePageSize
    );
    this.rulePageStartCache =
      this.filteredRulesCache.length === 0 ? 0 : rulePageStartIndex + 1;
    this.rulePageEndCache = Math.min(
      this.filteredRulesCache.length,
      rulePageStartIndex + this.rulePageSize
    );

    this.filteredFeaturesCache = this.computeFilteredFeatures();
    this.featurePageCountCache = Math.max(
      1,
      Math.ceil(this.filteredFeaturesCache.length / this.featurePageSize)
    );
    this.featurePageIndex = Math.min(
      Math.max(0, this.featurePageIndex),
      this.featurePageCountCache - 1
    );
    const featurePageStartIndex = this.featurePageIndex * this.featurePageSize;
    this.visibleFeaturesCache = this.filteredFeaturesCache.slice(
      featurePageStartIndex,
      featurePageStartIndex +
        Math.min(this.featurePageSize, this.featureRenderLimit)
    );
    this.featurePageStartCache =
      this.filteredFeaturesCache.length === 0 ? 0 : featurePageStartIndex + 1;
    this.featurePageEndCache = Math.min(
      this.filteredFeaturesCache.length,
      featurePageStartIndex + this.featurePageSize
    );
    this.visibleEventsCache = this.events.slice(0, 20);
    this.hasObservedCandidatesCache =
      this.filteredFeaturesCache.length > 0 || this.features.length > 0;
    this.refreshSelectionState();
  }

  private refreshSelectionState(): void {
    this.currentPageAllSelectedCache =
      this.pagedRulesCache.length > 0 &&
      this.pagedRulesCache.every(rule => this.selectedRuleIds.has(rule.id));
  }

  refresh(resetSelection: boolean = true): void {
    if (this.refreshInFlight) {
      return;
    }

    this.refreshInFlight = true;
    if (resetSelection || !this.status) {
      this.loading = true;
    }
    this.error = '';

    forkJoin({
      status: this.microsegxHttpService.getAutoPolicyStatus(),
      rules: this.microsegxHttpService
        .getAutoPolicyRules()
        .pipe(catchError(() => of({ rules: [] }))),
      features: this.microsegxHttpService
        .getAutoPolicyFeatures()
        .pipe(catchError(() => of({ features: [] }))),
      events: this.microsegxHttpService
        .getAutoPolicyEvents()
        .pipe(catchError(() => of({ events: [] }))),
    })
      .pipe(
        finalize(() => {
          this.refreshInFlight = false;
          this.loading = false;
        })
      )
      .subscribe({
        next: data => {
          this.status = data.status.status;
          if (!this.modeSaving && this.status?.mode) {
            this.modeControl = this.normalizeMode(this.status.mode);
          }
          this.rules = data.rules.rules || [];
          this.features = this.deduplicateFeatures(
            data.features.features || []
          );
          this.events = data.events.events || [];
          this.pruneSelectedRuleIds();
          this.rebuildDerivedState();
          this.syncSelection(resetSelection);
        },
        error: () => {
          this.error = 'MICROSEGX.LOAD_FAILED';
        },
      });
  }

  selectRule(rule: MicrosegxAutoPolicyRuleSummary): void {
    this.detailMode = 'rule';
    this.selectedFeature = null;
    this.selectedFeatureKey = '';
    this.selectedRuleId = rule.id;
    this.selectedRuleDetail = rule;
    this.loadRuleDetail(rule.id);
  }

  toggleRuleSelection(
    rule: MicrosegxAutoPolicyRuleSummary,
    event?: Event
  ): void {
    event?.stopPropagation();
    if (!rule?.id) {
      return;
    }
    if (this.selectedRuleIds.has(rule.id)) {
      this.selectedRuleIds.delete(rule.id);
    } else {
      this.selectedRuleIds.add(rule.id);
    }
    this.refreshSelectionState();
  }

  isRuleSelected(rule: MicrosegxAutoPolicyRuleSummary): boolean {
    return !!rule?.id && this.selectedRuleIds.has(rule.id);
  }

  toggleAllPagedRules(event?: Event): void {
    event?.stopPropagation();
    const pageIDs = this.pagedRules
      .map(rule => rule.id)
      .filter(id => Number(id) > 0);
    if (pageIDs.length === 0) {
      return;
    }
    const allSelected = pageIDs.every(id => this.selectedRuleIds.has(id));
    pageIDs.forEach(id => {
      if (allSelected) {
        this.selectedRuleIds.delete(id);
      } else {
        this.selectedRuleIds.add(id);
      }
    });
    this.refreshSelectionState();
  }

  deleteSelectedRules(): void {
    const ids = Array.from(this.selectedRuleIds);
    if (ids.length === 0 || this.deletingRules) {
      return;
    }
    this.deleteRules(ids);
  }

  deleteRule(rule: MicrosegxAutoPolicyRuleSummary, event?: Event): void {
    event?.stopPropagation();
    if (!rule?.id || this.deletingRules) {
      return;
    }
    this.deleteRules([rule.id]);
  }

  canEditRule(rule: MicrosegxAutoPolicyRuleSummary): boolean {
    return (
      !!rule?.id &&
      ['baseline', 'periodic', 'anomaly'].includes(
        String(rule.class || '').toLowerCase()
      )
    );
  }

  openEditRule(rule: MicrosegxAutoPolicyRuleSummary, event?: Event): void {
    event?.stopPropagation();
    if (!this.canEditRule(rule)) {
      this.editError = 'MICROSEGX.AUTO_POLICY.EDIT_UNSUPPORTED';
      return;
    }
    this.editingRule = rule;
    this.creatingRule = false;
    this.editError = '';
    this.editForm = {
      class: this.editableClass(rule.class),
      from: rule.rule?.from || '',
      to: rule.rule?.to || '',
      ports: rule.rule?.ports || 'any',
      confidence: Number(rule.confidence || 1),
      ...this.editPeriodicScheduleFromSlots(rule.periodic_slots || []),
      ttlMinutes: Math.max(
        1,
        Math.ceil(Number(rule.ttl_remaining_seconds || 600) / 60)
      ),
      reason: '',
    };
    this.openNativeEditDialogSoon();
  }

  openCreateRule(): void {
    this.editingRule = null;
    this.creatingRule = true;
    this.editError = '';
    this.editForm = this.defaultEditForm();
    this.openNativeEditDialogSoon();
  }

  closeEditRule(): void {
    if (this.editSaving) {
      return;
    }
    this.closeNativeEditDialog();
    this.editingRule = null;
    this.creatingRule = false;
    this.editError = '';
    this.editForm = this.defaultEditForm();
  }

  onEditDialogCancel(event: Event): void {
    event.preventDefault();
    this.closeEditRule();
  }

  private openNativeEditDialogSoon(): void {
    window.setTimeout(() => this.openNativeEditDialog());
  }

  private openNativeEditDialog(): void {
    const dialog = this.autoPolicyEditDialog?.nativeElement;
    if (!dialog || dialog.open) {
      return;
    }
    try {
      dialog.showModal();
    } catch {
      dialog.setAttribute('open', '');
    }
  }

  private closeNativeEditDialog(): void {
    const dialog = this.autoPolicyEditDialog?.nativeElement;
    if (!dialog?.open) {
      return;
    }
    try {
      dialog.close();
    } catch {
      dialog.removeAttribute('open');
    }
  }

  submitEditRule(): void {
    if ((!this.editingRule?.id && !this.creatingRule) || this.editSaving) {
      return;
    }

    if (this.creatingRule) {
      const endpointValidation = this.validateCreateRuleEndpoints();
      if (endpointValidation) {
        this.editError = endpointValidation;
        return;
      }
    }

    const nextClass = this.editForm.class;
    const periodicValidation =
      nextClass === 'periodic' ? this.validateEditPeriodicSchedule() : '';
    if (periodicValidation) {
      this.editError = periodicValidation;
      return;
    }
    const periodicSlots =
      nextClass === 'periodic' ? this.buildEditPeriodicSlots() : [];
    if (nextClass === 'periodic' && periodicSlots.length === 0) {
      this.editError = 'MICROSEGX.AUTO_POLICY.EDIT_PERIODIC_REQUIRED';
      return;
    }

    this.editSaving = true;
    this.editError = '';
    const request$ = this.creatingRule
      ? this.microsegxHttpService.createAutoPolicyRule({
          from: this.editForm.from.trim(),
          to: this.editForm.to.trim(),
          class: nextClass,
          ports: this.normalizeCreatePorts(this.editForm.ports),
          confidence: this.clampEditConfidence(this.editForm.confidence),
          periodic_slots: periodicSlots,
          ttl_seconds:
            nextClass === 'anomaly'
              ? Math.max(
                  60,
                  Math.round(Number(this.editForm.ttlMinutes || 10) * 60)
                )
              : undefined,
          reason_codes: this.editForm.reason
            ? [this.editForm.reason.trim()]
            : undefined,
        })
      : this.microsegxHttpService.updateAutoPolicyRule(this.editingRule!.id, {
          class: nextClass,
          confidence: this.clampEditConfidence(this.editForm.confidence),
          periodic_slots: periodicSlots,
          ttl_seconds:
            nextClass === 'anomaly'
              ? Math.max(
                  60,
                  Math.round(Number(this.editForm.ttlMinutes || 10) * 60)
                )
              : undefined,
          reason_codes: this.editForm.reason
            ? [this.editForm.reason.trim()]
            : undefined,
        });

    request$.pipe(finalize(() => (this.editSaving = false))).subscribe({
      next: resp => {
        if (resp?.rule) {
          this.upsertLocalRule(resp.rule);
          this.selectedRuleId = resp.rule.id;
          this.selectedRuleDetail = resp.rule;
          this.detailMode = 'rule';
        }
        this.closeEditRule();
        this.refresh(false);
      },
      error: () => {
        this.editError = this.creatingRule
          ? 'MICROSEGX.AUTO_POLICY.CREATE_FAILED'
          : 'MICROSEGX.AUTO_POLICY.EDIT_FAILED';
      },
    });
  }

  onRuleFiltersChanged(): void {
    this.rulePageIndex = 0;
    this.rebuildDerivedState();
  }

  onSearchChanged(): void {
    this.rulePageIndex = 0;
    this.featurePageIndex = 0;
    this.rebuildDerivedState();
  }

  onRuleNamespaceFilterChanged(): void {
    this.ruleEndpointFilter = this.keepAvailableEndpointFilters(
      this.ruleEndpointFilter,
      this.endpointOptions(this.rules, this.ruleNamespaceFilter)
    );
    this.onRuleFiltersChanged();
  }

  clearRuleObjectFilters(): void {
    this.ruleNamespaceFilter = [];
    this.ruleEndpointFilter = [];
    this.onRuleFiltersChanged();
  }

  onFeatureFiltersChanged(): void {
    this.featurePageIndex = 0;
    this.rebuildDerivedState();
  }

  onFeatureNamespaceFilterChanged(): void {
    this.featureEndpointFilter = this.keepAvailableEndpointFilters(
      this.featureEndpointFilter,
      this.endpointOptions(this.features, this.featureNamespaceFilter)
    );
    this.onFeatureFiltersChanged();
  }

  clearFeatureObjectFilters(): void {
    this.featureNamespaceFilter = [];
    this.featureEndpointFilter = [];
    this.onFeatureFiltersChanged();
  }

  nextRulePage(): void {
    this.rulePageIndex = Math.min(
      this.rulePageIndex + 1,
      this.rulePageCount - 1
    );
    this.rebuildDerivedState();
  }

  previousRulePage(): void {
    this.rulePageIndex = Math.max(0, this.rulePageIndex - 1);
    this.rebuildDerivedState();
  }

  nextFeaturePage(): void {
    this.featurePageIndex = Math.min(
      this.featurePageIndex + 1,
      this.featurePageCount - 1
    );
    this.rebuildDerivedState();
  }

  previousFeaturePage(): void {
    this.featurePageIndex = Math.max(0, this.featurePageIndex - 1);
    this.rebuildDerivedState();
  }

  selectFeature(feature: MicrosegxAutoPolicyFeature): void {
    this.detailMode = 'feature';
    this.selectedRuleId = null;
    this.selectedRuleDetail = null;
    this.selectedFeatureKey = feature.feature_key;
    this.selectedFeature = feature;
  }

  setMode(mode: AutoPolicyMode): void {
    const nextMode = this.normalizeMode(mode);
    if (this.modeSaving) {
      this.modeControl = nextMode;
      return;
    }

    this.modeSaving = true;
    this.error = '';
    this.modeControl = nextMode;
    const globalMode = this.globalPolicyModeForAutoMode(nextMode);
    forkJoin({
      autoPolicy: this.microsegxHttpService.updateAutoPolicyConfig(nextMode),
      networkMode: this.microsegxHttpService
        .updateGlobalNetworkPolicyMode(globalMode)
        .pipe(catchError(() => of(null))),
      systemMode: this.microsegxHttpService
        .updateSystemNetworkPolicyMode(globalMode)
        .pipe(catchError(() => of(null))),
    })
      .pipe(finalize(() => (this.modeSaving = false)))
      .subscribe({
        next: resp => {
          this.status = resp.autoPolicy.status;
          this.modeControl = this.normalizeMode(resp.autoPolicy.status?.mode);
          this.refresh(false);
        },
        error: () => {
          this.error = 'MICROSEGX.AUTO_POLICY.MODE_UPDATE_FAILED';
          this.modeControl = this.normalizeMode(this.status?.mode);
        },
      });
  }

  private globalPolicyModeForAutoMode(
    mode: AutoPolicyMode
  ): 'Discover' | 'Monitor' | 'Protect' {
    if (mode === 'enforce') {
      return 'Protect';
    }
    if (mode === 'shadow') {
      return 'Monitor';
    }
    return 'Discover';
  }

  private defaultEditForm(): AutoPolicyEditForm {
    const schedule = this.defaultPeriodicScheduleBlock();
    return {
      class: 'baseline',
      from: '',
      to: '',
      ports: 'any',
      confidence: 1,
      periodicDays: [...schedule.days],
      periodicStartTime: '09:00',
      periodicEndTime: '18:00',
      periodicRanges: this.clonePeriodicRanges(schedule.ranges),
      periodicSchedules: [schedule],
      ttlMinutes: 10,
      reason: '',
    };
  }

  private defaultPeriodicScheduleBlock(): AutoPolicyScheduleBlock {
    return {
      days: this.isExperimentSchedule() ? [0] : [0, 1, 2, 3, 4],
      ranges: [{ startTime: '08:00', endTime: '17:00' }],
    };
  }

  private editableClass(value?: string): MicrosegxAutoPolicyEditableClass {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'periodic') {
      return 'periodic';
    }
    if (normalized === 'anomaly') {
      return 'anomaly';
    }
    return 'baseline';
  }

  private clampEditConfidence(value: number): number {
    if (!Number.isFinite(value)) {
      return 1;
    }
    return Math.max(0, Math.min(1, value));
  }

  private validateCreateRuleEndpoints(): string {
    if (!this.editForm.from.trim() || !this.editForm.to.trim()) {
      return 'MICROSEGX.AUTO_POLICY.CREATE_ENDPOINT_REQUIRED';
    }
    return '';
  }

  createEndpointOptionLabel(value: string): string {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return '';
    }
    const match = this.createEndpointOptions.find(
      endpoint => endpoint.group === normalized
    );
    if (!match) {
      return '';
    }
    return `${match.namespace} / ${match.workload} / ${match.group}`;
  }

  private normalizeCreatePorts(value: string): string {
    const ports = String(value || '').trim();
    return ports || 'any';
  }

  periodicDayOptions(): AutoPolicyPeriodicOption[] {
    if (this.isExperimentSchedule()) {
      const total = Math.max(1, Math.min(this.periodicTotalSlots(), 14));
      return Array.from({ length: total }, (_, index) => ({
        value: index,
        label: this.experimentSlotLabel(index),
      }));
    }

    return [
      {
        value: 0,
        label: this.translate.instant('MICROSEGX.AUTO_POLICY.DAY_MON'),
      },
      {
        value: 1,
        label: this.translate.instant('MICROSEGX.AUTO_POLICY.DAY_TUE'),
      },
      {
        value: 2,
        label: this.translate.instant('MICROSEGX.AUTO_POLICY.DAY_WED'),
      },
      {
        value: 3,
        label: this.translate.instant('MICROSEGX.AUTO_POLICY.DAY_THU'),
      },
      {
        value: 4,
        label: this.translate.instant('MICROSEGX.AUTO_POLICY.DAY_FRI'),
      },
      {
        value: 5,
        label: this.translate.instant('MICROSEGX.AUTO_POLICY.DAY_SAT'),
      },
      {
        value: 6,
        label: this.translate.instant('MICROSEGX.AUTO_POLICY.DAY_SUN'),
      },
    ];
  }

  togglePeriodicDay(day: number, event?: Event, blockIndex = 0): void {
    event?.preventDefault();
    const block = this.periodicScheduleBlock(blockIndex);
    const current = new Set(block.days || []);
    if (current.has(day)) {
      current.delete(day);
    } else {
      current.add(day);
    }
    block.days = Array.from(current).sort((a, b) => a - b);
    this.syncPrimaryPeriodicFields();
  }

  isPeriodicDaySelected(day: number, blockIndex = 0): boolean {
    return (this.periodicScheduleBlock(blockIndex).days || []).includes(day);
  }

  setPeriodicDays(
    preset: 'all' | 'workday' | 'weekend' | 'clear',
    blockIndex = 0
  ): void {
    const block = this.periodicScheduleBlock(blockIndex);
    if (preset === 'clear') {
      block.days = [];
      this.syncPrimaryPeriodicFields();
      return;
    }
    if (this.isExperimentSchedule()) {
      const all = this.periodicDayOptions().map(option => option.value);
      block.days = preset === 'all' ? all : [];
      this.syncPrimaryPeriodicFields();
      return;
    }
    if (preset === 'weekend') {
      block.days = [5, 6];
      this.syncPrimaryPeriodicFields();
      return;
    }
    if (preset === 'workday') {
      block.days = [0, 1, 2, 3, 4];
      this.syncPrimaryPeriodicFields();
      return;
    }
    block.days = [0, 1, 2, 3, 4, 5, 6];
    this.syncPrimaryPeriodicFields();
  }

  addPeriodicRange(blockIndex = 0): void {
    const block = this.periodicScheduleBlock(blockIndex);
    block.ranges = [
      ...(block.ranges || []),
      { startTime: '13:00', endTime: '17:00' },
    ];
    this.syncPrimaryPeriodicFields();
  }

  removePeriodicRange(blockIndex: number, index: number): void {
    const block = this.periodicScheduleBlock(blockIndex);
    const ranges = [...(block.ranges || [])];
    ranges.splice(index, 1);
    block.ranges =
      ranges.length > 0 ? ranges : [{ startTime: '08:00', endTime: '17:00' }];
    this.syncPrimaryPeriodicFields();
  }

  addPeriodicScheduleBlock(): void {
    this.editForm.periodicSchedules = [
      ...this.periodicScheduleBlocks(),
      this.defaultPeriodicScheduleBlock(),
    ];
    this.syncPrimaryPeriodicFields();
  }

  removePeriodicScheduleBlock(index: number): void {
    const blocks = this.periodicScheduleBlocks();
    blocks.splice(index, 1);
    this.editForm.periodicSchedules =
      blocks.length > 0 ? blocks : [this.defaultPeriodicScheduleBlock()];
    this.syncPrimaryPeriodicFields();
  }

  periodicScheduleBlocks(): AutoPolicyScheduleBlock[] {
    if (
      !this.editForm.periodicSchedules ||
      this.editForm.periodicSchedules.length === 0
    ) {
      this.editForm.periodicSchedules = [
        {
          days: [...(this.editForm.periodicDays || [])],
          ranges: this.clonePeriodicRanges(this.editForm.periodicRanges || []),
        },
      ];
    }
    return this.editForm.periodicSchedules;
  }

  private periodicScheduleBlock(index: number): AutoPolicyScheduleBlock {
    const blocks = this.periodicScheduleBlocks();
    if (!blocks[index]) {
      blocks[index] = this.defaultPeriodicScheduleBlock();
    }
    blocks[index].days = blocks[index].days || [];
    blocks[index].ranges =
      blocks[index].ranges && blocks[index].ranges.length > 0
        ? blocks[index].ranges
        : [{ startTime: '08:00', endTime: '17:00' }];
    return blocks[index];
  }

  private clonePeriodicRanges(
    ranges: AutoPolicyTimeRange[]
  ): AutoPolicyTimeRange[] {
    return (ranges || []).map(range => ({
      startTime: range.startTime,
      endTime: range.endTime,
    }));
  }

  private syncPrimaryPeriodicFields(): void {
    const first =
      this.periodicScheduleBlocks()[0] || this.defaultPeriodicScheduleBlock();
    const firstRange = (first.ranges || [])[0] || {
      startTime: '08:00',
      endTime: '17:00',
    };
    this.editForm.periodicDays = [...(first.days || [])];
    this.editForm.periodicRanges = this.clonePeriodicRanges(first.ranges || []);
    this.editForm.periodicStartTime = firstRange.startTime;
    this.editForm.periodicEndTime = firstRange.endTime;
  }

  blockModalBackdropWheel(event: WheelEvent): void {
    event.preventDefault();
  }

  periodicSchedulePreview(): string {
    const slots = this.buildEditPeriodicSlots();
    if (slots.length === 0) {
      return this.translate.instant(
        'MICROSEGX.AUTO_POLICY.EDIT_PERIODIC_PREVIEW_EMPTY'
      );
    }
    return this.slotSummary(slots, 12);
  }

  periodicSchedulePreviewItems(): string[] {
    const slots = this.buildEditPeriodicSlots();
    if (slots.length === 0) {
      return [
        this.translate.instant(
          'MICROSEGX.AUTO_POLICY.EDIT_PERIODIC_PREVIEW_EMPTY'
        ),
      ];
    }

    const values = Array.from(new Set(slots))
      .filter(slot => Number.isFinite(slot))
      .map(slot => Number(slot))
      .sort((a, b) => a - b);
    if (this.isExperimentSchedule()) {
      return values.map(slot => this.experimentSlotLabel(slot));
    }

    return this.renderNaturalSlotRanges(
      this.compactSlotWindows(
        values.map(slot => this.localWindowForBackendSlot(slot))
      )
    );
  }

  periodicSchedulePreviewCount(): number {
    const slots = this.buildEditPeriodicSlots();
    if (slots.length === 0) {
      return 0;
    }
    return this.periodicSchedulePreviewItems().length;
  }

  periodicScheduleHelp(): string {
    const key = this.isExperimentSchedule()
      ? 'MICROSEGX.AUTO_POLICY.EDIT_PERIODIC_EXPERIMENT_HELP'
      : 'MICROSEGX.AUTO_POLICY.EDIT_PERIODIC_NATURAL_HELP';
    return this.translate.instant(key, {
      slot: this.formatDuration(this.periodicSlotSeconds()),
      day: this.formatDuration(this.periodicDistinctDaySeconds()),
      week: this.formatDuration(this.periodicDistinctDaySeconds() * 7),
    });
  }

  periodicSlotDurationLabel(): string {
    return this.formatDuration(this.periodicSlotSeconds());
  }

  periodicInputStepSeconds(): number {
    return this.periodicSlotSeconds();
  }

  periodicRangeError(range: AutoPolicyTimeRange): string {
    const start = this.parseClockMinutes(range?.startTime);
    const end = this.parseClockMinutes(range?.endTime);
    if (start === null || end === null) {
      return this.translate.instant(
        'MICROSEGX.AUTO_POLICY.EDIT_PERIODIC_TIME_INVALID'
      );
    }
    if (start === end) {
      return this.translate.instant(
        'MICROSEGX.AUTO_POLICY.EDIT_PERIODIC_TIME_EQUAL'
      );
    }
    const normalizedEnd = this.normalizedRangeEndMinutes(start, end);
    if (normalizedEnd < start) {
      return this.translate.instant(
        'MICROSEGX.AUTO_POLICY.EDIT_PERIODIC_TIME_ORDER'
      );
    }
    return '';
  }

  trackByPeriodicRange(index: number): number {
    return index;
  }

  trackByPeriodicScheduleBlock(index: number): number {
    return index;
  }

  isExperimentSchedule(): boolean {
    return this.periodicDistinctDaySeconds() !== 86400;
  }

  private validateEditPeriodicSchedule(): string {
    const blocks = this.periodicScheduleBlocks();
    if (blocks.length === 0) {
      return 'MICROSEGX.AUTO_POLICY.EDIT_PERIODIC_REQUIRED';
    }

    for (const block of blocks) {
      const days = Array.from(new Set(block.days || [])).filter(day =>
        Number.isInteger(day)
      );
      if (days.length === 0) {
        return 'MICROSEGX.AUTO_POLICY.EDIT_PERIODIC_DAY_REQUIRED';
      }

      const ranges = block.ranges || [];
      if (ranges.length === 0) {
        return 'MICROSEGX.AUTO_POLICY.EDIT_PERIODIC_RANGE_REQUIRED';
      }

      if (this.isExperimentSchedule()) {
        continue;
      }

      for (const range of ranges) {
        const start = this.parseClockMinutes(range.startTime);
        const end = this.parseClockMinutes(range.endTime);
        if (start === null || end === null) {
          return 'MICROSEGX.AUTO_POLICY.EDIT_PERIODIC_TIME_INVALID';
        }
        if (start === end) {
          return 'MICROSEGX.AUTO_POLICY.EDIT_PERIODIC_TIME_EQUAL';
        }
        const normalizedEnd = this.normalizedRangeEndMinutes(start, end);
        if (normalizedEnd < start) {
          return 'MICROSEGX.AUTO_POLICY.EDIT_PERIODIC_TIME_ORDER';
        }
      }
    }
    return '';
  }

  private normalizedPeriodicRanges(ranges: AutoPolicyTimeRange[]): Array<{
    startMinutes: number;
    endMinutes: number;
  }> {
    return (ranges || [])
      .map(range => {
        const startMinutes = this.parseClockMinutes(range.startTime);
        const endMinutes = this.parseClockMinutes(range.endTime);
        return {
          startMinutes,
          endMinutes:
            startMinutes !== null && endMinutes !== null
              ? this.normalizedRangeEndMinutes(startMinutes, endMinutes)
              : endMinutes,
        };
      })
      .filter(
        (
          range
        ): range is {
          startMinutes: number;
          endMinutes: number;
        } => range.startMinutes !== null && range.endMinutes !== null
      );
  }

  private normalizedRangeEndMinutes(start: number, end: number): number {
    if (start > 0 && end === 0) {
      return 1440;
    }
    return end;
  }

  private buildEditPeriodicSlots(): number[] {
    const blocks = this.periodicScheduleBlocks();
    if (this.isExperimentSchedule()) {
      const totalSlots = this.periodicTotalSlots();
      const slots = new Set<number>();
      blocks.forEach(block => {
        Array.from(new Set(block.days || []))
          .filter(day => Number.isInteger(day) && day >= 0 && day < totalSlots)
          .forEach(day => slots.add(day));
      });
      return Array.from(slots).sort((a, b) => a - b);
    }

    const slots = new Set<number>();
    blocks.forEach(block => {
      const days = Array.from(new Set(block.days || []))
        .filter(day => Number.isInteger(day) && day >= 0 && day < 7)
        .sort((a, b) => a - b);
      if (days.length === 0) {
        return;
      }
      this.normalizedPeriodicRanges(block.ranges || []).forEach(range => {
        days.forEach(day => {
          this.addLocalPeriodicRangeSlots(
            day,
            range.startMinutes,
            range.endMinutes,
            slots
          );
        });
      });
    });
    return Array.from(slots).sort((a, b) => a - b);
  }

  private addLocalPeriodicRangeSlots(
    day: number,
    startMinutes: number,
    endMinutes: number,
    slots: Set<number>
  ): void {
    const step = Math.max(1, this.periodicSlotMinutes());
    const first = Math.max(0, Math.floor(startMinutes / step) * step);
    for (let minute = first; minute < endMinutes; minute += step) {
      slots.add(this.backendSlotForLocalClock(day, minute));
    }
  }

  private editPeriodicScheduleFromSlots(
    slots: number[]
  ): Pick<
    AutoPolicyEditForm,
    | 'periodicDays'
    | 'periodicStartTime'
    | 'periodicEndTime'
    | 'periodicRanges'
    | 'periodicSchedules'
  > {
    const normalized = Array.from(new Set(slots || []))
      .filter(slot => Number.isInteger(slot) && slot >= 0)
      .sort((a, b) => a - b);

    if (this.isExperimentSchedule()) {
      const days =
        normalized.length > 0
          ? normalized.filter(slot => slot < this.periodicTotalSlots())
          : [0];
      const ranges = [{ startTime: '08:00', endTime: '17:00' }];
      return {
        periodicDays: days,
        periodicStartTime: '09:00',
        periodicEndTime: '18:00',
        periodicRanges: ranges,
        periodicSchedules: [{ days, ranges: this.clonePeriodicRanges(ranges) }],
      };
    }

    if (normalized.length === 0) {
      const block = this.defaultPeriodicScheduleBlock();
      return {
        periodicDays: [...block.days],
        periodicStartTime: '09:00',
        periodicEndTime: '18:00',
        periodicRanges: this.clonePeriodicRanges(block.ranges),
        periodicSchedules: [block],
      };
    }

    const windows = normalized.map(slot =>
      this.localWindowForBackendSlot(slot)
    );
    const ranges = this.compactSlotWindows(windows);
    const timeToDays = new Map<
      string,
      { range: AutoPolicySlotRange; days: Set<number> }
    >();
    ranges.forEach(range => {
      const key = `${range.startMinutes}:${range.endMinutes}`;
      const existing = timeToDays.get(key) || {
        range,
        days: new Set<number>(),
      };
      existing.days.add(range.day);
      timeToDays.set(key, existing);
    });

    const daysToRanges = new Map<string, AutoPolicyScheduleBlock>();
    Array.from(timeToDays.values())
      .sort(
        (a, b) =>
          Math.min(...Array.from(a.days)) - Math.min(...Array.from(b.days)) ||
          a.range.startMinutes - b.range.startMinutes ||
          a.range.endMinutes - b.range.endMinutes
      )
      .forEach(item => {
        const days = Array.from(item.days).sort((a, b) => a - b);
        const key = days.join(',');
        const block = daysToRanges.get(key) || { days, ranges: [] };
        block.ranges.push({
          startTime: this.formatClock(item.range.startMinutes),
          endTime: this.formatClock(item.range.endMinutes),
        });
        daysToRanges.set(key, block);
      });

    const schedules = Array.from(daysToRanges.values()).map(block => ({
      days: [...block.days],
      ranges: this.clonePeriodicRanges(block.ranges).sort((a, b) => {
        const aStart = this.parseClockMinutes(a.startTime) || 0;
        const bStart = this.parseClockMinutes(b.startTime) || 0;
        const aEnd = this.parseClockMinutes(a.endTime) || 0;
        const bEnd = this.parseClockMinutes(b.endTime) || 0;
        return aStart - bStart || aEnd - bEnd;
      }),
    }));
    const first = schedules[0] || this.defaultPeriodicScheduleBlock();
    const firstRange = first.ranges[0] || {
      startTime: '08:00',
      endTime: '17:00',
    };
    return {
      periodicDays: [...first.days],
      periodicStartTime: firstRange.startTime,
      periodicEndTime: firstRange.endTime,
      periodicRanges: this.clonePeriodicRanges(first.ranges),
      periodicSchedules: schedules.length > 0 ? schedules : [first],
    };
  }

  private parseClockMinutes(value: string): number | null {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
    if (!match) {
      return null;
    }
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return null;
    }
    return hour * 60 + minute;
  }

  private backendSlotForLocalClock(day: number, minuteOfDay: number): number {
    const date = new Date(2024, 0, 1 + day, 0, 0, 0, 0);
    date.setMinutes(minuteOfDay);

    const distinctDayMs = this.periodicDistinctDaySeconds() * 1000;
    const slotMs = this.periodicSlotSeconds() * 1000;
    const dayIndex = Math.floor(date.getTime() / distinctDayMs);
    const dayStartMs = dayIndex * distinctDayMs;
    const slotWithinDay = Math.max(
      0,
      Math.min(
        this.periodicSlotsPerDay() - 1,
        Math.floor((date.getTime() - dayStartMs) / slotMs)
      )
    );
    return (
      this.normalizeWeekDayIndex(dayIndex) * this.periodicSlotsPerDay() +
      slotWithinDay
    );
  }

  private localWindowForBackendSlot(slot: number): AutoPolicyLocalSlotWindow {
    const slotsPerDay = this.periodicSlotsPerDay();
    const day = Math.floor(slot / slotsPerDay);
    const slotInDay = slot % slotsPerDay;
    const startMs =
      day * this.periodicDistinctDaySeconds() * 1000 +
      slotInDay * this.periodicSlotSeconds() * 1000;
    const endMs = startMs + this.periodicSlotSeconds() * 1000;
    const start = new Date(startMs);
    const end = new Date(endMs);
    const localDay = this.jsDayToMondayIndex(start.getDay());
    let endMinutes = end.getHours() * 60 + end.getMinutes();
    if (this.jsDayToMondayIndex(end.getDay()) !== localDay) {
      endMinutes += 1440;
    }
    return {
      day: localDay,
      startMinutes: start.getHours() * 60 + start.getMinutes(),
      endMinutes,
    };
  }

  private compactSlotWindows(
    windows: AutoPolicyLocalSlotWindow[]
  ): AutoPolicySlotRange[] {
    const sorted = [...windows].sort(
      (a, b) =>
        a.day - b.day ||
        a.startMinutes - b.startMinutes ||
        a.endMinutes - b.endMinutes
    );
    const ranges: AutoPolicySlotRange[] = [];

    sorted.forEach(window => {
      const last = ranges[ranges.length - 1];
      if (
        last &&
        last.day === window.day &&
        window.startMinutes <= last.endMinutes
      ) {
        last.endMinutes = Math.max(last.endMinutes, window.endMinutes);
        return;
      }
      ranges.push({
        day: window.day,
        startMinutes: window.startMinutes,
        endMinutes: window.endMinutes,
      });
    });

    return ranges;
  }

  private periodicSlotMinutes(): number {
    return Math.max(1, this.status?.slot_minutes || 30);
  }

  private periodicSlotSeconds(): number {
    return Math.max(60, this.periodicSlotMinutes() * 60);
  }

  private periodicDistinctDaySeconds(): number {
    return Math.max(
      this.periodicSlotSeconds(),
      this.status?.distinct_day_seconds || 86400
    );
  }

  private periodicSlotsPerDay(): number {
    return Math.max(
      1,
      Math.floor(this.periodicDistinctDaySeconds() / this.periodicSlotSeconds())
    );
  }

  private periodicTotalSlots(): number {
    return this.periodicSlotsPerDay() * 7;
  }

  private normalizeWeekDayIndex(value: number): number {
    return ((value % 7) + 7) % 7;
  }

  private jsDayToMondayIndex(jsDay: number): number {
    return (jsDay + 6) % 7;
  }

  private upsertLocalRule(rule: MicrosegxAutoPolicyRuleSummary): void {
    const index = this.rules.findIndex(item => item.id === rule.id);
    if (index >= 0) {
      this.rules[index] = rule;
    } else {
      this.rules = [rule, ...this.rules];
    }
    this.rebuildDerivedState();
  }

  onTabChanged(index: number): void {
    this.activeTabIndex = index;
    if (index === 0 && !this.selectedRuleId && this.filteredRules.length > 0) {
      this.selectRule(this.filteredRules[0]);
      return;
    }
    if (
      index === 1 &&
      !this.selectedFeatureKey &&
      this.filteredFeatures.length > 0
    ) {
      this.selectFeature(this.filteredFeatures[0]);
      return;
    }
    if (this.detailMode === 'empty' && index === 2) {
      this.selectedRuleId = null;
      this.selectedRuleDetail = null;
      this.selectedFeatureKey = '';
      this.selectedFeature = null;
    }
  }

  openObservationView(): void {
    this.activeTabIndex = 1;
    this.onTabChanged(1);
  }

  trackByRuleId(index: number, rule: MicrosegxAutoPolicyRuleSummary): number {
    return rule?.id || index;
  }

  trackByFeatureKey(
    index: number,
    feature: MicrosegxAutoPolicyFeature
  ): string {
    return feature?.feature_key || String(index);
  }

  trackByEvent(index: number, event: MicrosegxAutoPolicyEvent): string {
    return `${event?.created_timestamp || 0}:${event?.event_type || ''}:${
      event?.target_key || index
    }`;
  }

  trackByValue(index: number, value: string): string {
    return value || String(index);
  }

  trackByPeriodicOption(
    index: number,
    option: AutoPolicyPeriodicOption
  ): number {
    return option?.value ?? index;
  }

  trackByEndpoint(index: number, endpoint: AutoPolicyEndpointOption): string {
    return endpoint?.key || String(index);
  }

  scorePercentage(score?: number): number {
    return Math.max(0, Math.min(100, Math.round((score || 0) * 100)));
  }

  modeLabel(value?: string): string {
    switch (this.normalizeMode(value)) {
      case 'legacy':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.MODE_LEGACY');
      case 'enforce':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.MODE_ENFORCE');
      case 'shadow':
      default:
        return this.translate.instant('MICROSEGX.AUTO_POLICY.MODE_SHADOW');
    }
  }

  modeDescription(value?: string): string {
    switch (this.normalizeMode(value)) {
      case 'legacy':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.MODE_DESC_LEGACY');
      case 'enforce':
        return this.translate.instant(
          'MICROSEGX.AUTO_POLICY.MODE_DESC_ENFORCE'
        );
      case 'shadow':
      default:
        return this.translate.instant('MICROSEGX.AUTO_POLICY.MODE_DESC_SHADOW');
    }
  }

  classLabel(value?: string): string {
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
      case 'system_guard':
        return this.translate.instant(
          'MICROSEGX.AUTO_POLICY.CLASS_SYSTEM_GUARD'
        );
      case 'candidate':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.STAGE_CANDIDATE');
      case 'promoted':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.STAGE_PROMOTED');
      case 'observing':
      case '':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.CLASS_OBSERVING');
      default:
        return (
          value ||
          this.translate.instant('MICROSEGX.AUTO_POLICY.CLASS_OBSERVING')
        );
    }
  }

  stageLabel(value?: string): string {
    switch (
      String(value || '')
        .trim()
        .toLowerCase()
    ) {
      case 'candidate':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.STAGE_CANDIDATE');
      case 'promoted':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.STAGE_PROMOTED');
      case 'observing':
      case '':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.STAGE_OBSERVING');
      default:
        return (
          value ||
          this.translate.instant('MICROSEGX.AUTO_POLICY.STAGE_OBSERVING')
        );
    }
  }

  actionLabel(value?: string): string {
    switch (
      String(value || '')
        .trim()
        .toLowerCase()
    ) {
      case 'allow':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.ACTION_ALLOW');
      case 'deny':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.ACTION_DENY');
      case 'observe':
      case '':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.ACTION_OBSERVE');
      default:
        return (
          value ||
          this.translate.instant('MICROSEGX.AUTO_POLICY.ACTION_OBSERVE')
        );
    }
  }

  compileStateLabel(value?: string): string {
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

  eventLabel(event: MicrosegxAutoPolicyEvent): string {
    switch (
      String(event?.event_type || '')
        .trim()
        .toLowerCase()
    ) {
      case 'window_processed':
        return this.translate.instant(
          'MICROSEGX.AUTO_POLICY.EVENT_WINDOW_PROCESSED'
        );
      case 'rule_deleted':
        return this.translate.instant(
          'MICROSEGX.AUTO_POLICY.EVENT_RULE_DELETED'
        );
      case 'rule_updated':
        return this.translate.instant(
          'MICROSEGX.AUTO_POLICY.EVENT_RULE_UPDATED'
        );
      case 'baseline_promoted':
        return this.translate.instant(
          'MICROSEGX.AUTO_POLICY.EVENT_BASELINE_PROMOTED'
        );
      case 'periodic_promoted':
        return this.translate.instant(
          'MICROSEGX.AUTO_POLICY.EVENT_PERIODIC_PROMOTED'
        );
      case 'anomaly_promoted':
        return this.translate.instant(
          'MICROSEGX.AUTO_POLICY.EVENT_ANOMALY_PROMOTED'
        );
      case 'feature_aged':
        return this.translate.instant(
          'MICROSEGX.AUTO_POLICY.EVENT_FEATURE_AGED'
        );
      case 'mode_changed':
        return this.translate.instant(
          'MICROSEGX.AUTO_POLICY.EVENT_MODE_CHANGED'
        );
      default:
        return this.classLabel(event?.event_class || event?.event_type);
    }
  }

  ruleSourceLabel(rule: MicrosegxAutoPolicyRuleSummary): string {
    switch (
      String(rule?.class || '')
        .trim()
        .toLowerCase()
    ) {
      case 'system_guard':
        return this.translate.instant(
          'MICROSEGX.AUTO_POLICY.SOURCE_SYSTEM_GUARD'
        );
      case 'baseline':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.SOURCE_BASELINE');
      case 'periodic':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.SOURCE_PERIODIC');
      case 'anomaly':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.SOURCE_ANOMALY');
      default:
        return this.translate.instant('MICROSEGX.AUTO_POLICY.SOURCE_AUTO');
    }
  }

  ruleRuntimeLabel(rule: MicrosegxAutoPolicyRuleSummary): string {
    if (rule?.stale) {
      return this.translate.instant('MICROSEGX.AUTO_POLICY.STALE_RULE');
    }
    return this.translate.instant('MICROSEGX.AUTO_POLICY.LIVE_RULE');
  }

  trafficSourceValue(
    item?: MicrosegxAutoPolicyRuleSummary | MicrosegxAutoPolicyFeature
  ): string {
    const value = String(item?.traffic_source || '').trim();
    if (value) {
      return value;
    }
    return item?.zero_trust ? 'zero_trust' : 'direct';
  }

  trafficSourceLabel(value?: string): string {
    switch (
      String(value || 'direct')
        .trim()
        .toLowerCase()
    ) {
      case 'zero_trust':
        return this.translate.instant(
          'MICROSEGX.AUTO_POLICY.TRAFFIC_ZERO_TRUST'
        );
      case 'ingress':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.TRAFFIC_INGRESS');
      case 'system':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.TRAFFIC_SYSTEM');
      case 'direct':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.TRAFFIC_DIRECT');
      default:
        return (
          value ||
          this.translate.instant('MICROSEGX.AUTO_POLICY.TRAFFIC_DIRECT')
        );
    }
  }

  compactList(values?: Array<string | number>, limit = 6): string {
    const normalized = (values || [])
      .map(value => String(value || '').trim())
      .filter(Boolean);
    if (normalized.length === 0) {
      return '';
    }
    if (normalized.length <= limit) {
      return normalized.join(', ');
    }
    return `${normalized.slice(0, limit).join(', ')} +${
      normalized.length - limit
    }`;
  }

  compactPortsString(value?: string, limit = 6): string {
    const ports = String(value || '')
      .split(',')
      .map(port => port.trim())
      .filter(Boolean);
    return this.compactList(ports, limit);
  }

  rulePortSummary(rule: MicrosegxAutoPolicyRuleSummary): string {
    const ports = this.compactPortsString(rule?.rule?.ports);
    if (ports) {
      return ports;
    }
    return this.compactList(rule?.rule?.applications || []);
  }

  featurePortSummary(feature: MicrosegxAutoPolicyFeature): string {
    return (
      this.compactList(feature?.ports || []) ||
      this.compactList(feature?.fqdns || []) ||
      feature?.display_key ||
      feature?.feature_key ||
      ''
    );
  }

  scoreLabel(kind: 'baseline' | 'periodic' | 'anomaly'): string {
    switch (kind) {
      case 'baseline':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.SCORE_BASELINE');
      case 'periodic':
        return this.translate.instant('MICROSEGX.AUTO_POLICY.SCORE_PERIODIC');
      default:
        return this.translate.instant('MICROSEGX.AUTO_POLICY.SCORE_ANOMALY');
    }
  }

  formatDuration(seconds?: number): string {
    const value = Number(seconds || 0);
    if (!value || value < 0) {
      return this.translate.instant('MICROSEGX.AUTO_POLICY.UNKNOWN_DURATION');
    }
    if (value % 86400 === 0) {
      return `${value / 86400} ${this.translate.instant(
        'MICROSEGX.AUTO_POLICY.DAYS_UNIT'
      )}`;
    }
    if (value % 3600 === 0) {
      return `${value / 3600} ${this.translate.instant(
        'MICROSEGX.AUTO_POLICY.HOURS_UNIT'
      )}`;
    }
    if (value % 60 === 0) {
      return `${value / 60} ${this.translate.instant(
        'MICROSEGX.AUTO_POLICY.MINUTES_UNIT'
      )}`;
    }
    return `${value} ${this.translate.instant(
      'MICROSEGX.AUTO_POLICY.SECONDS_UNIT'
    )}`;
  }

  windowUnitLabel(): string {
    return this.translate.instant('MICROSEGX.AUTO_POLICY.WINDOW_UNIT_HINT', {
      duration: this.formatDuration(this.status?.window_seconds),
    });
  }

  distinctDayUnitLabel(): string {
    const seconds = this.status?.distinct_day_seconds || 0;
    const key =
      seconds > 0 && seconds !== 86400
        ? 'MICROSEGX.AUTO_POLICY.EXPERIMENT_DAY_HINT'
        : 'MICROSEGX.AUTO_POLICY.NATURAL_DAY_HINT';
    return this.translate.instant(key, {
      duration: this.formatDuration(seconds || 86400),
    });
  }

  featureRetentionLabel(): string {
    return this.translate.instant(
      'MICROSEGX.AUTO_POLICY.FEATURE_RETENTION_HINT',
      {
        duration: this.formatDuration(this.status?.feature_retention_seconds),
      }
    );
  }

  workloadCoverageLabel(feature: MicrosegxAutoPolicyFeature): string {
    const percent = Math.round((feature.workload_coverage || 0) * 100);
    const sourceCount = feature.source_workload_count;
    const groupSize = feature.source_group_size;
    if (sourceCount !== undefined && groupSize !== undefined && groupSize > 0) {
      return `${percent}% (${sourceCount}/${groupSize})`;
    }
    return `${percent}%`;
  }

  selectedNamespaceSummary(values: string[]): string {
    return this.selectedTextSummary(values || []);
  }

  selectedEndpointSummary(
    values: string[],
    options: AutoPolicyEndpointOption[]
  ): string {
    const labels = (values || []).map(value => {
      const option = options.find(item => item.key === value);
      return option?.label || value;
    });
    return this.selectedTextSummary(labels);
  }

  private selectedTextSummary(values: string[]): string {
    const selected = (values || [])
      .map(value => String(value).trim())
      .filter(Boolean);
    if (selected.length === 0) {
      return this.translate.instant('enum.ALL');
    }
    if (selected.length <= 2) {
      return selected.join(', ');
    }
    return this.translate.instant(
      'MICROSEGX.AUTO_POLICY.FILTER_SELECTED_COUNT',
      {
        first: selected[0],
        count: selected.length - 1,
      }
    );
  }

  slotSummary(slots?: number[], limit = 18): string {
    const values = Array.from(new Set(slots || []))
      .filter(slot => Number.isFinite(slot))
      .map(slot => Number(slot))
      .sort((a, b) => a - b);
    if (values.length === 0) {
      return '--';
    }

    const rendered = this.isExperimentSchedule()
      ? values.map(slot => this.experimentSlotLabel(slot))
      : this.renderNaturalSlotRanges(
          this.compactSlotWindows(
            values.map(slot => this.localWindowForBackendSlot(slot))
          )
        );

    if (rendered.length <= limit) {
      return rendered.join(', ');
    }
    return `${rendered.slice(0, limit).join(', ')} +${rendered.length - limit}`;
  }

  periodicDayName(day: number): string {
    return this.weekdayName(day);
  }

  private renderNaturalSlotRanges(ranges: AutoPolicySlotRange[]): string[] {
    const grouped = new Map<string, number[]>();
    ranges.forEach(range => {
      const key = `${range.startMinutes}:${range.endMinutes}`;
      grouped.set(key, [...(grouped.get(key) || []), range.day]);
    });

    return Array.from(grouped.entries())
      .map(([key, days]) => {
        const [startMinutes, endMinutes] = key
          .split(':')
          .map(value => Number(value));
        return {
          days: Array.from(new Set(days)).sort((a, b) => a - b),
          startMinutes,
          endMinutes,
        };
      })
      .sort(
        (a, b) =>
          a.days[0] - b.days[0] ||
          a.startMinutes - b.startMinutes ||
          a.endMinutes - b.endMinutes
      )
      .map(range =>
        this.translate.instant('MICROSEGX.AUTO_POLICY.NATURAL_RANGE_LABEL', {
          days: this.formatDaySet(range.days),
          start: this.formatClock(range.startMinutes),
          end: this.formatClock(range.endMinutes),
        })
      );
  }

  private formatDaySet(days: number[]): string {
    const normalized = Array.from(
      new Set(days.map(day => this.normalizeWeekDayIndex(day)))
    ).sort((a, b) => a - b);
    if (normalized.length === 7) {
      return this.translate.instant('MICROSEGX.AUTO_POLICY.EVERY_DAY');
    }

    const parts: string[] = [];
    let start = normalized[0];
    let previous = normalized[0];
    for (let index = 1; index <= normalized.length; index++) {
      const current = normalized[index];
      if (current === previous + 1) {
        previous = current;
        continue;
      }
      parts.push(this.formatDaySpan(start, previous));
      start = current;
      previous = current;
    }
    return parts.join('、');
  }

  private formatDaySpan(start: number, end: number): string {
    if (start === end) {
      return this.weekdayName(start);
    }
    return this.translate.instant('MICROSEGX.AUTO_POLICY.DAY_RANGE', {
      start: this.weekdayName(start),
      end: this.weekdayName(end),
    });
  }

  private experimentSlotLabel(slot: number): string {
    const index = Number(slot || 0);
    const slotsPerDay = this.periodicSlotsPerDay();
    const virtualDay = this.normalizeWeekDayIndex(
      Math.floor(index / slotsPerDay)
    );
    const day = this.weekdayName(virtualDay);

    if (this.periodicDistinctDaySeconds() === 60 && slotsPerDay === 1) {
      return this.translate.instant(
        'MICROSEGX.AUTO_POLICY.EXPERIMENT_MINUTE_SLOT_LABEL',
        {
          day,
          index: index + 1,
        }
      );
    }

    return this.translate.instant(
      'MICROSEGX.AUTO_POLICY.EXPERIMENT_SLOT_LABEL',
      {
        day,
        index: index + 1,
      }
    );
  }

  private weekdayName(day: number): string {
    switch (this.normalizeWeekDayIndex(day)) {
      case 0:
        return this.translate.instant('MICROSEGX.AUTO_POLICY.DAY_MON');
      case 1:
        return this.translate.instant('MICROSEGX.AUTO_POLICY.DAY_TUE');
      case 2:
        return this.translate.instant('MICROSEGX.AUTO_POLICY.DAY_WED');
      case 3:
        return this.translate.instant('MICROSEGX.AUTO_POLICY.DAY_THU');
      case 4:
        return this.translate.instant('MICROSEGX.AUTO_POLICY.DAY_FRI');
      case 5:
        return this.translate.instant('MICROSEGX.AUTO_POLICY.DAY_SAT');
      default:
        return this.translate.instant('MICROSEGX.AUTO_POLICY.DAY_SUN');
    }
  }

  private formatClock(totalMinutes: number): string {
    const minutesInDay = ((totalMinutes % 1440) + 1440) % 1440;
    const hour = Math.floor(minutesInDay / 60);
    const minute = minutesInDay % 60;
    return `${hour.toString().padStart(2, '0')}:${minute
      .toString()
      .padStart(2, '0')}`;
  }

  private normalizeMode(value?: string): AutoPolicyMode {
    switch (
      String(value || '')
        .trim()
        .toLowerCase()
    ) {
      case 'legacy':
        return 'legacy';
      case 'enforce':
      case 'protect':
      case 'protection':
        return 'enforce';
      case 'discover':
      case 'learn':
      case 'learning':
      case 'monitor':
      case 'evaluate':
      case 'shadow':
      default:
        return 'shadow';
    }
  }

  private loadRuleDetail(id: number): void {
    this.microsegxHttpService
      .getAutoPolicyRuleDetail(id)
      .pipe(catchError(() => of({ rule: null as any })))
      .subscribe(resp => {
        if (resp?.rule?.id === id) {
          this.selectedRuleDetail = resp.rule;
        }
      });
  }

  private deleteRules(ids: number[]): void {
    this.deletingRules = true;
    this.error = '';
    this.microsegxHttpService
      .deleteAutoPolicyRules(ids)
      .pipe(finalize(() => (this.deletingRules = false)))
      .subscribe({
        next: () => {
          ids.forEach(id => this.selectedRuleIds.delete(id));
          if (this.selectedRuleId && ids.includes(this.selectedRuleId)) {
            this.selectedRuleId = null;
            this.selectedRuleDetail = null;
            this.detailMode = 'empty';
          }
          this.refresh(false);
        },
        error: () => {
          this.error = 'MICROSEGX.AUTO_POLICY.DELETE_FAILED';
        },
      });
  }

  private pruneSelectedRuleIds(): void {
    const existing = new Set(this.rules.map(rule => rule.id));
    Array.from(this.selectedRuleIds).forEach(id => {
      if (!existing.has(id)) {
        this.selectedRuleIds.delete(id);
      }
    });
  }

  private clampRulePage(): void {
    this.rulePageIndex = Math.min(this.rulePageIndex, this.rulePageCount - 1);
    this.rulePageIndex = Math.max(0, this.rulePageIndex);
  }

  private namespaceOptions(
    items: Array<MicrosegxAutoPolicyRuleSummary | MicrosegxAutoPolicyFeature>
  ): string[] {
    const values = new Set<string>();
    items.forEach(item => {
      this.endpointOptionsForItem(item).forEach(endpoint => {
        if (endpoint.namespace && endpoint.namespace !== 'unknown') {
          values.add(endpoint.namespace);
        }
      });
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }

  private endpointOptions(
    items: Array<MicrosegxAutoPolicyRuleSummary | MicrosegxAutoPolicyFeature>,
    namespaces: string[] = []
  ): AutoPolicyEndpointOption[] {
    const namespaceSet = new Set((namespaces || []).filter(Boolean));
    const values = new Map<string, AutoPolicyEndpointOption>();
    items.forEach(item => {
      this.endpointOptionsForItem(item).forEach(endpoint => {
        if (namespaceSet.size > 0 && !namespaceSet.has(endpoint.namespace)) {
          return;
        }
        values.set(endpoint.key, endpoint);
      });
    });
    return Array.from(values.values()).sort((left, right) =>
      `${left.namespace}/${left.workload}/${left.group}`.localeCompare(
        `${right.namespace}/${right.workload}/${right.group}`
      )
    );
  }

  private endpointOptionsForItem(
    item: MicrosegxAutoPolicyRuleSummary | MicrosegxAutoPolicyFeature
  ): AutoPolicyEndpointOption[] {
    const anyItem = item as any;
    const fromGroup = anyItem.rule?.from || anyItem.from || '';
    const toGroup = anyItem.rule?.to || anyItem.to || '';
    const endpoints = [
      this.endpointOptionFromGroup(
        fromGroup,
        anyItem.from_namespace,
        anyItem.from_business
      ),
      this.endpointOptionFromGroup(
        toGroup,
        anyItem.to_namespace,
        anyItem.to_business
      ),
    ].filter((endpoint): endpoint is AutoPolicyEndpointOption => !!endpoint);

    const unique = new Map<string, AutoPolicyEndpointOption>();
    endpoints.forEach(endpoint => unique.set(endpoint.key, endpoint));
    return Array.from(unique.values());
  }

  private endpointOptionFromGroup(
    group?: string,
    namespace?: string,
    workload?: string
  ): AutoPolicyEndpointOption | null {
    const normalizedGroup = String(group || '').trim();
    if (!normalizedGroup) {
      return null;
    }
    if (this.isServiceIpGroup(normalizedGroup)) {
      return null;
    }

    const ns = this.cleanSingleSemanticValue(
      namespace,
      normalizedGroup,
      'namespace'
    );
    const name = this.cleanSingleSemanticValue(
      workload,
      normalizedGroup,
      'workload'
    );
    const label = `${ns || '-'} / ${name || normalizedGroup}`;
    return {
      key: normalizedGroup,
      label,
      namespace: ns || 'unknown',
      workload: name || normalizedGroup,
      group: normalizedGroup,
    };
  }

  private cleanSingleSemanticValue(
    value: unknown,
    group: string,
    kind: 'namespace' | 'workload'
  ): string {
    const raw = String(value || '').trim();
    if (raw && !raw.includes('->')) {
      return raw;
    }
    return kind === 'namespace'
      ? this.extractNamespaceKey(group)
      : this.extractBusinessKey(group);
  }

  private matchesNamespaceFilter(
    item: MicrosegxAutoPolicyRuleSummary | MicrosegxAutoPolicyFeature,
    selectedNamespaces: string[]
  ): boolean {
    if (!selectedNamespaces || selectedNamespaces.length === 0) {
      return true;
    }
    const namespaceSet = new Set(selectedNamespaces);
    return this.endpointOptionsForItem(item).some(endpoint =>
      namespaceSet.has(endpoint.namespace)
    );
  }

  private matchesEndpointFilter(
    item: MicrosegxAutoPolicyRuleSummary | MicrosegxAutoPolicyFeature,
    selectedEndpoints: string[]
  ): boolean {
    if (!selectedEndpoints || selectedEndpoints.length === 0) {
      return true;
    }
    const endpointSet = new Set(selectedEndpoints);
    return this.endpointOptionsForItem(item).some(endpoint =>
      endpointSet.has(endpoint.key)
    );
  }

  private endpointSearchTerms(
    item: MicrosegxAutoPolicyRuleSummary | MicrosegxAutoPolicyFeature
  ): string[] {
    return this.endpointOptionsForItem(item).flatMap(endpoint => [
      endpoint.namespace,
      endpoint.workload,
      endpoint.group,
      endpoint.label,
    ]);
  }

  private keepAvailableEndpointFilters(
    selected: string[],
    available: AutoPolicyEndpointOption[]
  ): string[] {
    const availableKeys = new Set(available.map(option => option.key));
    return (selected || []).filter(value => availableKeys.has(value));
  }

  private extractBusinessKey(group?: string): string {
    const value = String(group || '').trim();
    if (!value) {
      return '';
    }
    if (this.isServiceIpGroup(value)) {
      const parts = value.substring('nv.ip.'.length).split('.');
      if (parts.length > 1) {
        return parts.slice(0, -1).join('.') || parts[0];
      }
      return parts[0] || '';
    }
    if (value.startsWith('Host:')) {
      return 'host';
    }
    if (value.startsWith('Workload:')) {
      return value.substring('Workload:'.length).trim() || 'workload';
    }
    const parts = value.split('.');
    if (parts.length > 1) {
      return parts.slice(1, -1).join('.') || parts[parts.length - 2];
    }
    return value;
  }

  private extractNamespaceKey(group?: string): string {
    const value = String(group || '').trim();
    if (!value) {
      return '';
    }
    if (this.isServiceIpGroup(value)) {
      const parts = value.substring('nv.ip.'.length).split('.');
      return parts.length > 1 ? parts[parts.length - 1] : 'unknown';
    }
    if (value.startsWith('Host:')) {
      return 'host';
    }
    if (value.startsWith('Workload:')) {
      return value === 'Workload:ingress' ? 'external' : 'workload';
    }
    const parts = value.split('.');
    if (parts.length > 1) {
      return parts[parts.length - 1];
    }
    return value;
  }

  private isServiceIpGroup(group?: string): boolean {
    return String(group || '')
      .trim()
      .toLowerCase()
      .startsWith('nv.ip.');
  }

  private deduplicateFeatures(
    features: MicrosegxAutoPolicyFeature[]
  ): MicrosegxAutoPolicyFeature[] {
    const byIdentity = new Map<string, MicrosegxAutoPolicyFeature>();
    for (const feature of features || []) {
      const identity = [
        feature.feature_key,
        this.trafficSourceValue(feature),
        ...(feature.ports || []).slice().sort(),
        ...(feature.fqdns || []).slice().sort(),
      ].join('|');
      const existing = byIdentity.get(identity);
      if (
        !existing ||
        (feature.last_seen_timestamp || 0) >
          (existing.last_seen_timestamp || 0) ||
        (feature.historical_windows || 0) > (existing.historical_windows || 0)
      ) {
        byIdentity.set(identity, feature);
      }
    }
    return Array.from(byIdentity.values());
  }

  private syncSelection(resetSelection: boolean): void {
    if (this.selectedRuleId) {
      const matchedRule = this.rules.find(
        rule => rule.id === this.selectedRuleId
      );
      if (!matchedRule) {
        this.selectedRuleId = null;
        this.selectedRuleDetail = null;
      } else if (
        !this.selectedRuleDetail ||
        this.selectedRuleDetail.id !== matchedRule.id
      ) {
        this.selectedRuleDetail = matchedRule;
        this.loadRuleDetail(matchedRule.id);
      }
    }

    if (this.selectedFeatureKey) {
      const matchedFeature = this.features.find(
        feature => feature.feature_key === this.selectedFeatureKey
      );
      if (!matchedFeature) {
        this.selectedFeatureKey = '';
        this.selectedFeature = null;
      } else {
        this.selectedFeature = matchedFeature;
      }
    }

    if (!resetSelection) {
      return;
    }

    if (this.activeTabIndex === 0 && this.filteredRules.length > 0) {
      this.selectRule(this.filteredRules[0]);
      return;
    }
    if (this.activeTabIndex === 1 && this.filteredFeatures.length > 0) {
      this.selectFeature(this.filteredFeatures[0]);
      return;
    }

    this.detailMode = 'empty';
  }
}
