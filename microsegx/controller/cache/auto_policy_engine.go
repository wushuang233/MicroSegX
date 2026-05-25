package cache

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	log "github.com/sirupsen/logrus"

	"github.com/wushuang233/MicroSegX/microsegx/controller/api"
	"github.com/wushuang233/MicroSegX/microsegx/controller/common"
	"github.com/wushuang233/MicroSegX/microsegx/share"
	"github.com/wushuang233/MicroSegX/microsegx/share/cluster"
	"github.com/wushuang233/MicroSegX/microsegx/share/utils"
)

var autoPolicyLastScheduleSlot uint16

func autoPolicyClamp01(value float64) float64 {
	switch {
	case value < 0:
		return 0
	case value > 1:
		return 1
	default:
		return value
	}
}

func aggregateObservedEvents(events []autoObservedEvent) (map[autoFeatureKey]*autoWindowAggregate, map[string]*autoSourceWindowStats) {
	aggregates := make(map[autoFeatureKey]*autoWindowAggregate)
	srcStats := make(map[string]*autoSourceWindowStats)

	for _, event := range events {
		agg, ok := aggregates[event.Key]
		if !ok {
			agg = &autoWindowAggregate{
				Key:          event.Key,
				LastObserved: event.ObservedAt,
				FromWLs:      make(map[string]struct{}),
				Ports:        make(map[string]struct{}),
				FQDNs:        make(map[string]struct{}),
				Applications: make(map[uint32]struct{}),
			}
			aggregates[event.Key] = agg
		}

		agg.Count++
		if event.ObservedAt.After(agg.LastObserved) {
			agg.LastObserved = event.ObservedAt
		}
		if event.FromWL != "" {
			agg.FromWLs[event.FromWL] = struct{}{}
		}
		if event.Port != "" {
			agg.Ports[event.Port] = struct{}{}
		}
		if event.FQDN != "" {
			agg.FQDNs[event.FQDN] = struct{}{}
		}
		if event.Key.IsApp && event.Key.Application > 0 {
			agg.Applications[event.Key.Application] = struct{}{}
		}
		if event.ThreatID > 0 {
			agg.ThreatID = event.ThreatID
		}
		if event.Severity > agg.MaxSeverity {
			agg.MaxSeverity = event.Severity
		}
		if event.Violates > 0 || event.ThreatID > 0 || event.Severity > 0 {
			agg.Violation = true
		}

		stats, ok := srcStats[event.Key.From]
		if !ok {
			stats = &autoSourceWindowStats{
				Ports: make(map[string]struct{}),
				Dsts:  make(map[string]struct{}),
			}
			srcStats[event.Key.From] = stats
		}
		if event.Port != "" {
			stats.Ports[event.Port] = struct{}{}
		}
		if event.Key.To != "" {
			stats.Dsts[event.Key.To] = struct{}{}
		}
	}

	return aggregates, srcStats
}

func updateAutoFeatureState(agg *autoWindowAggregate) *autoFeatureState {
	if agg == nil {
		return nil
	}
	if autoPolicyFeatureUsesServiceIPGroup(agg.Key) {
		return nil
	}
	if agg.Key.IsApp {
		delete(autoPolicyFeatureMap, autoPolicyLayer4FeatureKey(agg.Key))
	} else if autoPolicyHasAppFeatureForLayer4KeyLocked(agg.Key) {
		return nil
	}

	state, ok := autoPolicyFeatureMap[agg.Key]
	if !ok {
		state = &autoFeatureState{
			Key:              agg.Key,
			DaysSeen:         make(map[int64]struct{}),
			SrcWorkloadsSeen: make(map[string]struct{}),
			Ports:            make(map[string]struct{}),
			FQDNs:            make(map[string]struct{}),
			Applications:     make(map[uint32]struct{}),
			SlotCounters:     make(map[uint16]uint32),
		}
		autoPolicyFeatureMap[agg.Key] = state
	}

	if state.FirstObserved.IsZero() {
		state.FirstObserved = agg.LastObserved
	}
	state.LastObserved = agg.LastObserved

	windowIdx := autoPolicyWindowIndex(agg.LastObserved)
	if state.TotalWindows == 0 {
		state.ConsecutiveWindows = 1
		state.TotalWindows = 1
		state.LastWindowIndex = windowIdx
	} else if state.LastWindowIndex != windowIdx {
		if state.LastWindowIndex+1 == windowIdx {
			state.ConsecutiveWindows++
		} else {
			state.ConsecutiveWindows = 1
		}
		state.TotalWindows++
		state.LastWindowIndex = windowIdx
	}

	dayIdx := autoPolicyDayIndex(agg.LastObserved)
	if _, ok := state.DaysSeen[dayIdx]; !ok {
		state.DaysSeen[dayIdx] = struct{}{}
		state.DistinctDays = uint32(len(state.DaysSeen))
	}

	for wlID := range agg.FromWLs {
		state.SrcWorkloadsSeen[wlID] = struct{}{}
	}
	for port := range agg.Ports {
		state.Ports[port] = struct{}{}
	}
	for fqdn := range agg.FQDNs {
		state.FQDNs[fqdn] = struct{}{}
	}
	for appID := range agg.Applications {
		state.Applications[appID] = struct{}{}
	}

	slot := autoPolicySlotIndex(agg.LastObserved)
	state.SlotCounters[slot] += uint32(agg.Count)
	state.TotalSlotHits += uint64(agg.Count)
	state.TotalEvents += uint64(agg.Count)
	if agg.Violation {
		state.ViolationCount++
	}
	if agg.MaxSeverity > state.MaxSeverity {
		state.MaxSeverity = agg.MaxSeverity
	}
	if agg.ThreatID > 0 {
		state.LastThreatID = agg.ThreatID
	}

	return state
}

