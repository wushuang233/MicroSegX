package cache

func calculateAnomalyScore(state *autoFeatureState, agg *autoWindowAggregate, srcStats *autoSourceWindowStats) (float64, []string, bool) {
	if state == nil || agg == nil {
		return 0, nil, false
	}

	novelty := 0.0
	switch {
	case state.TotalWindows <= 1:
		novelty = 1.0
	case state.TotalWindows <= 3:
		novelty = 0.5
	}

	portBurst := 0.0
	dstBurst := 0.0
	if srcStats != nil {
		portBurst = autoPolicyClamp01(float64(len(srcStats.Ports)-1) / 4.0)
		dstBurst = autoPolicyClamp01(float64(len(srcStats.Dsts)-1) / 4.0)
	}

	currentSlot := autoPolicySlotIndex(agg.LastObserved)
	timeDeviation := 0.0
	if state.TotalWindows > 3 && len(state.SlotCounters) > 1 {
		if state.SlotCounters[currentSlot] <= uint32(agg.Count) {
			timeDeviation = 1.0
		}
	}

	violationSignal := 0.0
	switch {
	case agg.ThreatID > 0 && agg.MaxSeverity >= 4:
		violationSignal = 1.0
	case agg.ThreatID > 0 || agg.Violation:
		violationSignal = 0.8
	case agg.MaxSeverity > 0:
		violationSignal = autoPolicyClamp01(float64(agg.MaxSeverity) / 5.0)
	}

	score := 0.25*novelty + 0.20*portBurst + 0.20*dstBurst + 0.15*timeDeviation + 0.20*violationSignal

	reasons := make([]string, 0, 5)
	if novelty >= 0.5 {
		reasons = append(reasons, "novel_flow")
	}
	if portBurst >= 0.5 {
		reasons = append(reasons, "multi_port_burst")
	}
	if dstBurst >= 0.5 {
		reasons = append(reasons, "multi_dst_burst")
	}
	if timeDeviation >= 0.5 {
		reasons = append(reasons, "time_deviation")
	}
	if violationSignal >= 0.5 {
		reasons = append(reasons, "violation_signal")
	}

	highConfidence := agg.ThreatID > 0 && agg.MaxSeverity >= 4
	return score, autoPolicyStableReasonCodes(reasons...), highConfidence
}
