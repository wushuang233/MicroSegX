package cache

import (
	"hash/fnv"
	"sort"
	"strings"
	"time"

	"github.com/wushuang233/MicroSegX/microsegx/controller/api"
	"github.com/wushuang233/MicroSegX/microsegx/share"
)

const autoPolicySystemRuleIDBase uint32 = 0xfff00000
const autoPolicySystemRuleIDMask uint32 = 0x000fffff
const autoPolicySystemGuardClass share.AutoPolicyClass = "system_guard"
const autoPolicySystemGuardSuppressedClass share.AutoPolicyClass = "system_guard_suppressed"

type autoPolicySystemGuardGroup struct {
	Name     string
	Family   string
	Role     string
	IsSvcIP  bool
	Priority int
}

type autoPolicyRuleBuckets struct {
	federal       []*share.CLUSPolicyRule
	ground        []*share.CLUSPolicyRule
	systemGuard   []*share.CLUSPolicyRule
	autoAnomaly   []*share.CLUSPolicyRule
	user          []*share.CLUSPolicyRule
	autoPeriodic  []*share.CLUSPolicyRule
	autoBaseline  []*share.CLUSPolicyRule
	legacyLearned []*share.CLUSPolicyRule
}

func bucketAutoPolicyRules(now time.Time) autoPolicyRuleBuckets {
	buckets := autoPolicyRuleBuckets{}
	if autoPolicyEnabled() {
		buckets.systemGuard = autoPolicySystemGuardRules()
	}

	for _, head := range adjustPolicyRuleHeads() {
		rule, ok := policyCache.ruleMap[head.ID]
		if !ok || rule == nil || rule.Disable {
			continue
		}
		if autoPolicyShouldIgnoreFlow(rule.From, rule.To) {
			continue
		}

		if meta, ok := autoPolicyMetaMap[rule.ID]; ok {
			if !autoPolicyEnforceEnabled() {
				continue
			}
			if autoPolicyRuleUsesServiceIPGroup(rule) {
				continue
			}
			switch meta.Class {
			case share.AutoPolicyAnomaly:
				buckets.autoAnomaly = append(buckets.autoAnomaly, rule)
			case share.AutoPolicyPeriodic:
				if isPeriodicRuleActive(meta, now) {
					buckets.autoPeriodic = append(buckets.autoPeriodic, rule)
				}
			case share.AutoPolicyBaseline:
				buckets.autoBaseline = append(buckets.autoBaseline, rule)
			default:
				buckets.legacyLearned = append(buckets.legacyLearned, rule)
			}
			continue
		}

		switch rule.CfgType {
		case share.FederalCfg:
			buckets.federal = append(buckets.federal, rule)
		case share.GroundCfg:
			buckets.ground = append(buckets.ground, rule)
		case share.UserCreated:
			buckets.user = append(buckets.user, rule)
		case share.Learned:
			if !autoPolicyEnabled() {
				buckets.legacyLearned = append(buckets.legacyLearned, rule)
			}
		default:
			buckets.user = append(buckets.user, rule)
		}
	}

	return buckets
}

func compileActiveAutoRules(now time.Time) []*share.CLUSPolicyRule {
	buckets := bucketAutoPolicyRules(now)
	ordered := make([]*share.CLUSPolicyRule, 0, len(policyCache.ruleHeads)+len(buckets.systemGuard))
	ordered = append(ordered, buckets.federal...)
	ordered = append(ordered, buckets.ground...)
	ordered = append(ordered, buckets.systemGuard...)
	ordered = append(ordered, buckets.autoAnomaly...)
	ordered = append(ordered, buckets.user...)
	ordered = append(ordered, buckets.autoPeriodic...)
	ordered = append(ordered, buckets.autoBaseline...)
	ordered = append(ordered, buckets.legacyLearned...)
	return ordered
}

