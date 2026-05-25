package cache

import (
	"fmt"
	"net"
	"sort"
	"strings"

	"github.com/wushuang233/MicroSegX/microsegx/controller/access"
	"github.com/wushuang233/MicroSegX/microsegx/controller/api"
	"github.com/wushuang233/MicroSegX/microsegx/controller/common"
	"github.com/wushuang233/MicroSegX/microsegx/share"
)

const (
	autoPolicyTrafficDirect    = "direct"
	autoPolicyTrafficIngress   = "ingress"
	autoPolicyTrafficSystem    = "system"
	autoPolicyTrafficZeroTrust = "zero_trust"
)

type autoPolicyEndpointSemantics struct {
	Namespace string
	Business  string
	System    bool
	Ingress   bool
	ZeroTrust bool
}

type autoPolicyFlowSemantics struct {
	DisplayKey    string
	FromNamespace string
	ToNamespace   string
	Namespace     string
	FromBusiness  string
	ToBusiness    string
	Business      string
	TrafficSource string
	ZeroTrust     bool
}

func autoPolicyFeatureKeyString(key autoFeatureKey) string {
	if key.IsApp {
		return fmt.Sprintf("%s -> %s | app:%d", key.From, key.To, key.Application)
	}
	return fmt.Sprintf("%s -> %s | proto:%d", key.From, key.To, key.IPProto)
}

func autoPolicyEndpointSemanticsForGroup(group string) autoPolicyEndpointSemantics {
	trimmed := strings.TrimSpace(group)
	lower := strings.ToLower(trimmed)
	resp := autoPolicyEndpointSemantics{
		Namespace: "unknown",
		Business:  "unknown",
	}
	if trimmed == "" {
		return resp
	}

	workloadPrefix := strings.ToLower(api.LearnedWorkloadPrefix)
	hostPrefix := strings.ToLower(api.LearnedHostPrefix)
	switch {
	case strings.HasPrefix(lower, workloadPrefix):
		name := strings.TrimSpace(trimmed[len(api.LearnedWorkloadPrefix):])
		resp.Namespace = "workload"
		resp.Business = autoPolicyNormalizeSemanticLabel(name)
		if strings.EqualFold(name, api.EndpointIngress) {
			resp.Namespace = "external"
			resp.Business = "ingress"
			resp.Ingress = true
		}
	case strings.HasPrefix(lower, hostPrefix):
		resp.Namespace = "host"
		resp.Business = "host"
	case strings.HasPrefix(lower, "nv.ip."):
		raw := strings.TrimSpace(trimmed[len("nv.ip."):])
		parts := strings.Split(raw, ".")
		if len(parts) >= 2 {
			resp.Namespace = autoPolicyNormalizeSemanticLabel(parts[len(parts)-1])
			resp.Business = autoPolicyNormalizeSemanticLabel(strings.Join(parts[:len(parts)-1], "."))
		} else if raw != "" {
			resp.Namespace = "unknown"
			resp.Business = autoPolicyNormalizeSemanticLabel(raw)
		}
	case strings.HasPrefix(lower, "nv."):
		raw := strings.TrimSpace(trimmed[3:])
		parts := strings.Split(raw, ".")
		if len(parts) >= 2 {
			resp.Namespace = autoPolicyNormalizeSemanticLabel(parts[len(parts)-1])
			resp.Business = autoPolicyNormalizeSemanticLabel(strings.Join(parts[:len(parts)-1], "."))
		} else if raw != "" {
			resp.Namespace = "default"
			resp.Business = autoPolicyNormalizeSemanticLabel(raw)
		}
	default:
		resp.Business = autoPolicyNormalizeSemanticLabel(trimmed)
	}

	if resp.Business == "" {
		resp.Business = "unknown"
	}
	if resp.Namespace == "" {
		resp.Namespace = "unknown"
	}

	resp.ZeroTrust = strings.Contains(lower, "ziti") ||
		strings.Contains(lower, "openziti") ||
		resp.Namespace == "openziti"
	resp.System = resp.ZeroTrust ||
		resp.Namespace == "microsegx" ||
		resp.Namespace == "port-audit" ||
		resp.Namespace == "openziti" ||
		autoPolicyIsSystemGuardGroup(trimmed)
	return resp
}

func autoPolicyNormalizeSemanticLabel(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	value = strings.Trim(value, ".:/ ")
	if value == "" {
		return ""
	}
	return value
}

func autoPolicyJoinSemanticLabels(left, right string) string {
	left = strings.TrimSpace(left)
	right = strings.TrimSpace(right)
	switch {
	case left == "" && right == "":
		return ""
	case left == "":
		return right
	case right == "":
		return left
	case left == right:
		return left
	default:
		return fmt.Sprintf("%s -> %s", left, right)
	}
}

