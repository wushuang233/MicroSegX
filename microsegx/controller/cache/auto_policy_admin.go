package cache

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	log "github.com/sirupsen/logrus"

	"github.com/wushuang233/MicroSegX/microsegx/controller/access"
	"github.com/wushuang233/MicroSegX/microsegx/controller/api"
	"github.com/wushuang233/MicroSegX/microsegx/controller/common"
	"github.com/wushuang233/MicroSegX/microsegx/share"
	"github.com/wushuang233/MicroSegX/microsegx/share/cluster"
)

func normalizeAutoPolicyEditableClass(value string) (share.AutoPolicyClass, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case string(share.AutoPolicyBaseline), "allow", "baseline_allow":
		return share.AutoPolicyBaseline, nil
	case string(share.AutoPolicyPeriodic), "periodic_allow":
		return share.AutoPolicyPeriodic, nil
	case string(share.AutoPolicyAnomaly), "deny", "blacklist", "anomaly_deny":
		return share.AutoPolicyAnomaly, nil
	default:
		return "", fmt.Errorf("invalid auto policy class: %s", value)
	}
}

func normalizeAutoPolicyReasonCodes(values []string, defaults ...string) []string {
	items := append([]string{}, defaults...)
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			items = append(items, strings.TrimSpace(value))
		}
	}
	return autoPolicyStableReasonCodes(items...)
}

func normalizeAutoPolicyPeriodicSlots(values []uint16) []uint16 {
	totalSlots := autoPolicyTotalSlots()
	seen := make(map[uint16]struct{}, len(values))
	slots := make([]uint16, 0, len(values))
	for _, slot := range values {
		if totalSlots > 0 && int(slot) >= totalSlots {
			continue
		}
		if _, ok := seen[slot]; ok {
			continue
		}
		seen[slot] = struct{}{}
		slots = append(slots, slot)
	}
	if len(slots) == 0 {
		slots = append(slots, autoPolicySlotIndex(autoPolicyNow()))
	}
	sort.Slice(slots, func(i, j int) bool { return slots[i] < slots[j] })
	return slots
}

func normalizeAutoPolicyTTL(req *api.RESTAutoPolicyRuleUpdate) time.Duration {
	if req != nil && req.TTLSeconds != nil && *req.TTLSeconds > 0 {
		return time.Duration(*req.TTLSeconds) * time.Second
	}
	if autoPolicyConfig.AnomalyRuleTTL > 0 {
		return autoPolicyConfig.AnomalyRuleTTL
	}
	return 10 * time.Minute
}

func normalizeAutoPolicyCreateTTL(req *api.RESTAutoPolicyRuleCreate) time.Duration {
	if req != nil && req.TTLSeconds != nil && *req.TTLSeconds > 0 {
		return time.Duration(*req.TTLSeconds) * time.Second
	}
	if autoPolicyConfig.AnomalyRuleTTL > 0 {
		return autoPolicyConfig.AnomalyRuleTTL
	}
	return 10 * time.Minute
}

func (m CacheMethod) CreateAutoPolicyRule(req *api.RESTAutoPolicyRuleCreate, acc *access.AccessControl) (*api.RESTAutoPolicyRule, error) {
	if req == nil {
		return nil, common.ErrObjectNotFound
	}

	from := strings.TrimSpace(req.From)
	to := strings.TrimSpace(req.To)
	if from == "" || to == "" {
		return nil, fmt.Errorf("from and to are required")
	}
	if autoPolicyIsServiceIPGroupName(from) || autoPolicyIsServiceIPGroupName(to) {
		return nil, fmt.Errorf("service IP groups are attribution hints and cannot be used as auto policy endpoints")
	}

	class, err := normalizeAutoPolicyEditableClass(req.Class)
	if err != nil {
		return nil, err
	}

	confidence := 1.0
	if req.Confidence != nil {
		confidence = autoPolicyClamp01(*req.Confidence)
	}

	action := share.PolicyActionAllow
	comment := "auto baseline allow (manual create)"
	if class == share.AutoPolicyPeriodic {
		comment = "auto periodic allow (manual create)"
	} else if class == share.AutoPolicyAnomaly {
		action = share.PolicyActionDeny
		comment = "auto anomaly deny (manual create)"
	}

	ports := strings.TrimSpace(req.Ports)
	applications := append([]uint32{}, req.Applications...)
	if ports == "" && len(applications) == 0 {
		ports = api.PolicyPortAny
	}

	cacheMutexRLock()
	for ruleID, meta := range autoPolicyMetaMap {
		if meta == nil || meta.Class != class {
			continue
		}
		rule := policyCache.ruleMap[ruleID]
		if rule == nil {
			continue
		}
		if rule.From == from && rule.To == to && rule.Action == action && strings.TrimSpace(rule.Ports) == ports && uint32SlicesEqual(rule.Applications, applications) {
			cacheMutexRUnlock()
			return m.GetAutoPolicyRule(ruleID, acc)
		}
	}
	cacheMutexRUnlock()

	now := autoPolicyNow()
	rule := &share.CLUSPolicyRule{
		From:         from,
		To:           to,
		Ports:        ports,
		Applications: applications,
		Action:       action,
		CfgType:      share.Learned,
		Comment:      comment,
		CreatedAt:    now,
		LastModAt:    now,
	}

	meta := &share.CLUSAutoPolicyMeta{
		Class:        class,
		Confidence:   confidence,
		CreatedAt:    now,
		LastObserved: now,
		ReasonCodes:  normalizeAutoPolicyReasonCodes(req.ReasonCodes, "manual_create", "operator_add"),
	}
	if class == share.AutoPolicyPeriodic {
		meta.PeriodicSlots = normalizeAutoPolicyPeriodicSlots(req.PeriodicSlots)
	}
	if class == share.AutoPolicyAnomaly {
		meta.ExpiresAt = now.Add(normalizeAutoPolicyCreateTTL(req))
	}

	applyAutoPolicyChanges([]autoPolicyRuleChange{{
		Op:   autoPolicyRuleUpsert,
		Rule: rule,
		Meta: meta,
	}})
	scheduleIPPolicyCalculation(true)

	return m.GetAutoPolicyRule(rule.ID, acc)
}

