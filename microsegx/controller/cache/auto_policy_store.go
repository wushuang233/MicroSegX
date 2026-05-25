package cache

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	log "github.com/sirupsen/logrus"

	"github.com/wushuang233/MicroSegX/microsegx/share"
	"github.com/wushuang233/MicroSegX/microsegx/share/cluster"
)

var autoPolicyListStoreKeys = cluster.GetStoreKeys
var autoPolicyGetStoreValue = cluster.Get
var autoPolicyPutStoreValue = cluster.Put
var autoPolicyDeleteStoreValue = cluster.Delete

func cloneAutoPolicyMeta(meta *share.CLUSAutoPolicyMeta) *share.CLUSAutoPolicyMeta {
	if meta == nil {
		return nil
	}

	clone := *meta
	if meta.PeriodicSlots != nil {
		clone.PeriodicSlots = append([]uint16{}, meta.PeriodicSlots...)
	}
	if meta.ReasonCodes != nil {
		clone.ReasonCodes = append([]string{}, meta.ReasonCodes...)
	}
	return &clone
}

func cloneAutoFeatureState(state *autoFeatureState) *autoFeatureState {
	if state == nil {
		return nil
	}

	clone := *state
	clone.DaysSeen = make(map[int64]struct{}, len(state.DaysSeen))
	for day := range state.DaysSeen {
		clone.DaysSeen[day] = struct{}{}
	}
	clone.SrcWorkloadsSeen = make(map[string]struct{}, len(state.SrcWorkloadsSeen))
	for wlID := range state.SrcWorkloadsSeen {
		clone.SrcWorkloadsSeen[wlID] = struct{}{}
	}
	clone.Ports = make(map[string]struct{}, len(state.Ports))
	for port := range state.Ports {
		clone.Ports[port] = struct{}{}
	}
	clone.FQDNs = make(map[string]struct{}, len(state.FQDNs))
	for fqdn := range state.FQDNs {
		clone.FQDNs[fqdn] = struct{}{}
	}
	clone.Applications = make(map[uint32]struct{}, len(state.Applications))
	for appID := range state.Applications {
		clone.Applications[appID] = struct{}{}
	}
	clone.SlotCounters = make(map[uint16]uint32, len(state.SlotCounters))
	for slot, hits := range state.SlotCounters {
		clone.SlotCounters[slot] = hits
	}
	if state.ShadowReasons != nil {
		clone.ShadowReasons = append([]string{}, state.ShadowReasons...)
	} else {
		clone.ShadowReasons = []string{}
	}
	if clone.DistinctDays == 0 && len(clone.DaysSeen) > 0 {
		clone.DistinctDays = uint32(len(clone.DaysSeen))
	}
	if clone.TotalSlotHits == 0 && len(clone.SlotCounters) > 0 {
		var total uint64
		for _, hits := range clone.SlotCounters {
			total += uint64(hits)
		}
		clone.TotalSlotHits = total
		if clone.TotalEvents == 0 {
			clone.TotalEvents = total
		}
	}
	return &clone
}

type autoPolicyFeatureSnapshot struct {
	SavedAt  time.Time           `json:"saved_at"`
	Features []*autoFeatureState `json:"features"`
}

func autoPolicyFeatureSortKey(key autoFeatureKey) string {
	return fmt.Sprintf("%s|%s|%t|%d|%d", key.From, key.To, key.IsApp, key.IPProto, key.Application)
}

func snapshotAutoPolicyFeatureStates() autoPolicyFeatureSnapshot {
	autoPolicyFeatureMutex.RLock()
	defer autoPolicyFeatureMutex.RUnlock()

	snapshot := autoPolicyFeatureSnapshot{
		SavedAt:  autoPolicyNow(),
		Features: make([]*autoFeatureState, 0, len(autoPolicyFeatureMap)),
	}
	for _, state := range autoPolicyFeatureMap {
		clone := cloneAutoFeatureState(state)
		if clone == nil || autoPolicyFeatureUsesServiceIPGroup(clone.Key) {
			continue
		}
		snapshot.Features = append(snapshot.Features, clone)
	}
	sort.Slice(snapshot.Features, func(i, j int) bool {
		return autoPolicyFeatureSortKey(snapshot.Features[i].Key) < autoPolicyFeatureSortKey(snapshot.Features[j].Key)
	})
	return snapshot
}