func autoPolicyLayer4FeatureKey(key autoFeatureKey) autoFeatureKey {
	return autoFeatureKey{
		From:    key.From,
		To:      key.To,
		IPProto: key.IPProto,
	}
}

func autoPolicyHasAppFeatureForLayer4KeyLocked(key autoFeatureKey) bool {
	if key.IsApp {
		return false
	}
	for appKey, state := range autoPolicyFeatureMap {
		if state == nil || !appKey.IsApp {
			continue
		}
		if appKey.From == key.From && appKey.To == key.To && appKey.IPProto == key.IPProto {
			return true
		}
	}
	return false
}

func cleanupAutoPolicyFeatureStatesLocked(now time.Time) int {
	if autoPolicyConfig.FeatureRetentionDuration <= 0 {
		return 0
	}

	deleted := 0
	for key, state := range autoPolicyFeatureMap {
		if autoPolicyFeatureUsesServiceIPGroup(key) {
			delete(autoPolicyFeatureMap, key)
			deleted++
			continue
		}
		if state == nil {
			delete(autoPolicyFeatureMap, key)
			deleted++
			continue
		}
		lastSeen := state.LastObserved
		if lastSeen.IsZero() {
			lastSeen = state.FirstObserved
		}
		if !lastSeen.IsZero() && now.Sub(lastSeen) >= autoPolicyConfig.FeatureRetentionDuration {
			delete(autoPolicyFeatureMap, key)
			deleted++
		}
	}
	return deleted
}

func cleanupAutoPolicyFeatureStates() int {
	if !autoPolicyEnabled() {
		return 0
	}

	now := autoPolicyNow()
	autoPolicyFeatureMutex.Lock()
	deleted := cleanupAutoPolicyFeatureStatesLocked(now)
	autoPolicyFeatureMutex.Unlock()
	if deleted > 0 {
		if err := persistAutoPolicyFeatureStates(); err != nil {
			log.WithFields(log.Fields{"error": err}).Error("Failed to persist auto policy feature states")
		}
	}
	if deleted > 0 {
		appendAutoPolicyEvent(autoPolicyEvent{
			EventType:  "feature_aged",
			TargetType: "feature",
			Summary:    fmt.Sprintf("清理过期自动策略候选特征：%d 个", deleted),
			CreatedAt:  now,
			Extra: map[string]string{
				"feature_count": fmt.Sprintf("%d", deleted),
				"retention":     autoPolicyConfig.FeatureRetentionDuration.String(),
			},
		})
	}
	return deleted
}

func autoPolicySourceGroupSizeInfo(group string) (int, bool) {
	cacheMutexRLock()
	defer cacheMutexRUnlock()

	if gc, ok := groupCacheMap[group]; ok && gc.members != nil {
		size := gc.members.Cardinality()
		if size > 0 {
			return size, false
		}
	}
	return 1, true
}

func autoPolicySourceGroupSize(group string) int {
	size, _ := autoPolicySourceGroupSizeInfo(group)
	return size
}

func calculateBaselineScore(state *autoFeatureState, anomalyScore float64) (float64, []string) {
	if state == nil {
		return 0, nil
	}

	srcGroupSize := autoPolicySourceGroupSize(state.Key.From)
	fConsecutive := autoPolicyClamp01(float64(state.ConsecutiveWindows) / 6.0)
	fTotal := autoPolicyClamp01(float64(state.TotalWindows) / 12.0)
	fDays := autoPolicyClamp01(float64(state.DistinctDays) / 3.0)
	fSrcCoverage := autoPolicyClamp01(float64(len(state.SrcWorkloadsSeen)) / float64(srcGroupSize))
	fSafe := autoPolicyClamp01(1 - anomalyScore)

	score := 0.30*fConsecutive + 0.25*fTotal + 0.20*fDays + 0.15*fSrcCoverage + 0.10*fSafe
	reasons := autoPolicyStableReasonCodes("stable_windows", "distinct_days", "src_coverage")
	return score, reasons
}

type autoDecision struct {
	Class       share.AutoPolicyClass
	Confidence  float64
	ReasonCodes []string
}