func (m CacheMethod) UpdateAutoPolicyRule(id uint32, req *api.RESTAutoPolicyRuleUpdate, acc *access.AccessControl) (*api.RESTAutoPolicyRule, error) {
	if id == 0 || req == nil {
		return nil, common.ErrObjectNotFound
	}
	if id >= autoPolicySystemRuleIDBase {
		return nil, fmt.Errorf("system guard rules are virtual and cannot be reclassified")
	}

	now := autoPolicyNow()
	cacheMutexRLock()
	rule := autoPolicyCloneRule(policyCache.ruleMap[id])
	meta := cloneAutoPolicyMeta(autoPolicyMetaMap[id])
	cacheMutexRUnlock()

	if rule == nil || meta == nil || autoPolicyShouldIgnoreFlow(rule.From, rule.To) || autoPolicyRuleUsesServiceIPGroup(rule) {
		return nil, common.ErrObjectNotFound
	}

	nextClass := meta.Class
	if strings.TrimSpace(req.Class) != "" {
		parsed, err := normalizeAutoPolicyEditableClass(req.Class)
		if err != nil {
			return nil, err
		}
		nextClass = parsed
	}

	confidence := meta.Confidence
	if req.Confidence != nil {
		confidence = autoPolicyClamp01(*req.Confidence)
	} else if confidence <= 0 {
		confidence = 1.0
	}

	rule.LastModAt = now
	meta.Class = nextClass
	meta.Confidence = confidence
	meta.LastObserved = now
	meta.ReasonCodes = normalizeAutoPolicyReasonCodes(req.ReasonCodes, "manual_override", "operator_edit")

	switch nextClass {
	case share.AutoPolicyBaseline:
		rule.Action = share.PolicyActionAllow
		rule.Comment = "auto baseline allow (manual override)"
		meta.PeriodicSlots = nil
		meta.ExpiresAt = time.Time{}
	case share.AutoPolicyPeriodic:
		rule.Action = share.PolicyActionAllow
		rule.Comment = "auto periodic allow (manual override)"
		meta.PeriodicSlots = normalizeAutoPolicyPeriodicSlots(req.PeriodicSlots)
		meta.ExpiresAt = time.Time{}
	case share.AutoPolicyAnomaly:
		rule.Action = share.PolicyActionDeny
		rule.Comment = "auto anomaly deny (manual override)"
		meta.PeriodicSlots = nil
		meta.ExpiresAt = now.Add(normalizeAutoPolicyTTL(req))
	default:
		return nil, fmt.Errorf("unsupported auto policy class: %s", nextClass)
	}

	applyAutoPolicyChanges([]autoPolicyRuleChange{{
		Op:             autoPolicyRuleUpsert,
		Rule:           rule,
		Meta:           meta,
		ExistingRuleID: id,
	}})
	scheduleIPPolicyCalculation(true)

	appendAutoPolicyEvent(autoPolicyEvent{
		EventType:  "rule_updated",
		EventClass: nextClass,
		TargetType: "rule",
		TargetID:   id,
		TargetKey:  fmt.Sprintf("%s -> %s", rule.From, rule.To),
		Summary:    fmt.Sprintf("人工调整自动策略规则 #%d（%s）", id, nextClass),
		CreatedAt:  now,
		Extra: map[string]string{
			"edit_mode": "manual_override",
		},
	})

	return m.GetAutoPolicyRule(id, acc)
}