func persistAutoPolicyFeatureStates() error {
	snapshot := snapshotAutoPolicyFeatureStates()
	if len(snapshot.Features) == 0 {
		return autoPolicyDeleteStoreValue(share.CLUSConfigAutoPolicyFeatureStateKey)
	}

	value, err := json.Marshal(&snapshot)
	if err != nil {
		return err
	}
	return autoPolicyPutStoreValue(share.CLUSConfigAutoPolicyFeatureStateKey, value)
}

func applyAutoPolicyFeatureSnapshot(snapshot *autoPolicyFeatureSnapshot) {
	next := make(map[autoFeatureKey]*autoFeatureState)
	if snapshot != nil {
		for _, state := range snapshot.Features {
			clone := cloneAutoFeatureState(state)
			if clone == nil || autoPolicyFeatureUsesServiceIPGroup(clone.Key) {
				continue
			}
			next[clone.Key] = clone
		}
	}

	autoPolicyFeatureMutex.Lock()
	autoPolicyFeatureMap = next
	autoPolicyFeatureMutex.Unlock()
}

func autoPolicyBootstrapFeatureStates() {
	value, err := autoPolicyGetStoreValue(share.CLUSConfigAutoPolicyFeatureStateKey)
	if err != nil || len(value) == 0 {
		return
	}

	var snapshot autoPolicyFeatureSnapshot
	if err := json.Unmarshal(value, &snapshot); err != nil {
		log.WithFields(log.Fields{"key": share.CLUSConfigAutoPolicyFeatureStateKey, "error": err}).Warn("Skip invalid auto policy feature snapshot")
		return
	}

	applyAutoPolicyFeatureSnapshot(&snapshot)
	log.WithFields(log.Fields{
		"key":           share.CLUSConfigAutoPolicyFeatureStateKey,
		"feature_count": len(snapshot.Features),
		"saved_at":      snapshot.SavedAt,
	}).Info("Restored auto policy feature states")
}

func autoPolicyBootstrapEngineConfig() {
	value, err := autoPolicyGetStoreValue(share.CLUSConfigAutoPolicyEngineKey)
	if err != nil || len(value) == 0 {
		return
	}

	var cfg share.CLUSAutoPolicyEngineConfig
	if err := json.Unmarshal(value, &cfg); err != nil {
		log.WithFields(log.Fields{"key": share.CLUSConfigAutoPolicyEngineKey, "error": err}).Warn("Skip invalid auto policy engine config")
		return
	}
	mode, err := normalizeAutoPolicyMode(cfg.Mode)
	if err != nil {
		log.WithFields(log.Fields{"key": share.CLUSConfigAutoPolicyEngineKey, "mode": cfg.Mode}).Warn("Skip invalid auto policy mode")
		return
	}
	applyAutoPolicyMode(mode)
}

func autoPolicyBootstrapMeta() {
	autoPolicyBootstrapEngineConfig()

	keys, err := autoPolicyListStoreKeys(share.CLUSConfigAutoPolicyRuleStore)
	if err != nil {
		if errors.Is(err, cluster.ErrEmptyStore) {
			log.Debug("Auto policy metadata store is empty")
			return
		}
		log.WithFields(log.Fields{"error": err}).Error("Failed to list auto policy metadata")
		return
	}

	cacheMutexLock()
	defer cacheMutexUnlock()

	for _, key := range keys {
		value, err := autoPolicyGetStoreValue(key)
		if err != nil || len(value) == 0 {
			continue
		}

		var meta share.CLUSAutoPolicyMeta
		if err := json.Unmarshal(value, &meta); err != nil {
			log.WithFields(log.Fields{"key": key, "error": err}).Warn("Skip invalid auto policy metadata")
			continue
		}
		autoPolicyMetaMap[meta.RuleID] = cloneAutoPolicyMeta(&meta)
	}
}