func autoPolicyFlowSemanticsForGroups(from, to string) autoPolicyFlowSemantics {
	fromSem := autoPolicyEndpointSemanticsForGroup(from)
	toSem := autoPolicyEndpointSemanticsForGroup(to)
	resp := autoPolicyFlowSemantics{
		DisplayKey:    fmt.Sprintf("%s -> %s", from, to),
		FromNamespace: fromSem.Namespace,
		ToNamespace:   toSem.Namespace,
		Namespace:     autoPolicyJoinSemanticLabels(fromSem.Namespace, toSem.Namespace),
		FromBusiness:  fromSem.Business,
		ToBusiness:    toSem.Business,
		Business:      autoPolicyJoinSemanticLabels(fromSem.Business, toSem.Business),
		TrafficSource: autoPolicyTrafficDirect,
		ZeroTrust:     fromSem.ZeroTrust || toSem.ZeroTrust,
	}

	switch {
	case fromSem.ZeroTrust || toSem.ZeroTrust:
		// Zero-trust access is a multi-hop path. The controller/router access
		// side and router-to-backend side must be classified before learning so
		// they do not collapse into normal ingress or generic system traffic.
		resp.TrafficSource = autoPolicyTrafficZeroTrust
	case fromSem.Ingress || toSem.Ingress:
		resp.TrafficSource = autoPolicyTrafficIngress
	case fromSem.System || toSem.System:
		resp.TrafficSource = autoPolicyTrafficSystem
	}
	return resp
}

func autoPolicyAppendFeatureDisplayDetails(base string, ports []string, isApp bool, app uint32, source string) string {
	parts := []string{base}
	if isApp && app > 0 {
		parts = append(parts, fmt.Sprintf("app:%d", app))
	} else if len(ports) > 0 {
		cleanPorts := make([]string, 0, len(ports))
		for _, port := range ports {
			if trimmed := strings.TrimSpace(port); trimmed != "" {
				cleanPorts = append(cleanPorts, trimmed)
			}
		}
		if len(cleanPorts) > 0 {
			parts = append(parts, strings.Join(cleanPorts, ","))
		}
	}
	if source != "" {
		parts = append(parts, source)
	}
	return strings.Join(parts, " | ")
}

func autoPolicyCloneFeatureState(feature *autoFeatureState) *autoFeatureState {
	if feature == nil {
		return nil
	}

	clone := *feature
	if feature.DaysSeen != nil {
		clone.DaysSeen = make(map[int64]struct{}, len(feature.DaysSeen))
		for key := range feature.DaysSeen {
			clone.DaysSeen[key] = struct{}{}
		}
	}
	if feature.SrcWorkloadsSeen != nil {
		clone.SrcWorkloadsSeen = make(map[string]struct{}, len(feature.SrcWorkloadsSeen))
		for key := range feature.SrcWorkloadsSeen {
			clone.SrcWorkloadsSeen[key] = struct{}{}
		}
	}
	if feature.Ports != nil {
		clone.Ports = make(map[string]struct{}, len(feature.Ports))
		for key := range feature.Ports {
			clone.Ports[key] = struct{}{}
		}
	}
	if feature.FQDNs != nil {
		clone.FQDNs = make(map[string]struct{}, len(feature.FQDNs))
		for key := range feature.FQDNs {
			clone.FQDNs[key] = struct{}{}
		}
	}
	if feature.Applications != nil {
		clone.Applications = make(map[uint32]struct{}, len(feature.Applications))
		for key := range feature.Applications {
			clone.Applications[key] = struct{}{}
		}
	}
	if feature.SlotCounters != nil {
		clone.SlotCounters = make(map[uint16]uint32, len(feature.SlotCounters))
		for key, value := range feature.SlotCounters {
			clone.SlotCounters[key] = value
		}
	}
	clone.ShadowReasons = append([]string{}, feature.ShadowReasons...)
	return &clone
}

func autoPolicySortedActiveSlots(state *autoFeatureState) []uint16 {
	if state == nil || len(state.SlotCounters) == 0 {
		return nil
	}

	slots := make([]uint16, 0, len(state.SlotCounters))
	for slot, hits := range state.SlotCounters {
		if hits > 0 {
			slots = append(slots, slot)
		}
	}
	sort.Slice(slots, func(i, j int) bool { return slots[i] < slots[j] })
	return slots
}

func autoPolicySourceCoverage(state *autoFeatureState) float64 {
	if state == nil {
		return 0
	}
	size, _ := autoPolicySourceGroupSizeInfo(state.Key.From)
	return autoPolicyClamp01(float64(len(state.SrcWorkloadsSeen)) / float64(size))
}