func decideAutoPolicyClass(state *autoFeatureState, baselineScore float64, baselineReasons []string, periodicScore float64, periodicSlots []uint16, periodicReasons []string, anomalyScore float64, anomalyReasons []string, highConfidenceAnomaly bool) autoDecision {
	if state == nil {
		return autoDecision{}
	}

	if anomalyScore >= 0.80 || highConfidenceAnomaly {
		confidence := anomalyScore
		if highConfidenceAnomaly && confidence < 0.90 {
			confidence = 0.90
		}
		return autoDecision{
			Class:       share.AutoPolicyAnomaly,
			Confidence:  confidence,
			ReasonCodes: anomalyReasons,
		}
	}

	if state.DistinctDays >= 7 && periodicScore >= 0.70 && (baselineScore < 0.85 || periodicScore > baselineScore) && len(periodicSlots) > 0 {
		return autoDecision{
			Class:       share.AutoPolicyPeriodic,
			Confidence:  periodicScore,
			ReasonCodes: periodicReasons,
		}
	}

	if state.DistinctDays >= 3 && baselineScore >= 0.75 && anomalyScore <= 0.30 {
		return autoDecision{
			Class:       share.AutoPolicyBaseline,
			Confidence:  baselineScore,
			ReasonCodes: baselineReasons,
		}
	}

	return autoDecision{}
}

func applyAutoPolicyFastAdmissionDecision(state *autoFeatureState, decision autoDecision, anomalyScore float64) autoDecision {
	if state == nil || decision.Class != "" {
		return decision
	}

	semantics := autoPolicyFlowSemanticsForGroups(state.Key.From, state.Key.To)
	if anomalyScore >= 0.80 || autoPolicyShouldIgnoreFlow(state.Key.From, state.Key.To) {
		return decision
	}

	reasons := []string{}
	switch {
	case autoPolicyIsPortAuditNodeScanFlow(state.Key.From, state.Key.To):
		reasons = []string{
			"port_audit_node_scan_fast_admission",
			"node_surface_audit_required",
			"auto_aging_enabled",
		}
	case semantics.TrafficSource == autoPolicyTrafficZeroTrust:
		reasons = []string{
			"zero_trust_fast_admission",
			"observed_zero_trust_path",
			"auto_aging_enabled",
		}
	default:
		return decision
	}

	confidence := autoPolicyClamp01(1 - anomalyScore)
	if confidence < 0.65 {
		confidence = 0.65
	}
	return autoDecision{
		Class:       share.AutoPolicyBaseline,
		Confidence:  confidence,
		ReasonCodes: autoPolicyStableReasonCodes(reasons...),
	}
}

func sortedApplications(apps map[uint32]struct{}) []uint32 {
	if len(apps) == 0 {
		return nil
	}

	values := make([]uint32, 0, len(apps))
	for app := range apps {
		values = append(values, app)
	}
	sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
	return values
}