func autoPolicySystemGuardRules() []*share.CLUSPolicyRule {
	if !autoPolicyConfig.SystemGuardEnabled {
		return nil
	}

	protectedByName := make(map[string]autoPolicySystemGuardGroup)
	for name, gc := range groupCacheMap {
		if gc == nil || gc.group == nil {
			continue
		}
		if !autoPolicySystemGuardGroupHasLiveTarget(gc) {
			continue
		}
		if info, ok := autoPolicyClassifySystemGuardGroup(name); ok {
			protectedByName[info.Name] = info
		}
	}
	for _, info := range autoPolicyLiveSystemGuardWorkloadGroups() {
		protectedByName[info.Name] = info
	}
	protectedGroups := make([]autoPolicySystemGuardGroup, 0, len(protectedByName))
	for _, info := range protectedByName {
		protectedGroups = append(protectedGroups, info)
	}
	if len(protectedGroups) == 0 {
		return nil
	}

	sort.Slice(protectedGroups, func(i, j int) bool {
		if protectedGroups[i].Family == protectedGroups[j].Family {
			if protectedGroups[i].Priority == protectedGroups[j].Priority {
				return protectedGroups[i].Name < protectedGroups[j].Name
			}
			return protectedGroups[i].Priority < protectedGroups[j].Priority
		}
		return protectedGroups[i].Family < protectedGroups[j].Family
	})

	type guardPair struct {
		from string
		to   string
		port string
	}
	pairSet := make(map[guardPair]struct{}, len(protectedGroups)*len(protectedGroups))
	sourceGroups := make([]autoPolicySystemGuardGroup, 0, len(protectedGroups))
	for _, group := range protectedGroups {
		if !group.IsSvcIP {
			sourceGroups = append(sourceGroups, group)
		}
	}
	for _, from := range sourceGroups {
		for _, to := range protectedGroups {
			if !autoPolicySystemGuardPairAllowed(from, to) {
				continue
			}
			pairSet[guardPair{from: from.Name, to: to.Name, port: autoPolicySystemGuardPairPorts(from, to)}] = struct{}{}
		}
	}
	for _, to := range protectedGroups {
		if autoPolicySystemGuardIngressAllowed(to) {
			pairSet[guardPair{from: api.LearnedExternal, to: to.Name, port: autoPolicySystemGuardTargetPorts(to)}] = struct{}{}
		}
	}

	pairs := make([]guardPair, 0, len(pairSet))
	for pair := range pairSet {
		pairs = append(pairs, pair)
	}
	sort.Slice(pairs, func(i, j int) bool {
		if pairs[i].from == pairs[j].from {
			if pairs[i].to == pairs[j].to {
				return pairs[i].port < pairs[j].port
			}
			return pairs[i].to < pairs[j].to
		}
		return pairs[i].from < pairs[j].from
	})

	rules := make([]*share.CLUSPolicyRule, 0, len(pairs))
	usedIDs := make(map[uint32]struct{}, len(pairs))
	for _, pair := range pairs {
		id := autoPolicySystemGuardRuleID(pair.from, pair.to, pair.port, usedIDs)
		if meta, ok := autoPolicyMetaMap[id]; ok && meta != nil && meta.Class == autoPolicySystemGuardSuppressedClass {
			continue
		}
		rules = append(rules, &share.CLUSPolicyRule{
			ID:      id,
			Comment: "auto policy platform bootstrap allow",
			From:    pair.from,
			To:      pair.to,
			Ports:   pair.port,
			Action:  share.PolicyActionAllow,
			CfgType: share.SystemDefined,
		})
	}
	return rules
}

func autoPolicyLiveSystemGuardWorkloadGroups() []autoPolicySystemGuardGroup {
	groups := make([]autoPolicySystemGuardGroup, 0)
	for _, wlCache := range wlCacheMap {
		if wlCache == nil || wlCache.workload == nil {
			continue
		}
		candidateNames := []string{}
		if strings.TrimSpace(wlCache.learnedGroupName) != "" {
			candidateNames = append(candidateNames, wlCache.learnedGroupName)
		}
		if derived := autoPolicySystemGuardGroupNameFromWorkload(wlCache); derived != "" {
			candidateNames = append(candidateNames, derived)
		}
		for _, name := range candidateNames {
			if info, ok := autoPolicyClassifySystemGuardGroup(name); ok && !info.IsSvcIP {
				groups = append(groups, info)
			}
		}
	}
	return groups
}

func autoPolicyFixedSystemGuardGroupNames() []string {
	return []string{
		api.LearnedGroupPrefix + "microsegx-manager-pod.microsegx",
		api.LearnedGroupPrefix + "microsegx-controller-pod.microsegx",
		api.LearnedGroupPrefix + "microsegx-enforcer-pod.microsegx",
		api.LearnedGroupPrefix + "microsegx-scanner-pod.microsegx",
		api.LearnedGroupPrefix + "ziti-controller.openziti",
		api.LearnedGroupPrefix + "ziti-router.openziti",
	}
}