func autoPolicyRelatedRuleForFeature(state *autoFeatureState) (*share.CLUSPolicyRule, *share.CLUSAutoPolicyMeta) {
	if state == nil {
		return nil, nil
	}

	action := share.PolicyActionAllow
	if state.ShadowClass == share.AutoPolicyAnomaly {
		action = share.PolicyActionDeny
	}
	if rule, meta := findAutoPolicyRuleForState(state, state.ShadowClass, action); rule != nil {
		return rule, meta
	}
	if action == share.PolicyActionAllow {
		if rule, meta := findAutoPolicyRuleForState(state, "", action); rule != nil {
			return rule, meta
		}
	}
	return nil, nil
}

func autoPolicyFeatureStage(state *autoFeatureState) string {
	if state == nil {
		return "observing"
	}
	if rule, _ := autoPolicyRelatedRuleForFeature(state); rule != nil {
		return "promoted"
	}
	if state.ShadowClass != "" {
		return "candidate"
	}
	return "observing"
}

func autoPolicyFeatureToREST(state *autoFeatureState) *api.RESTAutoPolicyFeature {
	if state == nil {
		return nil
	}

	relatedRule, _ := autoPolicyRelatedRuleForFeature(state)
	sourceGroupSize, sourceGroupSizeEstimated := autoPolicySourceGroupSizeInfo(state.Key.From)
	ports := sortedSetValues(state.Ports)
	semantics := autoPolicyFlowSemanticsForGroups(state.Key.From, state.Key.To)
	actionHint := "observe"
	switch state.ShadowClass {
	case share.AutoPolicyBaseline, share.AutoPolicyPeriodic:
		actionHint = share.PolicyActionAllow
	case share.AutoPolicyAnomaly:
		actionHint = share.PolicyActionDeny
	}

	resp := &api.RESTAutoPolicyFeature{
		FeatureKey:               autoPolicyFeatureKeyString(state.Key),
		DisplayKey:               autoPolicyAppendFeatureDisplayDetails(semantics.DisplayKey, ports, state.Key.IsApp, state.Key.Application, semantics.TrafficSource),
		From:                     state.Key.From,
		To:                       state.Key.To,
		FromNamespace:            semantics.FromNamespace,
		ToNamespace:              semantics.ToNamespace,
		Namespace:                semantics.Namespace,
		FromBusiness:             semantics.FromBusiness,
		ToBusiness:               semantics.ToBusiness,
		Business:                 semantics.Business,
		TrafficSource:            semantics.TrafficSource,
		ZeroTrust:                semantics.ZeroTrust,
		IsApp:                    state.Key.IsApp,
		IPProto:                  state.Key.IPProto,
		Application:              state.Key.Application,
		Ports:                    ports,
		FQDNs:                    sortedSetValues(state.FQDNs),
		ActionHint:               actionHint,
		ClassHint:                string(state.ShadowClass),
		Stage:                    autoPolicyFeatureStage(state),
		BaselineScore:            state.LastScores.Baseline,
		PeriodicScore:            state.LastScores.Periodic,
		AnomalyScore:             state.LastScores.Anomaly,
		ConsecutiveWindows:       state.ConsecutiveWindows,
		HistoricalWindows:        state.TotalWindows,
		DistinctDays:             state.DistinctDays,
		WorkloadCoverage:         autoPolicySourceCoverage(state),
		SourceWorkloadCount:      len(state.SrcWorkloadsSeen),
		SourceGroupSize:          sourceGroupSize,
		SourceGroupSizeEstimated: sourceGroupSizeEstimated,
		ActiveSlots:              autoPolicySortedActiveSlots(state),
		ReasonCodes:              append([]string{}, state.ShadowReasons...),
	}
	resp.ActiveSlotCount = len(resp.ActiveSlots)
	if relatedRule != nil {
		resp.RelatedRuleID = relatedRule.ID
	}
	if !state.LastObserved.IsZero() {
		resp.LastSeenTS = state.LastObserved.UTC().Unix()
	}
	return resp
}

