export interface MicrosegxPortExposureOverview {
  managedServices: number;
  openPorts: number;
  exposedTargets: number;
  resourceCount: number;
  trafficTargets: number;
  nodes: number;
  generatedAt: string;
  scanInProgress: boolean;
}

export interface MicrosegxZitiOverview {
  available: boolean;
  defaultControllerUrl: string;
  defaultCredentialsConfigured: boolean;
  aliveRouters: number;
  deployedRouters: number;
  services: number;
  configs: number;
  identities: number;
  controllerError?: string | null;
}

export interface MicrosegxAutoPolicyCandidate {
  from: string;
  to: string;
  display_key?: string;
  from_namespace?: string;
  to_namespace?: string;
  namespace?: string;
  from_business?: string;
  to_business?: string;
  business?: string;
  traffic_source?: string;
  zero_trust?: boolean;
  is_app: boolean;
  ip_proto: number;
  application?: number;
  ports?: string[];
  fqdns?: string[];
  class?: string;
  confidence?: number;
  reason_codes?: string[];
  distinct_days: number;
  consecutive_windows: number;
  total_windows: number;
  source_workload_count?: number;
  source_group_size?: number;
  source_group_size_estimated?: boolean;
  last_observed_timestamp?: number;
  baseline_score?: number;
  periodic_score?: number;
  anomaly_score?: number;
}

export interface MicrosegxAutoPolicyStatus {
  mode: string;
  window_seconds: number;
  slot_minutes: number;
  distinct_day_seconds: number;
  ttl_check_seconds: number;
  feature_retention_seconds: number;
  observed_event_count: number;
  feature_count: number;
  direct_feature_count?: number;
  ingress_feature_count?: number;
  zero_trust_feature_count?: number;
  system_feature_count?: number;
  system_guard_rule_count?: number;
  baseline_rule_count: number;
  periodic_rule_count: number;
  anomaly_rule_count: number;
  direct_rule_count?: number;
  ingress_rule_count?: number;
  zero_trust_rule_count?: number;
  system_rule_count?: number;
  candidate_baseline: number;
  candidate_periodic: number;
  candidate_anomaly: number;
  pending_promotion_count: number;
  last_window_processed_timestamp?: number;
  last_window_event_count: number;
  promotion_count: number;
  delete_count: number;
  last_promotion_timestamp?: number;
  last_delete_timestamp?: number;
  candidates?: MicrosegxAutoPolicyCandidate[];
}

export interface MicrosegxAutoPolicyConfigRequest {
  config: {
    mode: 'legacy' | 'shadow' | 'enforce';
  };
}

export interface MicrosegxAutoPolicyFeature {
  feature_key: string;
  display_key?: string;
  from: string;
  to: string;
  from_namespace?: string;
  to_namespace?: string;
  namespace?: string;
  from_business?: string;
  to_business?: string;
  business?: string;
  traffic_source?: string;
  zero_trust?: boolean;
  is_app: boolean;
  ip_proto: number;
  application?: number;
  ports?: string[];
  fqdns?: string[];
  action_hint?: string;
  class_hint?: string;
  stage: string;
  baseline_score?: number;
  periodic_score?: number;
  anomaly_score?: number;
  consecutive_windows: number;
  historical_windows: number;
  distinct_days: number;
  workload_coverage?: number;
  source_workload_count?: number;
  source_group_size?: number;
  source_group_size_estimated?: boolean;
  active_slot_count?: number;
  active_slots?: number[];
  last_seen_timestamp?: number;
  related_rule_id?: number;
  reason_codes?: string[];
}

export interface MicrosegxPolicyRuleRef {
  id: number;
  comment: string;
  from: string;
  to: string;
  ports: string;
  action: string;
  applications: string[];
  learned: boolean;
  disable: boolean;
  created_timestamp: number;
  last_modified_timestamp: number;
  cfg_type: string;
  priority: number;
  match_counter: number;
  last_match_timestamp: number;
}

export interface MicrosegxAutoPolicyRuleSummary {
  id: number;
  class: string;
  display_key?: string;
  from_namespace?: string;
  to_namespace?: string;
  namespace?: string;
  from_business?: string;
  to_business?: string;
  business?: string;
  traffic_source?: string;
  zero_trust?: boolean;
  confidence: number;
  active: boolean;
  active_now: boolean;
  stale?: boolean;
  from_live?: boolean;
  to_live?: boolean;
  from_endpoint_count?: number;
  to_endpoint_count?: number;
  from_service_count?: number;
  to_service_count?: number;
  stage?: string;
  compile_state?: string;
  last_observed_timestamp?: number;
  expires_timestamp?: number;
  ttl_remaining_seconds?: number;
  periodic_slots?: number[];
  periodic_slot_summary?: string;
  reason_codes?: string[];
  promotion_reason?: string;
  pending_reason?: string;
  source_feature_key?: string;
  baseline_score?: number;
  periodic_score?: number;
  anomaly_score?: number;
  rule: MicrosegxPolicyRuleRef;
}

export interface MicrosegxAutoPolicyDeleteResult {
  deleted?: number[];
  suppressed?: number[];
  skipped?: number[];
}

export type MicrosegxAutoPolicyEditableClass =
  | 'baseline'
  | 'periodic'
  | 'anomaly';

export interface MicrosegxAutoPolicyRuleUpdateRequest {
  config: {
    class: MicrosegxAutoPolicyEditableClass;
    confidence?: number;
    periodic_slots?: number[];
    ttl_seconds?: number;
    reason_codes?: string[];
  };
}

export interface MicrosegxAutoPolicyRuleCreateRequest {
  config: {
    from: string;
    to: string;
    class: MicrosegxAutoPolicyEditableClass;
    ports?: string;
    applications?: number[];
    confidence?: number;
    periodic_slots?: number[];
    ttl_seconds?: number;
    reason_codes?: string[];
  };
}

export interface MicrosegxAutoPolicyEvent {
  id: number;
  event_type: string;
  event_class?: string;
  display_key?: string;
  namespace?: string;
  business?: string;
  traffic_source?: string;
  zero_trust?: boolean;
  target_type?: string;
  target_id?: number;
  target_key?: string;
  summary: string;
  created_timestamp: number;
  extra?: Record<string, string>;
}

export interface MicrosegxOverview {
  baseUrl: string;
  portExposure: MicrosegxPortExposureOverview;
  ziti: MicrosegxZitiOverview;
  dashboard: any;
  zitiSession: any;
  zitiOverview: any;
  autoPolicy?: MicrosegxAutoPolicyStatus;
}