func (m CacheMethod) DeleteAutoPolicyRules(ids []uint32, acc *access.AccessControl) (*api.RESTAutoPolicyRuleDeleteResult, error) {
	result := &api.RESTAutoPolicyRuleDeleteResult{}
	if len(ids) == 0 {
		return result, nil
	}
	seen := make(map[uint32]struct{}, len(ids))
	changes := make([]autoPolicyRuleChange, 0, len(ids))
	suppressions := make([]*share.CLUSAutoPolicyMeta, 0)

	cacheMutexRLock()
	for _, id := range ids {
		if id == 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}

		if id >= autoPolicySystemRuleIDBase {
			if rule := autoPolicyFindSystemGuardRuleByIDLocked(id); rule != nil {
				suppressions = append(suppressions, &share.CLUSAutoPolicyMeta{
					RuleID:       id,
					Class:        autoPolicySystemGuardSuppressedClass,
					Confidence:   1.0,
					CreatedAt:    autoPolicyNow(),
					LastObserved: autoPolicyNow(),
					ReasonCodes:  []string{"system_guard_suppressed", "manual_delete"},
				})
			} else {
				result.Skipped = append(result.Skipped, id)
			}
			continue
		}

		if meta, ok := autoPolicyMetaMap[id]; !ok || meta == nil {
			result.Skipped = append(result.Skipped, id)
			continue
		}
		if rule, ok := policyCache.ruleMap[id]; !ok || rule == nil {
			result.Skipped = append(result.Skipped, id)
			continue
		}
		changes = append(changes, autoPolicyRuleChange{
			Op:             autoPolicyRuleDelete,
			ExistingRuleID: id,
		})
	}
	cacheMutexRUnlock()

	if len(changes) > 0 {
		applyAutoPolicyChanges(changes)
		for _, change := range changes {
			result.Deleted = append(result.Deleted, change.ExistingRuleID)
		}
	}
	if len(suppressions) > 0 {
		applied := suppressAutoPolicySystemGuardRules(suppressions)
		result.Suppressed = append(result.Suppressed, applied...)
	}
	return result, nil
}

func autoPolicyFindSystemGuardRuleByIDLocked(id uint32) *share.CLUSPolicyRule {
	for _, rule := range autoPolicySystemGuardRules() {
		if rule != nil && rule.ID == id {
			return rule
		}
	}
	return nil
}

func suppressAutoPolicySystemGuardRules(metas []*share.CLUSAutoPolicyMeta) []uint32 {
	if len(metas) == 0 {
		return nil
	}

	lock, err := clusHelper.AcquireLock(share.CLUSLockPolicyKey, policyClusterLockWait)
	if err != nil {
		log.WithFields(log.Fields{"error": err}).Error("Acquire policy lock for system guard suppression")
		return nil
	}
	defer clusHelper.ReleaseLock(lock)

	txn := cluster.Transact()
	defer txn.Close()

	applied := make([]uint32, 0, len(metas))
	for _, meta := range metas {
		if meta == nil || meta.RuleID == 0 {
			continue
		}
		if value, err := json.Marshal(meta); err == nil {
			txn.Put(share.CLUSAutoPolicyMetaKey(meta.RuleID), value)
			applied = append(applied, meta.RuleID)
		}
	}
	if len(applied) == 0 {
		return nil
	}

	if ok, err := txn.Apply(); err != nil {
		log.WithFields(log.Fields{"error": err}).Error("Failed to apply system guard suppression transaction")
		return nil
	} else if !ok {
		log.Error("System guard suppression transaction rejected")
		return nil
	}

	cacheMutexLock()
	for _, meta := range metas {
		if meta != nil {
			autoPolicyMetaMap[meta.RuleID] = cloneAutoPolicyMeta(meta)
		}
	}
	cacheMutexUnlock()

	now := autoPolicyNow()
	autoPolicyStats.DeleteCount += uint64(len(applied))
	autoPolicyStats.LastDeleteAt = now
	for _, id := range applied {
		appendAutoPolicyEvent(autoPolicyEvent{
			EventType:  "rule_deleted",
			EventClass: autoPolicySystemGuardClass,
			TargetType: "rule",
			TargetID:   id,
			TargetKey:  fmt.Sprintf("system_guard:%d", id),
			Summary:    fmt.Sprintf("抑制系统默认保护规则 #%d", id),
			CreatedAt:  now,
			Extra: map[string]string{
				"delete_mode": "suppressed",
			},
		})
	}
	scheduleIPPolicyCalculation(true)
	return applied
}