func autoPolicyCandidateToREST(feature *autoFeatureState) *api.RESTAutoPolicyCandidate {
	if feature == nil || feature.ShadowClass == "" {
		return nil
	}

	ports := sortedSetValues(feature.Ports)
	semantics := autoPolicyFlowSemanticsForGroups(feature.Key.From, feature.Key.To)
	resp := &api.RESTAutoPolicyCandidate{
		From:                feature.Key.From,
		To:                  feature.Key.To,
		DisplayKey:          autoPolicyAppendFeatureDisplayDetails(semantics.DisplayKey, ports, feature.Key.IsApp, feature.Key.Application, semantics.TrafficSource),
		FromNamespace:       semantics.FromNamespace,
		ToNamespace:         semantics.ToNamespace,
		Namespace:           semantics.Namespace,
		FromBusiness:        semantics.FromBusiness,
		ToBusiness:          semantics.ToBusiness,
		Business:            semantics.Business,
		TrafficSource:       semantics.TrafficSource,
		ZeroTrust:           semantics.ZeroTrust,
		IsApp:               feature.Key.IsApp,
		IPProto:             feature.Key.IPProto,
		Application:         feature.Key.Application,
		Ports:               ports,
		FQDNs:               sortedSetValues(feature.FQDNs),
		Class:               string(feature.ShadowClass),
		Confidence:          feature.ShadowConfidence,
		ReasonCodes:         append([]string{}, feature.ShadowReasons...),
		DistinctDays:        feature.DistinctDays,
		ConsecutiveWindows:  feature.ConsecutiveWindows,
		TotalWindows:        feature.TotalWindows,
		SourceWorkloadCount: len(feature.SrcWorkloadsSeen),
		BaselineScore:       feature.LastScores.Baseline,
		PeriodicScore:       feature.LastScores.Periodic,
		AnomalyScore:        feature.LastScores.Anomaly,
	}
	resp.SourceGroupSize, resp.SourceGroupSizeEstimated = autoPolicySourceGroupSizeInfo(feature.Key.From)
	if !feature.LastObserved.IsZero() {
		resp.LastObservedTS = feature.LastObserved.UTC().Unix()
	}
	return resp
}

func autoPolicyFindFeatureForRule(rule *share.CLUSPolicyRule) *autoFeatureState {
	if rule == nil {
		return nil
	}

	autoPolicyFeatureMutex.RLock()
	defer autoPolicyFeatureMutex.RUnlock()

	var matched *autoFeatureState
	for _, feature := range autoPolicyFeatureMap {
		if feature == nil || autoPolicyFeatureUsesServiceIPGroup(feature.Key) {
			continue
		}
		if !autoPolicyRuleMatchesState(rule, feature) {
			continue
		}
		if matched == nil || feature.LastObserved.After(matched.LastObserved) {
			matched = autoPolicyCloneFeatureState(feature)
		}
	}
	return matched
}

func autoPolicyPeriodicSlotSummary(slots []uint16) string {
	if len(slots) == 0 {
		return ""
	}
	parts := make([]string, 0, len(slots))
	for _, slot := range slots {
		parts = append(parts, fmt.Sprintf("%d", slot))
	}
	return strings.Join(parts, ", ")
}

func autoPolicyRuleCompileState(meta *share.CLUSAutoPolicyMeta) (string, bool, string, int64) {
	if meta == nil {
		return "inactive", false, "", 0
	}
	if !autoPolicyEnforceEnabled() {
		return "inactive", false, "shadow_mode", 0
	}

	now := autoPolicyNow()
	switch meta.Class {
	case share.AutoPolicyPeriodic:
		active := isPeriodicRuleActive(meta, now)
		if active {
			return "active", true, "", 0
		}
		return "scheduled", false, "outside_periodic_slot", 0
	case share.AutoPolicyAnomaly:
		if !meta.ExpiresAt.IsZero() && !meta.ExpiresAt.After(now) {
			return "expired", false, "ttl_expired", 0
		}
		ttl := int64(0)
		if !meta.ExpiresAt.IsZero() {
			ttl = int64(meta.ExpiresAt.Sub(now).Seconds())
			if ttl < 0 {
				ttl = 0
			}
		}
		return "active", true, "", ttl
	default:
		return "active", true, "", 0
	}
}

func autoPolicyIncrementTrafficSourceCount(source string, direct, ingress, zeroTrust, system *int) {
	switch strings.ToLower(strings.TrimSpace(source)) {
	case autoPolicyTrafficZeroTrust:
		(*zeroTrust)++
	case autoPolicyTrafficIngress:
		(*ingress)++
	case autoPolicyTrafficSystem:
		(*system)++
	default:
		(*direct)++
	}
}

