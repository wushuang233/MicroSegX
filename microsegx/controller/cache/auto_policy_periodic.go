package cache

import (
	"math"
	"sort"
	"time"

	"github.com/wushuang233/MicroSegX/microsegx/share"
)

func calculatePeriodicScore(state *autoFeatureState) (float64, []uint16, []string) {
	if state == nil || len(state.SlotCounters) == 0 {
		return 0, nil, nil
	}

	totalHits := 0.0
	entropy := 0.0
	activeSlots := 0.0
	maxHits := uint32(0)
	topSlots := make([]uint16, 0, len(state.SlotCounters))
	slotHits := make(map[uint16]uint32, len(state.SlotCounters))
	for slot, hits := range state.SlotCounters {
		if hits == 0 {
			continue
		}
		activeSlots++
		totalHits += float64(hits)
		slotHits[slot] = hits
		if hits > maxHits {
			maxHits = hits
		}
	}

	if totalHits == 0 || activeSlots == 0 {
		return 0, nil, nil
	}

	for _, hits := range slotHits {
		p := float64(hits) / totalHits
		entropy -= p * math.Log(p)
	}

	concentration := 1.0
	if totalSlots := autoPolicyTotalSlots(); totalSlots > 1 {
		concentration = 1 - entropy/math.Log(float64(totalSlots))
	}

	topThreshold := maxHits / 2
	if topThreshold < 2 {
		topThreshold = 2
	}
	outsideHits := 0.0
	for slot, hits := range slotHits {
		if hits >= topThreshold {
			topSlots = append(topSlots, slot)
		} else {
			outsideHits += float64(hits)
		}
	}
	sort.Slice(topSlots, func(i, j int) bool { return topSlots[i] < topSlots[j] })

	fDays := autoPolicyClamp01(float64(state.DistinctDays) / 7.0)
	fRepeat := autoPolicyClamp01(float64(len(topSlots)) / activeSlots)
	fOutside := autoPolicyClamp01(1 - outsideHits/totalHits)

	score := 0.45*concentration + 0.25*fDays + 0.20*fRepeat + 0.10*fOutside
	reasons := autoPolicyStableReasonCodes("periodic_slot_concentration", "periodic_slot_repeat")
	return score, topSlots, reasons
}

func periodicSlotsEqual(left, right []uint16) bool {
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

func isPeriodicRuleActive(meta *share.CLUSAutoPolicyMeta, now time.Time) bool {
	if meta == nil || meta.Class != share.AutoPolicyPeriodic {
		return false
	}
	if len(meta.PeriodicSlots) == 0 {
		return true
	}

	slot := autoPolicySlotIndex(now.UTC())
	for _, allowed := range meta.PeriodicSlots {
		if allowed == slot {
			return true
		}
	}
	return false
}
