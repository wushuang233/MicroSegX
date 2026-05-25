package cache

import (
	"net"
	"strings"
	"time"

	"github.com/wushuang233/MicroSegX/microsegx/controller/api"
	"github.com/wushuang233/MicroSegX/microsegx/share"
	"github.com/wushuang233/MicroSegX/microsegx/share/utils"
)

var autoPolicyProtectedNamespaces = map[string]struct{}{
	"microsegx":          {},
	"openziti":           {},
	"openziti-installer": {},
	"port-audit":         {},
	"kube-system":        {},
	"kube-public":        {},
	"kube-node-lease":    {},
	"cert-manager":       {},
	"local-path-storage": {},
	"ingress-nginx":      {},
	"traefik":            {},
}

var autoPolicySystemGuardNamespaces = map[string]struct{}{
	"microsegx":          {},
	"openziti":           {},
	"openziti-installer": {},
	"port-audit":         {},
}

func observeAutoPolicyEvent(conn *share.CLUSConnection, ca, sa *nodeAttr, stip *serverTip) {
	if !autoPolicyEnabled() || conn == nil || ca == nil || sa == nil || getDisableNetPolicyStatus() {
		return
	}
	if conn.ClientWL == "" || conn.ServerWL == "" {
		return
	}
	fromGroup, fromContainer := node2Group(conn.ClientWL)
	toGroup, toContainer := node2Group(conn.ServerWL)
	if fromGroup == "" || toGroup == "" {
		return
	}
	originalFromGroup, originalToGroup := fromGroup, toGroup
	fromGroup = autoPolicyResolveObservedGroup(fromGroup, net.IP(conn.ClientIP))
	toGroup = autoPolicyResolveObservedGroup(toGroup, net.IP(conn.ServerIP))
	fromGroup, toGroup = autoPolicyNormalizeInfrastructureFlowGroups(fromGroup, toGroup)
	if !fromContainer && !toContainer && fromGroup == originalFromGroup && toGroup == originalToGroup {
		return
	}
	if autoPolicyShouldIgnoreFlow(fromGroup, toGroup) {
		return
	}

	key := autoFeatureKey{
		From:    fromGroup,
		To:      toGroup,
		IPProto: uint8(conn.IPProto),
	}

	var port string
	if conn.Application > 0 {
		key.IsApp = true
		key.Application = conn.Application
	} else {
		wlPort := uint16(conn.ServerPort)
		if stip != nil && stip.wlPort > 0 {
			wlPort = stip.wlPort
		}
		port = utils.GetPortLink(uint8(conn.IPProto), wlPort)
	}

	observedAt := autoPolicyNow()
	if conn.LastSeenAt > 0 {
		observedAt = time.Unix(int64(conn.LastSeenAt), 0).UTC()
	}

	event := autoObservedEvent{
		Key:        key,
		FromWL:     conn.ClientWL,
		ToWL:       conn.ServerWL,
		Port:       port,
		FQDN:       conn.FQDN,
		ObservedAt: observedAt,
		ThreatID:   conn.ThreatID,
		Severity:   conn.Severity,
		Violates:   conn.Violates,
	}

	if len(observedEvents) >= autoPolicyConfig.ObservationBufferLimit && len(observedEvents) > 0 {
		copy(observedEvents, observedEvents[1:])
		observedEvents = observedEvents[:len(observedEvents)-1]
	}
	observedEvents = append(observedEvents, event)
}

func autoPolicyResolveObservedGroup(group string, ip net.IP) string {
	group = strings.TrimSpace(group)
	if group == "" {
		return group
	}
	if !strings.HasPrefix(group, api.LearnedWorkloadPrefix) &&
		!autoPolicyIsServiceIPGroupName(group) {
		return group
	}

	cacheMutexRLock()
	defer cacheMutexRUnlock()
	if ip != nil {
		if digest, ok := ipWLMap[ip.String()]; ok && digest != nil && digest.alive {
			if wlCache, ok := wlCacheMap[digest.wlID]; ok && wlCache != nil && wlCache.learnedGroupName != "" {
				return wlCache.learnedGroupName
			}
		}
	}
	if autoPolicyIsServiceIPGroupName(group) {
		return autoPolicyResolveServiceIPGroupLocked(group)
	}
	return group
}

func autoPolicyIsServiceIPGroupName(group string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(group)), "nv.ip.")
}

func autoPolicyFeatureUsesServiceIPGroup(key autoFeatureKey) bool {
	return autoPolicyIsServiceIPGroupName(key.From) || autoPolicyIsServiceIPGroupName(key.To)
}

func autoPolicyRuleUsesServiceIPGroup(rule *share.CLUSPolicyRule) bool {
	return rule != nil && (autoPolicyIsServiceIPGroupName(rule.From) || autoPolicyIsServiceIPGroupName(rule.To))
}