func autoPolicyRuleEndpointState(name string) (bool, int, int) {
	name = strings.TrimSpace(name)
	if name == "" {
		return false, 0, 0
	}

	switch name {
	case api.LearnedExternal, api.FedExternalGroup, api.AllContainerGroup, api.AllHostGroup,
		api.FedAllContainerGroup, api.FedAllHostGroup:
		return true, 0, 0
	}
	if strings.HasPrefix(name, api.LearnedWorkloadPrefix) {
		workloadName := strings.TrimPrefix(name, api.LearnedWorkloadPrefix)
		if workloadName == api.EndpointIngress {
			return true, 0, 0
		}
		if wlCache, ok := wlCacheMap[workloadName]; ok && wlCache != nil && wlCache.workload != nil {
			return true, 1, 0
		}
		if wlCache, ok := nvwlCacheMap[workloadName]; ok && wlCache != nil && wlCache.workload != nil {
			return true, 1, 0
		}
		if ip := net.ParseIP(workloadName); ip != nil {
			if digest, ok := ipWLMap[ip.String()]; ok && digest != nil && digest.alive {
				return true, 1, 0
			}
		}
		return false, 0, 0
	}
	if strings.HasPrefix(name, api.LearnedHostPrefix) {
		hostName := strings.TrimPrefix(name, api.LearnedHostPrefix)
		if hostCache, ok := hostCacheMap[hostName]; ok && hostCache != nil && hostCache.host != nil {
			return true, 1, 0
		}
		if ip := net.ParseIP(hostName); ip != nil {
			if digest, ok := ipHostMap[ip.String()]; ok && digest != nil {
				return true, 1, 0
			}
			return true, 0, 0
		}
		return false, 0, 0
	}

	gc, ok := groupCacheMap[name]
	if !ok || gc == nil {
		return false, 0, 0
	}

	memberCount := 0
	if gc.members != nil {
		memberCount = gc.members.Cardinality()
	}
	serviceCount := 0
	if gc.svcAddrs != nil {
		serviceCount = gc.svcAddrs.Cardinality()
	}
	return memberCount+serviceCount > 0, memberCount, serviceCount
}

func autoPolicyRuleToREST(rule *share.CLUSPolicyRule, meta *share.CLUSAutoPolicyMeta) *api.RESTAutoPolicyRule {
	if rule == nil || meta == nil {
		return nil
	}

	feature := autoPolicyFindFeatureForRule(rule)
	compileState, activeNow, pendingReason, ttlRemaining := autoPolicyRuleCompileState(meta)
	fromLive, fromEndpointCount, fromServiceCount := autoPolicyRuleEndpointState(rule.From)
	toLive, toEndpointCount, toServiceCount := autoPolicyRuleEndpointState(rule.To)
	semantics := autoPolicyFlowSemanticsForGroups(rule.From, rule.To)
	resp := &api.RESTAutoPolicyRule{
		ID:                  rule.ID,
		Class:               string(meta.Class),
		DisplayKey:          autoPolicyAppendFeatureDisplayDetails(semantics.DisplayKey, strings.Split(strings.TrimSpace(rule.Ports), ","), len(rule.Applications) > 0, 0, semantics.TrafficSource),
		FromNamespace:       semantics.FromNamespace,
		ToNamespace:         semantics.ToNamespace,
		Namespace:           semantics.Namespace,
		FromBusiness:        semantics.FromBusiness,
		ToBusiness:          semantics.ToBusiness,
		Business:            semantics.Business,
		TrafficSource:       semantics.TrafficSource,
		ZeroTrust:           semantics.ZeroTrust,
		Confidence:          meta.Confidence,
		Active:              activeNow,
		ActiveNow:           activeNow,
		Stale:               !fromLive || !toLive,
		FromLive:            fromLive,
		ToLive:              toLive,
		FromEndpointCount:   fromEndpointCount,
		ToEndpointCount:     toEndpointCount,
		FromServiceCount:    fromServiceCount,
		ToServiceCount:      toServiceCount,
		Stage:               "promoted",
		CompileState:        compileState,
		PeriodicSlots:       append([]uint16{}, meta.PeriodicSlots...),
		PeriodicSlotSummary: autoPolicyPeriodicSlotSummary(meta.PeriodicSlots),
		ReasonCodes:         append([]string{}, meta.ReasonCodes...),
		PromotionReason:     strings.Join(meta.ReasonCodes, ", "),
		PendingReason:       pendingReason,
		TTLRemainingSeconds: ttlRemaining,
		Rule:                policyRule2REST(rule),
	}
	if !meta.LastObserved.IsZero() {
		resp.LastObservedTS = meta.LastObserved.UTC().Unix()
	}
	if !meta.ExpiresAt.IsZero() {
		resp.ExpiresTS = meta.ExpiresAt.UTC().Unix()
	}
	if feature != nil {
		resp.SourceFeatureKey = autoPolicyFeatureKeyString(feature.Key)
		resp.BaselineScore = feature.LastScores.Baseline
		resp.PeriodicScore = feature.LastScores.Periodic
		resp.AnomalyScore = feature.LastScores.Anomaly
	}
	return resp
}

