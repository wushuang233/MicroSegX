import {
  Component,
  Input,
  OnChanges,
  OnInit,
  SimpleChanges,
} from '@angular/core';
import { MicrosegxHttpService } from '@common/api/microsegx-http.service';
import {
  MicrosegxAutoPolicyFeature,
  MicrosegxAutoPolicyRuleSummary,
} from '@common/types';
import { TranslateService } from '@ngx-translate/core';
import { forkJoin, of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

@Component({
  standalone: false,
  selector: 'app-auto-policy-inspector',
  templateUrl: './auto-policy-inspector.component.html',
  styleUrls: ['./auto-policy-inspector.component.scss'],
})
export class AutoPolicyInspectorComponent implements OnInit, OnChanges {
  @Input() edgeDetails: any;
  @Input() conversationDetail: any;

  private readonly lookupCacheTtlMs = 5000;
  private inFlightLookupKey = '';
  private loadedLookupKey = '';
  private loadedLookupAt = 0;
  private requestSeq = 0;

  loading = false;
  feature: MicrosegxAutoPolicyFeature | null = null;
  rule: MicrosegxAutoPolicyRuleSummary | null = null;

  constructor(
    private microsegxHttpService: MicrosegxHttpService,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.refresh();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.edgeDetails || changes.conversationDetail) {
      this.refresh();
    }
  }

  scorePercentage(score?: number): number {
    return Math.max(0, Math.min(100, Math.round((score || 0) * 100)));
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
      default:
        return this.translate.instant('MICROSEGX.AUTO_POLICY.ACTION_OBSERVE');
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

  private refresh(): void {
    const from = this.normalizedFrom;
    const to = this.normalizedTo;
    if (!from || !to) {
      this.inFlightLookupKey = '';
      this.loadedLookupKey = '';
      this.loadedLookupAt = 0;
      this.feature = null;
      this.rule = null;
      this.loading = false;
      return;
    }

    const lookupKey = `${from} -> ${to}`;
    const loadedRecently =
      lookupKey === this.loadedLookupKey &&
      Date.now() - this.loadedLookupAt < this.lookupCacheTtlMs;
    if (lookupKey === this.inFlightLookupKey || loadedRecently) {
      return;
    }

    const seq = ++this.requestSeq;
    this.inFlightLookupKey = lookupKey;
    this.loading = true;
    forkJoin({
      features: this.microsegxHttpService
        .getAutoPolicyFeatures()
        .pipe(catchError(() => of({ features: [] }))),
      rules: this.microsegxHttpService
        .getAutoPolicyRules()
        .pipe(catchError(() => of({ rules: [] }))),
    })
      .pipe(
        finalize(() => {
          if (seq === this.requestSeq) {
            this.inFlightLookupKey = '';
            this.loading = false;
          }
        })
      )
      .subscribe(({ features, rules }) => {
        if (seq !== this.requestSeq) {
          return;
        }
        this.feature =
          (features.features || []).find(
            item => item.from === from && item.to === to
          ) || null;
        this.rule =
          (rules.rules || []).find(
            item => item.rule?.from === from && item.rule?.to === to
          ) || null;
        this.loadedLookupKey = lookupKey;
        this.loadedLookupAt = Date.now();
      });
  }

  private get normalizedFrom(): string {
    return (
      this.edgeDetails?.fromGroup ||
      this.conversationDetail?.from?.display_name ||
      this.edgeDetails?.source ||
      ''
    );
  }

  private get normalizedTo(): string {
    return (
      this.edgeDetails?.toGroup ||
      this.conversationDetail?.to?.display_name ||
      this.edgeDetails?.target ||
      ''
    );
  }
}