func autoPolicyResolveServiceIPGroupLocked(group string) string {
	group = strings.TrimSpace(group)
	if !autoPolicyIsServiceIPGroupName(group) {
		return group
	}

	if candidate := autoPolicyServiceIPBackingGroupCandidate(group); candidate != "" {
		if gc, ok := groupCacheMap[candidate]; ok && gc != nil && gc.members != nil && gc.members.Cardinality() > 0 {
			return candidate
		}
	}

	domain, selectorLabels, ok := autoPolicyServiceIPSelectorLocked(group)
	if !ok || len(selectorLabels) == 0 {
		return group
	}

	counts := make(map[string]int)
	for _, wlCache := range wlCacheMap {
		if wlCache == nil || wlCache.workload == nil || wlCache.learnedGroupName == "" {
			continue
		}
		if !wlCache.workload.Running {
			continue
		}
		if domain != "" && wlCache.workload.Domain != domain {
			continue
		}
		if !autoPolicyWorkloadMatchesServiceSelector(wlCache.workload, selectorLabels) {
			continue
		}
		counts[wlCache.learnedGroupName]++
	}

	bestGroup := ""
	bestCount := 0
	for learnedGroup, count := range counts {
		if count > bestCount || (count == bestCount && (bestGroup == "" || learnedGroup < bestGroup)) {
			bestGroup = learnedGroup
			bestCount = count
		}
	}
	if bestGroup != "" {
		return bestGroup
	}
	return group
}

func autoPolicyServiceIPBackingGroupCandidate(group string) string {
	group = strings.TrimSpace(group)
	prefix := api.LearnedGroupPrefix + "ip."
	if !strings.HasPrefix(strings.ToLower(group), strings.ToLower(prefix)) || len(group) <= len(prefix) {
		return ""
	}
	return api.LearnedGroupPrefix + group[len(prefix):]
}

func autoPolicyServiceIPSelectorLocked(group string) (string, map[string]string, bool) {
	gc, ok := groupCacheMap[group]
	if !ok || gc == nil || gc.group == nil || gc.group.Kind != share.GroupKindIPService {
		return "", nil, false
	}

	domain := strings.TrimSpace(gc.group.Domain)
	labels := make(map[string]string)
	for _, criterion := range gc.group.Criteria {
		switch criterion.Key {
		case share.CriteriaKeyDomain, share.CriteriaKeyNamespace:
			if criterion.Op == "" || criterion.Op == share.CriteriaOpEqual {
				domain = strings.TrimSpace(criterion.Value)
			}
		case share.CriteriaKeyLabel:
			key, value, ok := strings.Cut(criterion.Value, "=")
			if !ok {
				continue
			}
			key = strings.TrimSpace(key)
			value = strings.TrimSpace(value)
			if key != "" {
				labels[key] = value
			}
		}
	}
	return domain, labels, true
}

func autoPolicyWorkloadMatchesServiceSelector(workload *share.CLUSWorkload, selectorLabels map[string]string) bool {
	if workload == nil || len(selectorLabels) == 0 {
		return false
	}
	for key, value := range selectorLabels {
		if workload.Labels == nil {
			return false
		}
		if workload.Labels[key] != value {
			return false
		}
	}
	return true
}

func autoPolicyResolveObservedWorkloadNode(node string, ip net.IP) (string, bool) {
	node = strings.TrimSpace(node)
	if node == "" || ip == nil {
		return node, false
	}
	if !strings.HasPrefix(node, api.LearnedWorkloadPrefix) {
		return node, false
	}

	cacheMutexRLock()
	defer cacheMutexRUnlock()
	if digest, ok := ipWLMap[ip.String()]; ok && digest != nil && digest.alive {
		if _, ok := wlCacheMap[digest.wlID]; ok {
			return digest.wlID, true
		}
	}
	return node, false
}

func autoPolicyResolveObservedServiceNode(node string, ip net.IP) (string, bool) {
	node = strings.TrimSpace(node)
	if node == "" || !autoPolicyIsServiceIPGroupName(node) {
		return node, false
	}
	resolved := autoPolicyResolveObservedGroup(node, ip)
	if resolved == "" || resolved == node || autoPolicyIsServiceIPGroupName(resolved) {
		return node, false
	}
	return resolved, true
}

func normalizeAutoPolicyConnectionAttribution(conn *share.CLUSConnection, ca, sa *nodeAttr) {
	if conn == nil {
		return
	}
	if resolved, ok := autoPolicyResolveObservedWorkloadNode(conn.ClientWL, net.IP(conn.ClientIP)); ok {
		conn.ClientWL = resolved
		if ca != nil {
			*ca = nodeAttr{workload: true, managed: true}
		}
	}
	if resolved, ok := autoPolicyResolveObservedWorkloadNode(conn.ServerWL, net.IP(conn.ServerIP)); ok {
		conn.ServerWL = resolved
		if sa != nil {
			*sa = nodeAttr{workload: true, managed: true}
		}
	}
	if resolved, ok := autoPolicyResolveObservedServiceNode(conn.ClientWL, net.IP(conn.ClientIP)); ok {
		conn.ClientWL = resolved
		if ca != nil {
			ca.external = false
			ca.addrgrp = false
			ca.ipsvcgrp = false
		}
	}
	if resolved, ok := autoPolicyResolveObservedServiceNode(conn.ServerWL, net.IP(conn.ServerIP)); ok {
		conn.ServerWL = resolved
		if sa != nil {
			sa.external = false
			sa.addrgrp = false
			sa.ipsvcgrp = false
		}
	}
}