func sortedSetValues(values map[string]struct{}) []string {
	if len(values) == 0 {
		return nil
	}

	out := make([]string, 0, len(values))
	for value := range values {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func buildMergedPorts(ports map[string]struct{}) string {
	if len(ports) == 0 {
		return ""
	}

	type portRange struct {
		proto uint8
		low   uint16
		high  uint16
		raw   string
	}

	grouped := make(map[uint8][]portRange)
	rawTokens := make([]string, 0)
	for port := range ports {
		proto, low, high, err := utils.ParsePortRangeLink(port)
		if err != nil {
			rawTokens = append(rawTokens, port)
			continue
		}
		grouped[proto] = append(grouped[proto], portRange{proto: proto, low: low, high: high, raw: port})
	}

	out := make([]string, 0, len(ports))
	for proto, ranges := range grouped {
		sort.Slice(ranges, func(i, j int) bool {
			if ranges[i].low == ranges[j].low {
				return ranges[i].high < ranges[j].high
			}
			return ranges[i].low < ranges[j].low
		})

		cur := ranges[0]
		for _, next := range ranges[1:] {
			if next.low <= cur.high+1 {
				if next.high > cur.high {
					cur.high = next.high
				}
				continue
			}
			out = append(out, utils.GetPortRangeLink(proto, cur.low, cur.high))
			cur = next
		}
		out = append(out, utils.GetPortRangeLink(proto, cur.low, cur.high))
	}

	if len(rawTokens) > 0 {
		sort.Strings(rawTokens)
		out = append(out, rawTokens...)
	}
	sort.Strings(out)
	return strings.Join(out, ",")
}

func autoPolicyCloneRule(rule *share.CLUSPolicyRule) *share.CLUSPolicyRule {
	if rule == nil {
		return nil
	}
	clone := *rule
	if rule.Applications != nil {
		clone.Applications = append([]uint32{}, rule.Applications...)
	}
	return &clone
}

func autoPolicyPortsMatchProto(ports string, proto uint8) bool {
	if strings.TrimSpace(ports) == "" || ports == api.PolicyPortAny {
		return false
	}
	for _, token := range strings.Split(ports, ",") {
		if token == "" {
			continue
		}
		p, _, _, err := utils.ParsePortRangeLink(token)
		if err != nil || p != proto {
			return false
		}
	}
	return true
}

func autoPolicyRuleMatchesState(rule *share.CLUSPolicyRule, state *autoFeatureState) bool {
	if rule == nil || state == nil {
		return false
	}
	if rule.From != state.Key.From || rule.To != state.Key.To {
		return false
	}
	if state.Key.IsApp {
		expected := sortedApplications(state.Applications)
		if len(expected) == 0 && state.Key.Application > 0 {
			expected = []uint32{state.Key.Application}
		}
		if len(expected) != len(rule.Applications) {
			return false
		}
		for i := range expected {
			if expected[i] != rule.Applications[i] {
				return false
			}
		}
		return true
	}
	return len(rule.Applications) == 0 && autoPolicyPortsMatchProto(rule.Ports, state.Key.IPProto)
}

func findAutoPolicyRuleForState(state *autoFeatureState, class share.AutoPolicyClass, action string) (*share.CLUSPolicyRule, *share.CLUSAutoPolicyMeta) {
	cacheMutexRLock()
	defer cacheMutexRUnlock()

	var allowFallbackRule *share.CLUSPolicyRule
	var allowFallbackMeta *share.CLUSAutoPolicyMeta

	for ruleID, meta := range autoPolicyMetaMap {
		rule, ok := policyCache.ruleMap[ruleID]
		if !ok || rule == nil || rule.Action != action {
			continue
		}
		if !autoPolicyRuleMatchesState(rule, state) {
			continue
		}
		if meta.Class == class {
			return autoPolicyCloneRule(rule), cloneAutoPolicyMeta(meta)
		}
		if action == share.PolicyActionAllow && (meta.Class == share.AutoPolicyBaseline || meta.Class == share.AutoPolicyPeriodic) {
			allowFallbackRule = autoPolicyCloneRule(rule)
			allowFallbackMeta = cloneAutoPolicyMeta(meta)
		}
	}

	return allowFallbackRule, allowFallbackMeta
}

func autoPolicyMetaHasReason(meta *share.CLUSAutoPolicyMeta, reason string) bool {
	if meta == nil || strings.TrimSpace(reason) == "" {
		return false
	}
	for _, value := range meta.ReasonCodes {
		if strings.EqualFold(strings.TrimSpace(value), reason) {
			return true
		}
	}
	return false
}

func findManualOverrideAutoPolicyRuleForState(state *autoFeatureState) (*share.CLUSPolicyRule, *share.CLUSAutoPolicyMeta) {
	cacheMutexRLock()
	defer cacheMutexRUnlock()

	for ruleID, meta := range autoPolicyMetaMap {
		if !autoPolicyMetaHasReason(meta, "manual_override") {
			continue
		}
		rule, ok := policyCache.ruleMap[ruleID]
		if !ok || rule == nil {
			continue
		}
		if autoPolicyRuleMatchesState(rule, state) {
			return autoPolicyCloneRule(rule), cloneAutoPolicyMeta(meta)
		}
	}
	return nil, nil
}

func uint32SlicesEqual(left, right []uint32) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func stringSlicesEqual(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func buildAutoPolicyRuleChange(state *autoFeatureState, decision autoDecision, periodicSlots []uint16) (autoPolicyRuleChange, bool) {
	if state == nil || decision.Class == "" {
		return autoPolicyRuleChange{}, false
	}
	if autoPolicyFeatureUsesServiceIPGroup(state.Key) {
		return autoPolicyRuleChange{}, false
	}
	if autoPolicyShouldIgnoreFlow(state.Key.From, state.Key.To) {
		return autoPolicyRuleChange{}, false
	}
	if rule, _ := findManualOverrideAutoPolicyRuleForState(state); rule != nil {
		return autoPolicyRuleChange{}, false
	}

	now := autoPolicyNow()
	action := share.PolicyActionAllow
	if decision.Class == share.AutoPolicyAnomaly {
		action = share.PolicyActionDeny
	}

	rule := &share.CLUSPolicyRule{
		From:    state.Key.From,
		To:      state.Key.To,
		Action:  action,
		CfgType: share.Learned,
	}
	if state.Key.IsApp {
		rule.Ports = api.PolicyPortAny
		rule.Applications = sortedApplications(state.Applications)
		if len(rule.Applications) == 0 && state.Key.Application > 0 {
			rule.Applications = []uint32{state.Key.Application}
		}
	} else if specialPorts := autoPolicyInfrastructureRulePorts(state); specialPorts != "" {
		rule.Ports = specialPorts
	} else {
		rule.Ports = buildMergedPorts(state.Ports)
		if rule.Ports == "" {
			return autoPolicyRuleChange{}, false
		}
	}

	switch decision.Class {
	case share.AutoPolicyBaseline:
		rule.Comment = "auto baseline allow"
	case share.AutoPolicyPeriodic:
		rule.Comment = "auto periodic allow"
	case share.AutoPolicyAnomaly:
		rule.Comment = "auto anomaly deny"
	}

	meta := &share.CLUSAutoPolicyMeta{
		Class:        decision.Class,
		Confidence:   decision.Confidence,
		LastObserved: state.LastObserved,
		ReasonCodes:  append([]string{}, decision.ReasonCodes...),
	}
	if decision.Class == share.AutoPolicyPeriodic {
		meta.PeriodicSlots = append([]uint16{}, periodicSlots...)
	}
	if decision.Class == share.AutoPolicyAnomaly {
		meta.ExpiresAt = now.Add(autoPolicyConfig.AnomalyRuleTTL)
	}

	existingRule, existingMeta := findAutoPolicyRuleForState(state, decision.Class, action)
	if existingRule == nil && action == share.PolicyActionAllow {
		existingRule, existingMeta = findAutoPolicyRuleForState(state, share.AutoPolicyBaseline, action)
		if existingRule == nil {
			existingRule, existingMeta = findAutoPolicyRuleForState(state, share.AutoPolicyPeriodic, action)
		}
	}

	needsUpdate := false
	if existingRule == nil {
		rule.CreatedAt = now
		rule.LastModAt = now
		meta.CreatedAt = now
		needsUpdate = true
	} else {
		rule.ID = existingRule.ID
		rule.CreatedAt = existingRule.CreatedAt
		rule.LastModAt = now
		rule.MatchCntr = existingRule.MatchCntr
		rule.LastMatchAt = existingRule.LastMatchAt
		meta.RuleID = existingRule.ID
		if existingMeta != nil {
			meta.CreatedAt = existingMeta.CreatedAt
		} else {
			meta.CreatedAt = existingRule.CreatedAt
		}

		if existingRule.Action != rule.Action || existingRule.Comment != rule.Comment || existingRule.Ports != rule.Ports || !uint32SlicesEqual(existingRule.Applications, rule.Applications) {
			needsUpdate = true
		}
		if existingMeta == nil ||
			existingMeta.Class != meta.Class ||
			!periodicSlotsEqual(existingMeta.PeriodicSlots, meta.PeriodicSlots) ||
			!stringSlicesEqual(existingMeta.ReasonCodes, meta.ReasonCodes) ||
			(existingMeta.Confidence+0.05 < meta.Confidence) ||
			(decision.Class == share.AutoPolicyAnomaly && existingMeta.ExpiresAt.Before(meta.ExpiresAt.Add(-time.Second))) {
			needsUpdate = true
		}
	}

	if !needsUpdate {
		return autoPolicyRuleChange{}, false
	}

	return autoPolicyRuleChange{
		Op:             autoPolicyRuleUpsert,
		Rule:           rule,
		Meta:           meta,
		ExistingRuleID: rule.ID,
	}, true
}

func autoPolicyInfrastructureRulePorts(state *autoFeatureState) string {
	if state == nil || state.Key.IsApp {
		return ""
	}
	if autoPolicyIsPortAuditNodeScanFlow(state.Key.From, state.Key.To) {
		if state.Key.IPProto == 0 {
			return api.PolicyPortAny
		}
		return utils.GetPortRangeLink(state.Key.IPProto, 1, 65535)
	}
	return ""
}

func processObservationWindow() {
	events := drainObservedEvents()
	if len(events) == 0 {
		return
	}
	if !autoPolicyEnabled() || !isLeader() {
		return
	}

	aggregates, srcStats := aggregateObservedEvents(events)
	changes := make([]autoPolicyRuleChange, 0, len(aggregates))

	autoPolicyFeatureMutex.Lock()
	for _, agg := range aggregates {
		state := updateAutoFeatureState(agg)
		if state == nil {
			continue
		}
		anomalyScore, anomalyReasons, highConfidenceAnomaly := calculateAnomalyScore(state, agg, srcStats[agg.Key.From])
		baselineScore, baselineReasons := calculateBaselineScore(state, anomalyScore)
		periodicScore, periodicSlots, periodicReasons := calculatePeriodicScore(state)

		state.LastScores = autoFeatureScores{
			Baseline: baselineScore,
			Periodic: periodicScore,
			Anomaly:  anomalyScore,
		}

		decision := decideAutoPolicyClass(state, baselineScore, baselineReasons, periodicScore, periodicSlots, periodicReasons, anomalyScore, anomalyReasons, highConfidenceAnomaly)
		decision = applyAutoPolicyFastAdmissionDecision(state, decision, anomalyScore)
		state.ShadowClass = decision.Class
		state.ShadowConfidence = decision.Confidence
		state.ShadowReasons = append([]string{}, decision.ReasonCodes...)

		if autoPolicyEnforceEnabled() {
			if change, ok := buildAutoPolicyRuleChange(state, decision, periodicSlots); ok {
				changes = append(changes, change)
			}
		}
	}
	autoPolicyStats.LastWindowProcessedAt = autoPolicyNow()
	autoPolicyStats.LastWindowEventCount = len(events)
	agedFeatureCount := cleanupAutoPolicyFeatureStatesLocked(autoPolicyStats.LastWindowProcessedAt)
	autoPolicyFeatureMutex.Unlock()
	if err := persistAutoPolicyFeatureStates(); err != nil {
		log.WithFields(log.Fields{"error": err}).Error("Failed to persist auto policy feature states")
	}
	appendAutoPolicyEvent(autoPolicyEvent{
		EventType:  "window_processed",
		TargetType: "window",
		Summary:    fmt.Sprintf("完成窗口处理：%d 条观测事件，聚合为 %d 个特征", len(events), len(aggregates)),
		CreatedAt:  autoPolicyNow(),
		Extra: map[string]string{
			"event_count":   fmt.Sprintf("%d", len(events)),
			"feature_count": fmt.Sprintf("%d", len(aggregates)),
		},
	})
	if agedFeatureCount > 0 {
		appendAutoPolicyEvent(autoPolicyEvent{
			EventType:  "feature_aged",
			TargetType: "feature",
			Summary:    fmt.Sprintf("清理过期自动策略候选特征：%d 个", agedFeatureCount),
			CreatedAt:  autoPolicyStats.LastWindowProcessedAt,
			Extra: map[string]string{
				"feature_count": fmt.Sprintf("%d", agedFeatureCount),
				"retention":     autoPolicyConfig.FeatureRetentionDuration.String(),
			},
		})
	}

	if autoPolicyEnforceEnabled() && len(changes) > 0 {
		applyAutoPolicyChanges(changes)
	}
}

func buildAutoPolicyDecisionFromFeatureState(state *autoFeatureState) (autoDecision, []uint16) {
	if state == nil {
		return autoDecision{}, nil
	}

	anomalyScore := state.LastScores.Anomaly
	highConfidenceAnomaly := state.ShadowClass == share.AutoPolicyAnomaly && state.ShadowConfidence >= 0.80
	if highConfidenceAnomaly && anomalyScore < state.ShadowConfidence {
		anomalyScore = state.ShadowConfidence
	}

	anomalyReasons := []string{}
	if state.ShadowClass == share.AutoPolicyAnomaly {
		anomalyReasons = append(anomalyReasons, state.ShadowReasons...)
	}

	baselineScore, baselineReasons := calculateBaselineScore(state, anomalyScore)
	periodicScore, periodicSlots, periodicReasons := calculatePeriodicScore(state)
	state.LastScores = autoFeatureScores{
		Baseline: baselineScore,
		Periodic: periodicScore,
		Anomaly:  anomalyScore,
	}

	decision := decideAutoPolicyClass(
		state,
		baselineScore,
		baselineReasons,
		periodicScore,
		periodicSlots,
		periodicReasons,
		anomalyScore,
		anomalyReasons,
		highConfidenceAnomaly,
	)
	decision = applyAutoPolicyFastAdmissionDecision(state, decision, anomalyScore)
	state.ShadowClass = decision.Class
	state.ShadowConfidence = decision.Confidence
	state.ShadowReasons = append([]string{}, decision.ReasonCodes...)

	return decision, periodicSlots
}

func promoteAutoPolicyCandidatesOnModeSwitch() int {
	if !autoPolicyEnforceEnabled() || !isLeader() {
		return 0
	}

	changes := make([]autoPolicyRuleChange, 0)
	changes = append(changes, adoptLegacyLearnedRulesAsAutoBaseline()...)
	autoPolicyFeatureMutex.Lock()
	for _, state := range autoPolicyFeatureMap {
		if autoPolicyShouldIgnoreFlow(state.Key.From, state.Key.To) {
			continue
		}
		decision, periodicSlots := buildAutoPolicyDecisionFromFeatureState(state)
		if change, ok := buildAutoPolicyRuleChange(state, decision, periodicSlots); ok {
			changes = append(changes, change)
		}
	}
	autoPolicyFeatureMutex.Unlock()

	cacheMutexRLock()
	changes = append(changes, collectIgnoredAutoPolicyRuleDeletesLocked()...)
	cacheMutexRUnlock()

	if len(changes) > 0 {
		applyAutoPolicyChanges(changes)
	}
	return len(changes)
}

func adoptLegacyLearnedRulesAsAutoBaseline() []autoPolicyRuleChange {
	cacheMutexRLock()
	defer cacheMutexRUnlock()

	now := autoPolicyNow()
	changes := make([]autoPolicyRuleChange, 0)
	for _, head := range adjustPolicyRuleHeads() {
		rule, ok := policyCache.ruleMap[head.ID]
		if !ok || rule == nil || rule.Disable || rule.CfgType != share.Learned {
			continue
		}
		if _, ok := autoPolicyMetaMap[rule.ID]; ok {
			continue
		}
		if autoPolicyShouldIgnoreFlow(rule.From, rule.To) {
			continue
		}
		cloned := autoPolicyCloneRule(rule)
		if cloned == nil {
			continue
		}
		changes = append(changes, autoPolicyRuleChange{
			Op:   autoPolicyRuleUpsert,
			Rule: cloned,
			Meta: &share.CLUSAutoPolicyMeta{
				RuleID:       cloned.ID,
				Class:        share.AutoPolicyBaseline,
				Confidence:   0.70,
				CreatedAt:    now,
				LastObserved: now,
				ReasonCodes:  []string{"legacy_learned_migration", "auto_policy_protect_mode"},
			},
		})
	}
	return changes
}

func applyAutoPolicyChanges(changes []autoPolicyRuleChange) {
	if len(changes) == 0 {
		return
	}

	lock, err := clusHelper.AcquireLock(share.CLUSLockPolicyKey, policyClusterLockWait)
	if err != nil {
		log.WithFields(log.Fields{"error": err}).Error("Acquire policy lock for auto policy")
		return
	}
	defer clusHelper.ReleaseLock(lock)

	crhs := clusHelper.GetPolicyRuleList()
	ids := utils.NewSet()
	for _, head := range crhs {
		ids.Add(head.ID)
	}

	heads := make([]*share.CLUSRuleHead, 0, len(crhs)+len(changes))
	for _, head := range crhs {
		heads = append(heads, &share.CLUSRuleHead{ID: head.ID, CfgType: head.CfgType, Priority: head.Priority})
	}

	headIndex := make(map[uint32]int, len(heads))
	for idx, head := range heads {
		headIndex[head.ID] = idx
	}

	txn := cluster.Transact()
	defer txn.Close()
	upsertCount := 0
	deleteCount := 0
	appliedEvents := make([]autoPolicyEvent, 0, len(changes))

	for _, change := range changes {
		switch change.Op {
		case autoPolicyRuleDelete:
			deleteID := change.ExistingRuleID
			if deleteID == 0 {
				continue
			}
			deleteCount++
			cacheMutexRLock()
			meta := cloneAutoPolicyMeta(autoPolicyMetaMap[deleteID])
			rule := autoPolicyCloneRule(policyCache.ruleMap[deleteID])
			cacheMutexRUnlock()
			if idx, ok := headIndex[deleteID]; ok {
				copy(heads[idx:], heads[idx+1:])
				heads = heads[:len(heads)-1]
				delete(headIndex, deleteID)
				for i := idx; i < len(heads); i++ {
					headIndex[heads[i].ID] = i
				}
			}
			_ = clusHelper.DeletePolicyRuleTxn(txn, deleteID)
			txn.Delete(share.CLUSAutoPolicyMetaKey(deleteID))
			class := share.AutoPolicyClass("")
			targetKey := fmt.Sprintf("rule:%d", deleteID)
			if meta != nil {
				class = meta.Class
			}
			if rule != nil {
				targetKey = fmt.Sprintf("%s -> %s", rule.From, rule.To)
			}
			appliedEvents = append(appliedEvents, autoPolicyEvent{
				EventType:  "rule_deleted",
				EventClass: class,
				TargetType: "rule",
				TargetID:   deleteID,
				TargetKey:  targetKey,
				Summary:    fmt.Sprintf("删除自动策略规则 #%d（%s）", deleteID, class),
				CreatedAt:  autoPolicyNow(),
			})
		case autoPolicyRuleUpsert:
			if change.Rule == nil || change.Meta == nil {
				continue
			}
			upsertCount++
			if change.Rule.ID == 0 {
				change.Rule.ID = common.GetAvailablePolicyID(ids, share.Learned)
				change.Meta.RuleID = change.Rule.ID
				ids.Add(change.Rule.ID)
				heads = append(heads, &share.CLUSRuleHead{ID: change.Rule.ID, CfgType: share.Learned})
				headIndex[change.Rule.ID] = len(heads) - 1
			} else if _, ok := headIndex[change.Rule.ID]; !ok {
				heads = append(heads, &share.CLUSRuleHead{ID: change.Rule.ID, CfgType: share.Learned})
				headIndex[change.Rule.ID] = len(heads) - 1
			}

			if change.Rule.CreatedAt.IsZero() {
				change.Rule.CreatedAt = autoPolicyNow()
			}
			if change.Rule.LastModAt.IsZero() {
				change.Rule.LastModAt = autoPolicyNow()
			}
			if change.Meta.CreatedAt.IsZero() {
				change.Meta.CreatedAt = change.Rule.CreatedAt
			}
			change.Meta.RuleID = change.Rule.ID

			_ = clusHelper.PutPolicyRuleTxn(txn, change.Rule)
			if value, err := json.Marshal(change.Meta); err == nil {
				txn.Put(share.CLUSAutoPolicyMetaKey(change.Rule.ID), value)
			}
			eventType := "rule_upserted"
			switch change.Meta.Class {
			case share.AutoPolicyBaseline:
				eventType = "baseline_promoted"
			case share.AutoPolicyPeriodic:
				eventType = "periodic_promoted"
			case share.AutoPolicyAnomaly:
				eventType = "anomaly_promoted"
			}
			appliedEvents = append(appliedEvents, autoPolicyEvent{
				EventType:  eventType,
				EventClass: change.Meta.Class,
				TargetType: "rule",
				TargetID:   change.Rule.ID,
				TargetKey:  fmt.Sprintf("%s -> %s", change.Rule.From, change.Rule.To),
				Summary:    fmt.Sprintf("生成或更新自动策略规则 #%d（%s）", change.Rule.ID, change.Meta.Class),
				CreatedAt:  autoPolicyNow(),
			})
		}
	}

	if err := clusHelper.PutPolicyRuleListTxn(txn, heads); err != nil {
		log.WithFields(log.Fields{"error": err}).Error("Failed to write auto policy rule list")
		return
	}

	if ok, err := txn.Apply(); err != nil {
		log.WithFields(log.Fields{"error": err}).Error("Failed to apply auto policy transaction")
		return
	} else if !ok {
		log.Error("Auto policy transaction rejected")
		return
	}

	now := autoPolicyNow()
	if upsertCount > 0 {
		autoPolicyStats.PromotionCount += uint64(upsertCount)
		autoPolicyStats.LastPromotionAt = now
	}
	if deleteCount > 0 {
		autoPolicyStats.DeleteCount += uint64(deleteCount)
		autoPolicyStats.LastDeleteAt = now
	}
	for _, event := range appliedEvents {
		appendAutoPolicyEvent(event)
	}
}

func cleanupExpiredAnomalyRules() {
	if !autoPolicyEnforceEnabled() || !isLeader() {
		return
	}

	now := autoPolicyNow()
	cacheMutexRLock()
	changes := make([]autoPolicyRuleChange, 0)
	for ruleID, meta := range autoPolicyMetaMap {
		if meta.Class == autoPolicySystemGuardSuppressedClass {
			continue
		}
		if meta.Class == share.AutoPolicyAnomaly && !meta.ExpiresAt.IsZero() && !meta.ExpiresAt.After(now) {
			changes = append(changes, autoPolicyRuleChange{
				Op:             autoPolicyRuleDelete,
				ExistingRuleID: ruleID,
			})
		}
	}
	cacheMutexRUnlock()

	if len(changes) > 0 {
		applyAutoPolicyChanges(changes)
	}
}

func collectIgnoredAutoPolicyRuleDeletesLocked() []autoPolicyRuleChange {
	changes := make([]autoPolicyRuleChange, 0)
	for ruleID, meta := range autoPolicyMetaMap {
		if meta == nil || meta.Class == autoPolicySystemGuardSuppressedClass {
			continue
		}
		rule, ok := policyCache.ruleMap[ruleID]
		if !ok || rule == nil {
			continue
		}
		if autoPolicyShouldIgnoreFlow(rule.From, rule.To) || autoPolicyRuleUsesServiceIPGroup(rule) {
			changes = append(changes, autoPolicyRuleChange{
				Op:             autoPolicyRuleDelete,
				ExistingRuleID: ruleID,
			})
		}
	}
	return changes
}

func cleanupInvalidAutoPolicyRules() {
	if !isLeader() {
		return
	}

	cacheMutexRLock()
	invalidChanges := collectIgnoredAutoPolicyRuleDeletesLocked()
	cacheMutexRUnlock()
	if len(invalidChanges) > 0 {
		applyAutoPolicyChanges(invalidChanges)
	}
}

func cleanupAutoPolicyRules() {
	cleanupAutoPolicyFeatureStates()
	cleanupInvalidAutoPolicyRules()

	if !autoPolicyEnforceEnabled() {
		return
	}

	now := autoPolicyNow()
	cacheMutexRLock()
	changes := make([]autoPolicyRuleChange, 0)
	for ruleID, meta := range autoPolicyMetaMap {
		if meta.Class == autoPolicySystemGuardSuppressedClass {
			continue
		}
		if meta.Class == share.AutoPolicyAnomaly {
			continue
		}

		rule, ok := policyCache.ruleMap[ruleID]
		if !ok || rule == nil {
			changes = append(changes, autoPolicyRuleChange{
				Op:             autoPolicyRuleDelete,
				ExistingRuleID: ruleID,
			})
			continue
		}

		agingDuration := autoPolicyConfig.BaselineAgingDuration
		if meta.Class == share.AutoPolicyPeriodic {
			agingDuration = autoPolicyConfig.PeriodicAgingDuration
		}

		lastSeen := rule.LastMatchAt
		if lastSeen.IsZero() {
			lastSeen = rule.CreatedAt
		}
		if !lastSeen.IsZero() && now.Sub(lastSeen) >= agingDuration {
			changes = append(changes, autoPolicyRuleChange{
				Op:             autoPolicyRuleDelete,
				ExistingRuleID: ruleID,
			})
		}
	}
	cacheMutexRUnlock()

	if len(changes) > 0 {
		applyAutoPolicyChanges(changes)
	}
}

func checkAutoPolicySchedule() {
	if !autoPolicyEnforceEnabled() {
		return
	}

	slot := autoPolicySlotIndex(autoPolicyNow())
	if slot == autoPolicyLastScheduleSlot {
		return
	}
	autoPolicyLastScheduleSlot = slot

	cacheMutexRLock()
	defer cacheMutexRUnlock()
	for _, meta := range autoPolicyMetaMap {
		if meta.Class == share.AutoPolicyPeriodic {
			scheduleIPPolicyCalculation(true)
			return
		}
	}
}