func autoPolicySystemGuardRuleToREST(rule *share.CLUSPolicyRule) *api.RESTAutoPolicyRule {
	if rule == nil {
		return nil
	}
	now := autoPolicyNow()
	return autoPolicyRuleToREST(rule, &share.CLUSAutoPolicyMeta{
		RuleID:       rule.ID,
		Class:        autoPolicySystemGuardClass,
		Confidence:   1.0,
		CreatedAt:    now,
		LastObserved: now,
		ReasonCodes:  []string{"system_guard", "platform_bootstrap_allow"},
	})
}

func appendAutoPolicyEvent(event autoPolicyEvent) {
	autoPolicyEventMutex.Lock()
	defer autoPolicyEventMutex.Unlock()

	autoPolicyEventSeq++
	event.ID = autoPolicyEventSeq
	if event.CreatedAt.IsZero() {
		event.CreatedAt = autoPolicyNow()
	}
	autoPolicyEvents = append(autoPolicyEvents, event)
	if len(autoPolicyEvents) > autoPolicyEventLimit {
		autoPolicyEvents = append([]autoPolicyEvent{}, autoPolicyEvents[len(autoPolicyEvents)-autoPolicyEventLimit:]...)
	}
}

func autoPolicyEventToREST(event autoPolicyEvent) *api.RESTAutoPolicyEvent {
	resp := &api.RESTAutoPolicyEvent{
		ID:         event.ID,
		EventType:  event.EventType,
		EventClass: string(event.EventClass),
		TargetType: event.TargetType,
		TargetID:   event.TargetID,
		TargetKey:  event.TargetKey,
		Summary:    event.Summary,
		Extra:      event.Extra,
	}
	if !event.CreatedAt.IsZero() {
		resp.CreatedTS = event.CreatedAt.UTC().Unix()
	}
	if from, to := autoPolicyGroupsFromEventTargetKey(event.TargetKey); from != "" || to != "" {
		semantics := autoPolicyFlowSemanticsForGroups(from, to)
		resp.DisplayKey = semantics.DisplayKey
		resp.Namespace = semantics.Namespace
		resp.Business = semantics.Business
		resp.TrafficSource = semantics.TrafficSource
		resp.ZeroTrust = semantics.ZeroTrust
	}
	return resp
}

func autoPolicyGroupsFromEventTargetKey(targetKey string) (string, string) {
	targetKey = strings.TrimSpace(targetKey)
	if targetKey == "" || !strings.Contains(targetKey, "->") {
		return "", ""
	}

	parts := strings.SplitN(targetKey, "->", 2)
	if len(parts) != 2 {
		return "", ""
	}
	from := strings.TrimSpace(parts[0])
	to := strings.TrimSpace(parts[1])
	if idx := strings.Index(to, "|"); idx >= 0 {
		to = strings.TrimSpace(to[:idx])
	}
	return from, to
}