func autoPolicySystemGuardGroupNameFromWorkload(wlCache *workloadCache) string {
	if wlCache == nil || wlCache.workload == nil {
		return ""
	}
	text := strings.ToLower(strings.Join([]string{
		wlCache.learnedGroupName,
		wlCache.serviceName,
		wlCache.workload.Service,
		wlCache.workload.Name,
		wlCache.displayName,
		wlCache.podName,
	}, " "))
	namespace := strings.ToLower(strings.TrimSpace(wlCache.workload.Domain))
	if namespace == "" {
		switch {
		case strings.Contains(text, ".microsegx") || strings.Contains(text, "_microsegx_") || strings.Contains(text, " microsegx "):
			namespace = "microsegx"
		case strings.Contains(text, ".openziti") || strings.Contains(text, "_openziti_") || strings.Contains(text, " openziti "):
			namespace = "openziti"
		}
	}
	if namespace != "microsegx" && namespace != "openziti" {
		return ""
	}

	switch namespace {
	case "microsegx":
		for _, name := range []string{
			"microsegx-manager-pod",
			"microsegx-controller-pod",
			"microsegx-enforcer-pod",
			"microsegx-scanner-pod",
		} {
			if strings.Contains(text, name) {
				return api.LearnedGroupPrefix + name + "." + namespace
			}
		}
	case "openziti":
		for _, name := range []string{
			"ziti-router",
			"ziti-controller",
		} {
			if strings.Contains(text, name) {
				return api.LearnedGroupPrefix + name + "." + namespace
			}
		}
	}
	return ""
}

func autoPolicySystemGuardGroupHasLiveTarget(gc *groupCache) bool {
	if gc == nil || gc.group == nil {
		return false
	}
	switch gc.group.Kind {
	case share.GroupKindContainer:
		return gc.members != nil && gc.members.Cardinality() > 0
	case share.GroupKindIPService:
		return gc.svcAddrs != nil && gc.svcAddrs.Cardinality() > 0
	default:
		return false
	}
}

func autoPolicyClassifySystemGuardGroup(group string) (autoPolicySystemGuardGroup, bool) {
	trimmed := strings.TrimSpace(group)
	lower := strings.ToLower(trimmed)
	if trimmed == "" || autoPolicySystemGuardExcludedName(lower) {
		return autoPolicySystemGuardGroup{}, false
	}

	info := autoPolicySystemGuardGroup{Name: trimmed, IsSvcIP: strings.HasPrefix(lower, "nv.ip.")}
	namespace := autoPolicyGroupNamespace(lower)
	serviceName := autoPolicyGroupServiceName(lower)

	switch namespace {
	case "microsegx":
		if isMicrosegxContainerGroup(trimmed) ||
			autoPolicyIsMicrosegxSystemName(serviceName) {
			info.Family = "microsegx"
			info.Role = autoPolicyMicrosegxRole(serviceName)
			info.Priority = 10
			if info.IsSvcIP {
				info.Priority = 20
			}
			return info, true
		}
	case "openziti":
		if strings.Contains(serviceName, "ziti-controller") {
			info.Family = "openziti"
			info.Role = "controller"
			info.Priority = 10
			if info.IsSvcIP {
				info.Priority = 20
			}
			return info, true
		}
		if strings.Contains(serviceName, "ziti-router") {
			info.Family = "openziti"
			info.Role = "router"
			info.Priority = 30
			if info.IsSvcIP {
				info.Priority = 40
			}
			return info, true
		}
	case "port-audit":
		if strings.Contains(serviceName, "k8s-port-audit") {
			info.Family = "port-audit"
			info.Role = "audit"
			info.Priority = 10
			if info.IsSvcIP {
				info.Priority = 20
			}
			return info, true
		}
		if strings.Contains(serviceName, "port-audit-ziti-host") {
			info.Family = "port-audit"
			info.Role = "ziti-host"
			info.Priority = 30
			if info.IsSvcIP {
				info.Priority = 40
			}
			return info, true
		}
	}

	return autoPolicySystemGuardGroup{}, false
}

func autoPolicySystemGuardExcludedName(lower string) bool {
	excluded := []string{
		"debug-",
		"ziti-enroll",
		"installer",
		"import-manager",
		"cert-upgrader",
		"wushuang",
	}
	for _, token := range excluded {
		if strings.Contains(lower, token) {
			return true
		}
	}
	return false
}