func autoPolicyIsProtectedWorkload(workloadID string) bool {
	if workloadID == "" {
		return false
	}

	cacheMutexRLock()
	defer cacheMutexRUnlock()

	if wlCache, ok := wlCacheMap[workloadID]; ok && wlCache != nil && wlCache.workload != nil {
		if autoPolicyIsProtectedNamespace(wlCache.workload.Domain) {
			return true
		}
		if autoPolicyIsProtectedGroup(wlCache.learnedGroupName) {
			return true
		}
		if autoPolicyLooksLikeProtectedName(wlCache.workload.Name) ||
			autoPolicyLooksLikeProtectedName(wlCache.displayName) ||
			autoPolicyLooksLikeProtectedName(wlCache.podName) {
			return true
		}
	}
	if wlCache, ok := nvwlCacheMap[workloadID]; ok && wlCache != nil && wlCache.workload != nil {
		return true
	}
	return false
}

func autoPolicyIsProtectedGroup(group string) bool {
	group = strings.TrimSpace(group)
	if group == "" {
		return false
	}
	if isMicrosegxContainerGroup(group) {
		return true
	}
	lower := strings.ToLower(group)
	for namespace := range autoPolicyProtectedNamespaces {
		if strings.HasSuffix(lower, "."+namespace) || strings.Contains(lower, "."+namespace+".") {
			return true
		}
	}
	return autoPolicyLooksLikeProtectedName(lower)
}

func autoPolicyIsSystemGuardGroup(group string) bool {
	group = strings.TrimSpace(group)
	if group == "" {
		return false
	}
	if isMicrosegxContainerGroup(group) {
		return true
	}
	lower := strings.ToLower(group)
	for namespace := range autoPolicySystemGuardNamespaces {
		if strings.HasSuffix(lower, "."+namespace) || strings.Contains(lower, "."+namespace+".") {
			return true
		}
	}
	return strings.Contains(lower, "microsegx-") ||
		strings.Contains(lower, "neuvector-") ||
		strings.Contains(lower, "ziti-controller") ||
		strings.Contains(lower, "ziti-router") ||
		strings.Contains(lower, "port-audit")
}

func autoPolicyIsProtectedNamespace(namespace string) bool {
	_, ok := autoPolicyProtectedNamespaces[strings.ToLower(strings.TrimSpace(namespace))]
	return ok
}

func autoPolicyLooksLikeProtectedName(name string) bool {
	lower := strings.ToLower(strings.TrimSpace(name))
	if lower == "" {
		return false
	}
	return strings.Contains(lower, "microsegx-") ||
		strings.Contains(lower, "neuvector-") ||
		strings.Contains(lower, "ziti-controller") ||
		strings.Contains(lower, "ziti-router") ||
		strings.Contains(lower, "port-audit")
}

func autoPolicyShouldIgnoreFlow(fromGroup, toGroup string) bool {
	return false
}

func autoPolicyIsPortAuditNodeScanFlow(fromGroup, toGroup string) bool {
	fromLower := strings.ToLower(strings.TrimSpace(fromGroup))
	if fromLower == "" || !autoPolicyIsPortAuditScannerGroup(fromLower) {
		return false
	}
	return autoPolicyIsNodeScopeGroup(toGroup)
}

func autoPolicyIsPortAuditScannerGroup(lowerGroup string) bool {
	if strings.Contains(lowerGroup, "port-audit-ziti-host") {
		return false
	}
	return strings.Contains(lowerGroup, "k8s-port-audit")
}

func autoPolicyIsNodeScopeGroup(group string) bool {
	trimmed := strings.TrimSpace(group)
	lower := strings.ToLower(trimmed)
	if lower == "" {
		return false
	}

	switch lower {
	case strings.ToLower(api.AllHostGroup),
		strings.ToLower(api.FedAllHostGroup),
		strings.ToLower(share.CLUSHostAddrGroup):
		return true
	}
	return strings.HasPrefix(lower, strings.ToLower(api.LearnedHostPrefix))
}

func autoPolicyNormalizeInfrastructureFlowGroups(fromGroup, toGroup string) (string, string) {
	if autoPolicyIsPortAuditNodeScanFlow(fromGroup, toGroup) {
		return fromGroup, api.AllHostGroup
	}
	return fromGroup, toGroup
}

func drainObservedEvents() []autoObservedEvent {
	graphMutexLock()
	defer graphMutexUnlock()

	if len(observedEvents) == 0 {
		return nil
	}

	drained := make([]autoObservedEvent, len(observedEvents))
	copy(drained, observedEvents)
	observedEvents = observedEvents[:0]
	return drained
}