func (m CacheMethod) GetAutoPolicyStatus(acc *access.AccessControl) *api.RESTAutoPolicyStatus {
	status := &api.RESTAutoPolicyStatus{
		Mode:                    string(currentAutoPolicyMode()),
		WindowSeconds:           int64(autoPolicyConfig.WindowDuration.Seconds()),
		SlotMinutes:             int64(autoPolicyConfig.SlotDuration.Minutes()),
		DistinctDaySeconds:      int64(autoPolicyConfig.DistinctDayDuration.Seconds()),
		TTLCheckSeconds:         int64(autoPolicyConfig.TTLCheckInterval.Seconds()),
		FeatureRetentionSeconds: int64(autoPolicyConfig.FeatureRetentionDuration.Seconds()),
	}

	graphMutexRLock()
	status.ObservedEventCount = len(observedEvents)
	graphMutexRUnlock()

	autoPolicyFeatureMutex.RLock()
	candidates := make([]*api.RESTAutoPolicyCandidate, 0, len(autoPolicyFeatureMap))
	for _, feature := range autoPolicyFeatureMap {
		if feature == nil || autoPolicyFeatureUsesServiceIPGroup(feature.Key) || autoPolicyShouldIgnoreFlow(feature.Key.From, feature.Key.To) {
			continue
		}
		if !feature.Key.IsApp && autoPolicyHasAppFeatureForLayer4KeyLocked(feature.Key) {
			continue
		}
		status.FeatureCount++
		semantics := autoPolicyFlowSemanticsForGroups(feature.Key.From, feature.Key.To)
		autoPolicyIncrementTrafficSourceCount(
			semantics.TrafficSource,
			&status.DirectFeatureCount,
			&status.IngressFeatureCount,
			&status.ZeroTrustFeatureCount,
			&status.SystemFeatureCount,
		)
		switch feature.ShadowClass {
		case share.AutoPolicyBaseline:
			status.CandidateBaseline++
		case share.AutoPolicyPeriodic:
			status.CandidatePeriodic++
		case share.AutoPolicyAnomaly:
			status.CandidateAnomaly++
		}
		if feature.ShadowClass != "" && autoPolicyFeatureStage(feature) != "promoted" {
			status.PendingPromotionCount++
		}
		if candidate := autoPolicyCandidateToREST(feature); candidate != nil {
			candidates = append(candidates, candidate)
		}
	}
	autoPolicyFeatureMutex.RUnlock()

	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].Confidence == candidates[j].Confidence {
			return candidates[i].LastObservedTS > candidates[j].LastObservedTS
		}
		return candidates[i].Confidence > candidates[j].Confidence
	})
	if len(candidates) > autoPolicyStatusCandidateLimit {
		candidates = candidates[:autoPolicyStatusCandidateLimit]
	}
	status.Candidates = candidates

	cacheMutexRLock()
	status.SystemGuardRuleCount = len(autoPolicySystemGuardRules())
	for ruleID, meta := range autoPolicyMetaMap {
		rule, ok := policyCache.ruleMap[ruleID]
		if !ok || rule == nil {
			continue
		}
		if autoPolicyShouldIgnoreFlow(rule.From, rule.To) || autoPolicyRuleUsesServiceIPGroup(rule) {
			continue
		}
		semantics := autoPolicyFlowSemanticsForGroups(rule.From, rule.To)
		autoPolicyIncrementTrafficSourceCount(
			semantics.TrafficSource,
			&status.DirectRuleCount,
			&status.IngressRuleCount,
			&status.ZeroTrustRuleCount,
			&status.SystemRuleCount,
		)
		switch meta.Class {
		case share.AutoPolicyBaseline:
			status.BaselineRuleCount++
		case share.AutoPolicyPeriodic:
			status.PeriodicRuleCount++
		case share.AutoPolicyAnomaly:
			status.AnomalyRuleCount++
		}
	}
	cacheMutexRUnlock()

	if !autoPolicyStats.LastWindowProcessedAt.IsZero() {
		status.LastWindowProcessedTS = autoPolicyStats.LastWindowProcessedAt.UTC().Unix()
	}
	if !autoPolicyStats.LastPromotionAt.IsZero() {
		status.LastPromotionTS = autoPolicyStats.LastPromotionAt.UTC().Unix()
	}
	if !autoPolicyStats.LastDeleteAt.IsZero() {
		status.LastDeleteTS = autoPolicyStats.LastDeleteAt.UTC().Unix()
	}
	status.LastWindowEventCount = autoPolicyStats.LastWindowEventCount
	status.PromotionCount = autoPolicyStats.PromotionCount
	status.DeleteCount = autoPolicyStats.DeleteCount
	return status
}

func (m CacheMethod) GetAllAutoPolicyFeatures(acc *access.AccessControl) []*api.RESTAutoPolicyFeature {
	autoPolicyFeatureMutex.RLock()
	defer autoPolicyFeatureMutex.RUnlock()

	features := make([]*api.RESTAutoPolicyFeature, 0, len(autoPolicyFeatureMap))
	for _, feature := range autoPolicyFeatureMap {
		if feature == nil || autoPolicyFeatureUsesServiceIPGroup(feature.Key) || autoPolicyShouldIgnoreFlow(feature.Key.From, feature.Key.To) {
			continue
		}
		if !feature.Key.IsApp && autoPolicyHasAppFeatureForLayer4KeyLocked(feature.Key) {
			continue
		}
		resp := autoPolicyFeatureToREST(feature)
		if resp == nil {
			continue
		}
		features = append(features, resp)
	}

	sort.Slice(features, func(i, j int) bool {
		if features[i].LastSeenTS == features[j].LastSeenTS {
			leftScore := features[i].BaselineScore + features[i].PeriodicScore + features[i].AnomalyScore
			rightScore := features[j].BaselineScore + features[j].PeriodicScore + features[j].AnomalyScore
			return leftScore > rightScore
		}
		return features[i].LastSeenTS > features[j].LastSeenTS
	})
	if len(features) > autoPolicyStatusFeatureLimit {
		features = features[:autoPolicyStatusFeatureLimit]
	}
	return features
}