func autoPolicyGroupNamespace(lower string) string {
	parts := strings.Split(lower, ".")
	if len(parts) == 0 {
		return ""
	}
	return parts[len(parts)-1]
}

func autoPolicyGroupServiceName(lower string) string {
	name := strings.TrimPrefix(lower, "nv.ip.")
	name = strings.TrimPrefix(name, "nv.")
	if dot := strings.LastIndex(name, "."); dot >= 0 {
		name = name[:dot]
	}
	return name
}

func autoPolicyIsMicrosegxSystemName(serviceName string) bool {
	return strings.Contains(serviceName, "microsegx-manager") ||
		strings.Contains(serviceName, "microsegx-controller") ||
		strings.Contains(serviceName, "microsegx-enforcer") ||
		strings.Contains(serviceName, "microsegx-scanner") ||
		strings.Contains(serviceName, "microsegx-updater") ||
		strings.Contains(serviceName, "microsegx-service-webui") ||
		strings.Contains(serviceName, "microsegx-svc-")
}

func autoPolicyMicrosegxRole(serviceName string) string {
	switch {
	case strings.Contains(serviceName, "microsegx-manager") ||
		strings.Contains(serviceName, "microsegx-service-webui"):
		return "manager"
	case strings.Contains(serviceName, "microsegx-controller") ||
		strings.Contains(serviceName, "microsegx-svc-controller") ||
		strings.Contains(serviceName, "microsegx-svc-admission-webhook") ||
		strings.Contains(serviceName, "microsegx-svc-crd-webhook"):
		return "controller"
	case strings.Contains(serviceName, "microsegx-enforcer"):
		return "enforcer"
	case strings.Contains(serviceName, "microsegx-scanner"):
		return "scanner"
	case strings.Contains(serviceName, "microsegx-updater"):
		return "updater"
	default:
		return "core"
	}
}

func autoPolicySystemGuardPairAllowed(from, to autoPolicySystemGuardGroup) bool {
	if from.Name == "" || to.Name == "" {
		return false
	}
	if from.IsSvcIP {
		return false
	}
	if from.Family == "microsegx" && to.Family == "microsegx" {
		return true
	}
	if from.Family == "openziti" {
		return to.Family == "microsegx" && to.Role == "manager"
	}
	return false
}

func autoPolicySystemGuardIngressAllowed(to autoPolicySystemGuardGroup) bool {
	return false
}

func autoPolicySystemGuardPairPorts(from, to autoPolicySystemGuardGroup) string {
	if from.Family == "microsegx" && to.Family == "microsegx" {
		return "any"
	}
	if from.Family == "openziti" && to.Family == "microsegx" && to.Role == "manager" {
		return "tcp/8443"
	}
	return autoPolicySystemGuardTargetPorts(to)
}

func autoPolicySystemGuardTargetPorts(to autoPolicySystemGuardGroup) string {
	switch to.Family {
	case "microsegx":
		switch to.Role {
		case "manager":
			return "tcp/8443"
		case "controller":
			return "tcp/443,tcp/10443,tcp/18300,tcp/18301,udp/18301,tcp/18400,tcp/20443,tcp/30443"
		case "enforcer":
			return "tcp/18401"
		case "scanner":
			return "tcp/18402"
		default:
			return "tcp/443,tcp/8443,tcp/10443,tcp/18300,tcp/18301,udp/18301,tcp/18400,tcp/18401,tcp/18402,tcp/20443,tcp/30443"
		}
	case "openziti":
		if to.Role == "router" {
			return "tcp/3022,tcp/30222"
		}
		return "tcp/1280,tcp/31280"
	case "port-audit":
		return "tcp/8080"
	default:
		return "any"
	}
}

func autoPolicySystemGuardRuleID(from, to, port string, used map[uint32]struct{}) uint32 {
	h := fnv.New32a()
	_, _ = h.Write([]byte(from))
	_, _ = h.Write([]byte{0})
	_, _ = h.Write([]byte(to))
	_, _ = h.Write([]byte{0})
	_, _ = h.Write([]byte(port))
	id := autoPolicySystemRuleIDBase + (h.Sum32() & autoPolicySystemRuleIDMask)
	for {
		if _, ok := used[id]; !ok {
			used[id] = struct{}{}
			return id
		}
		id = autoPolicySystemRuleIDBase + ((id - autoPolicySystemRuleIDBase + 1) & autoPolicySystemRuleIDMask)
	}
}