func autoPolicyBootstrapState() {
	autoPolicyBootstrapMeta()
	autoPolicyBootstrapFeatureStates()
}

func autoPolicyConfigUpdate(nType cluster.ClusterNotifyType, key string, value []byte) {
	if key == share.CLUSConfigAutoPolicyEngineKey {
		if nType != cluster.ClusterNotifyAdd && nType != cluster.ClusterNotifyModify {
			return
		}

		var cfg share.CLUSAutoPolicyEngineConfig
		if err := json.Unmarshal(value, &cfg); err != nil {
			log.WithFields(log.Fields{"key": key, "error": err}).Warn("Ignore invalid auto policy engine config update")
			return
		}
		mode, err := normalizeAutoPolicyMode(cfg.Mode)
		if err != nil {
			log.WithFields(log.Fields{"key": key, "mode": cfg.Mode}).Warn("Ignore invalid auto policy mode update")
			return
		}
		applyAutoPolicyMode(mode)
		return
	}

	if key == share.CLUSConfigAutoPolicyFeatureStateKey {
		switch nType {
		case cluster.ClusterNotifyAdd, cluster.ClusterNotifyModify:
			var snapshot autoPolicyFeatureSnapshot
			if err := json.Unmarshal(value, &snapshot); err != nil {
				log.WithFields(log.Fields{"key": key, "error": err}).Warn("Ignore invalid auto policy feature snapshot update")
				return
			}
			applyAutoPolicyFeatureSnapshot(&snapshot)
		case cluster.ClusterNotifyDelete:
			applyAutoPolicyFeatureSnapshot(nil)
		default:
			return
		}
		return
	}

	switch nType {
	case cluster.ClusterNotifyAdd, cluster.ClusterNotifyModify:
		if !share.CLUSIsAutoPolicyMetaKey(key) {
			return
		}

		var meta share.CLUSAutoPolicyMeta
		if err := json.Unmarshal(value, &meta); err != nil {
			log.WithFields(log.Fields{"key": key, "error": err}).Warn("Ignore invalid auto policy metadata update")
			return
		}

		cacheMutexLock()
		autoPolicyMetaMap[meta.RuleID] = cloneAutoPolicyMeta(&meta)
		cacheMutexUnlock()
	case cluster.ClusterNotifyDelete:
		if !share.CLUSIsAutoPolicyMetaKey(key) {
			return
		}

		cacheMutexLock()
		delete(autoPolicyMetaMap, share.CLUSAutoPolicyMetaKey2ID(key))
		cacheMutexUnlock()
	default:
		return
	}

	scheduleIPPolicyCalculation(true)
}

func persistAutoPolicyEngineMode(mode autoPolicyMode) error {
	value, err := json.Marshal(&share.CLUSAutoPolicyEngineConfig{
		Mode:      string(mode),
		UpdatedAt: autoPolicyNow(),
	})
	if err != nil {
		return err
	}
	return autoPolicyPutStoreValue(share.CLUSConfigAutoPolicyEngineKey, value)
}

func getAutoPolicyMeta(ruleID uint32) (*share.CLUSAutoPolicyMeta, bool) {
	cacheMutexRLock()
	defer cacheMutexRUnlock()

	meta, ok := autoPolicyMetaMap[ruleID]
	if !ok {
		return nil, false
	}
	return cloneAutoPolicyMeta(meta), true
}

func isAutoPolicyRuleID(ruleID uint32) bool {
	cacheMutexRLock()
	defer cacheMutexRUnlock()

	_, ok := autoPolicyMetaMap[ruleID]
	return ok
}