func (m CacheMethod) GetAllAutoPolicyRules(acc *access.AccessControl) []*api.RESTAutoPolicyRule {
	cacheMutexRLock()
	defer cacheMutexRUnlock()

	systemGuardRules := autoPolicySystemGuardRules()
	ids := make([]int, 0, len(autoPolicyMetaMap))
	for ruleID := range autoPolicyMetaMap {
		ids = append(ids, int(ruleID))
	}
	sort.Ints(ids)

	rules := make([]*api.RESTAutoPolicyRule, 0, len(ids)+len(systemGuardRules))
	for _, rule := range systemGuardRules {
		if restRule := autoPolicySystemGuardRuleToREST(rule); restRule != nil {
			rules = append(rules, restRule)
		}
	}
	for _, id := range ids {
		ruleID := uint32(id)
		rule, ok := policyCache.ruleMap[ruleID]
		if !ok || rule == nil {
			continue
		}
		if autoPolicyShouldIgnoreFlow(rule.From, rule.To) || autoPolicyRuleUsesServiceIPGroup(rule) {
			continue
		}
		rules = append(rules, autoPolicyRuleToREST(rule, autoPolicyMetaMap[ruleID]))
	}
	return rules
}

func (m CacheMethod) GetAutoPolicyRule(id uint32, acc *access.AccessControl) (*api.RESTAutoPolicyRule, error) {
	if id >= autoPolicySystemRuleIDBase {
		cacheMutexRLock()
		defer cacheMutexRUnlock()
		for _, rule := range autoPolicySystemGuardRules() {
			if rule.ID == id {
				return autoPolicySystemGuardRuleToREST(rule), nil
			}
		}
		return nil, common.ErrObjectNotFound
	}

	cacheMutexRLock()
	defer cacheMutexRUnlock()

	meta, ok := autoPolicyMetaMap[id]
	if !ok {
		return nil, common.ErrObjectNotFound
	}
	rule, ok := policyCache.ruleMap[id]
	if !ok || rule == nil {
		return nil, common.ErrObjectNotFound
	}
	if autoPolicyShouldIgnoreFlow(rule.From, rule.To) || autoPolicyRuleUsesServiceIPGroup(rule) {
		return nil, common.ErrObjectNotFound
	}
	return autoPolicyRuleToREST(rule, meta), nil
}

func (m CacheMethod) GetAutoPolicyEvents(acc *access.AccessControl) []*api.RESTAutoPolicyEvent {
	autoPolicyEventMutex.RLock()
	defer autoPolicyEventMutex.RUnlock()

	events := make([]*api.RESTAutoPolicyEvent, 0, len(autoPolicyEvents))
	for idx := len(autoPolicyEvents) - 1; idx >= 0; idx-- {
		events = append(events, autoPolicyEventToREST(autoPolicyEvents[idx]))
	}
	return events
}

func normalizeAutoPolicyMode(mode string) (autoPolicyMode, error) {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case string(autoPolicyModeLegacy), "rollback":
		return autoPolicyModeLegacy, nil
	case string(autoPolicyModeShadow), "discover", "learn", "learning", "monitor", "evaluate":
		return autoPolicyModeShadow, nil
	case string(autoPolicyModeEnforce), "protect", "protection":
		return autoPolicyModeEnforce, nil
	default:
		return "", fmt.Errorf("invalid auto policy mode: %s", mode)
	}
}

func applyAutoPolicyMode(nextMode autoPolicyMode) bool {
	prevMode := currentAutoPolicyMode()
	if prevMode == nextMode {
		return false
	}

	setAutoPolicyMode(nextMode)
	appendAutoPolicyEvent(autoPolicyEvent{
		EventType: "mode_changed",
		Summary:   fmt.Sprintf("Auto policy mode changed from %s to %s", prevMode, nextMode),
		CreatedAt: autoPolicyNow(),
		Extra: map[string]string{
			"previous_mode": string(prevMode),
			"current_mode":  string(nextMode),
		},
	})
	scheduleIPPolicyCalculation(true)
	return true
}

func (m CacheMethod) SetAutoPolicyMode(mode string, acc *access.AccessControl) (*api.RESTAutoPolicyStatus, error) {
	nextMode, err := normalizeAutoPolicyMode(mode)
	if err != nil {
		return nil, err
	}

	if currentAutoPolicyMode() != nextMode {
		if err := persistAutoPolicyEngineMode(nextMode); err != nil {
			return nil, err
		}
		applyAutoPolicyMode(nextMode)
	}
	if nextMode == autoPolicyModeEnforce {
		promoteAutoPolicyCandidatesOnModeSwitch()
	}

	return m.GetAutoPolicyStatus(acc), nil
}

func (m CacheMethod) IsAutoPolicyRule(id uint32) bool {
	return isAutoPolicyRuleID(id)
}
