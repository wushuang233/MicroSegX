package cache

import (
	"net"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/wushuang233/MicroSegX/microsegx/controller/api"
	"github.com/wushuang233/MicroSegX/microsegx/share"
	"github.com/wushuang233/MicroSegX/microsegx/share/cluster"
	"github.com/wushuang233/MicroSegX/microsegx/share/utils"
)

func withAutoPolicyTestConfig(t *testing.T) func() {
	t.Helper()

	oldCfg := autoPolicyConfig
	oldNow := autoPolicyNow
	oldMeta := autoPolicyMetaMap
	oldFeature := autoPolicyFeatureMap
	oldStats := autoPolicyStats
	oldObserved := observedEvents
	oldGroupCacheMap := groupCacheMap
	oldWLCacheMap := wlCacheMap
	oldIPWLMap := ipWLMap

	autoPolicyConfig = autoPolicyConfigData{
		Mode:                     autoPolicyModeShadow,
		WindowDuration:           5 * time.Second,
		SlotDuration:             time.Minute,
		DistinctDayDuration:      time.Minute,
		TTLCheckInterval:         time.Minute,
		ScheduleCheckInterval:    time.Minute,
		AgingInterval:            time.Hour,
		AnomalyRuleTTL:           10 * time.Minute,
		BaselineAgingDuration:    21 * time.Minute,
		PeriodicAgingDuration:    21 * time.Minute,
		FeatureRetentionDuration: 14 * time.Minute,
		ObservationBufferLimit:   128,
	}
	autoPolicyNow = func() time.Time {
		return time.Unix(600, 0).UTC()
	}
	autoPolicyMetaMap = make(map[uint32]*share.CLUSAutoPolicyMeta)
	autoPolicyFeatureMap = make(map[autoFeatureKey]*autoFeatureState)
	autoPolicyStats = autoPolicyRuntimeStats{}
	observedEvents = nil
	groupCacheMap = make(map[string]*groupCache)
	wlCacheMap = make(map[string]*workloadCache)
	ipWLMap = make(map[string]*workloadDigest)

	return func() {
		autoPolicyConfig = oldCfg
		autoPolicyNow = oldNow
		autoPolicyMetaMap = oldMeta
		autoPolicyFeatureMap = oldFeature
		autoPolicyStats = oldStats
		observedEvents = oldObserved
		groupCacheMap = oldGroupCacheMap
		wlCacheMap = oldWLCacheMap
		ipWLMap = oldIPWLMap
	}
}

func TestAutoPolicyBaselineDecision(t *testing.T) {
	preTest()
	defer postTest()
	defer withAutoPolicyTestConfig(t)()

	groupCacheMap = map[string]*groupCache{
		"src": {group: &share.CLUSGroup{Name: "src"}, members: utils.NewSet("w1", "w2", "w3")},
	}

	state := &autoFeatureState{
		Key:                autoFeatureKey{From: "src", To: "dst", IPProto: uint8(syscall.IPPROTO_TCP)},
		ConsecutiveWindows: 6,
		TotalWindows:       12,
		DistinctDays:       3,
		SrcWorkloadsSeen:   map[string]struct{}{"w1": {}, "w2": {}, "w3": {}},
		Ports:              map[string]struct{}{"tcp/8080": {}},
		SlotCounters:       map[uint16]uint32{1: 6, 2: 6},
	}

	baselineScore, baselineReasons := calculateBaselineScore(state, 0.10)
	if baselineScore < 0.75 {
		t.Fatalf("expected baseline score >= 0.75, got %.3f", baselineScore)
	}

	decision := decideAutoPolicyClass(state, baselineScore, baselineReasons, 0.20, nil, nil, 0.10, nil, false)
	if decision.Class != share.AutoPolicyBaseline {
		t.Fatalf("expected baseline decision, got %q", decision.Class)
	}
}

func TestAutoPolicyZeroTrustFastAdmissionDecision(t *testing.T) {
	defer withAutoPolicyTestConfig(t)()

	state := &autoFeatureState{
		Key:                autoFeatureKey{From: "nv.ziti-router.openziti", To: "nv.nginx.web", IPProto: uint8(syscall.IPPROTO_TCP)},
		ConsecutiveWindows: 1,
		TotalWindows:       1,
		DistinctDays:       1,
		SrcWorkloadsSeen:   map[string]struct{}{"router": {}},
		Ports:              map[string]struct{}{"tcp/80": {}},
		SlotCounters:       map[uint16]uint32{1: 1},
	}

	decision := decideAutoPolicyClass(state, 0.30, nil, 0.10, nil, nil, 0.25, nil, false)
	if decision.Class != "" {
		t.Fatalf("expected regular classifier to keep observing, got %+v", decision)
	}

	decision = applyAutoPolicyFastAdmissionDecision(state, decision, 0.25)
	if decision.Class != share.AutoPolicyBaseline {
		t.Fatalf("expected zero-trust flow to receive fast baseline admission, got %+v", decision)
	}
	if decision.Confidence < 0.65 {
		t.Fatalf("expected bounded confidence for zero-trust fast admission, got %.3f", decision.Confidence)
	}
	foundReason := false
	for _, reason := range decision.ReasonCodes {
		if reason == "zero_trust_fast_admission" {
			foundReason = true
			break
		}
	}
	if !foundReason {
		t.Fatalf("expected zero-trust fast admission reason, got %+v", decision.ReasonCodes)
	}
}

func TestAutoPolicyFeatureStatePersistAndRestore(t *testing.T) {
	defer withAutoPolicyTestConfig(t)()

	oldGet := autoPolicyGetStoreValue
	oldPut := autoPolicyPutStoreValue
	oldDelete := autoPolicyDeleteStoreValue
	defer func() {
		autoPolicyGetStoreValue = oldGet
		autoPolicyPutStoreValue = oldPut
		autoPolicyDeleteStoreValue = oldDelete
	}()

	store := map[string][]byte{}
	autoPolicyPutStoreValue = func(key string, value []byte) error {
		clone := append([]byte{}, value...)
		store[key] = clone
		return nil
	}
	autoPolicyDeleteStoreValue = func(key string) error {
		delete(store, key)
		return nil
	}
	autoPolicyGetStoreValue = func(key string) ([]byte, error) {
		value, ok := store[key]
		if !ok {
			return nil, cluster.ErrKeyNotFound
		}
		return append([]byte{}, value...), nil
	}

	key := autoFeatureKey{
		From:        "nv.periodic-sync.web",
		To:          "nv.db.web",
		IsApp:       false,
		IPProto:     uint8(syscall.IPPROTO_TCP),
		Application: 0,
	}
	autoPolicyFeatureMap = map[autoFeatureKey]*autoFeatureState{
		key: {
			Key:                key,
			FirstObserved:      time.Unix(100, 0).UTC(),
			LastObserved:       time.Unix(400, 0).UTC(),
			LastWindowIndex:    7,
			ConsecutiveWindows: 3,
			TotalWindows:       8,
			DistinctDays:       2,
			DaysSeen:           map[int64]struct{}{1: {}, 2: {}},
			SrcWorkloadsSeen:   map[string]struct{}{"wl-1": {}, "wl-2": {}},
			Ports:              map[string]struct{}{"tcp/6379": {}},
			FQDNs:              map[string]struct{}{"db.web.svc.cluster.local": {}},
			Applications:       map[uint32]struct{}{1001: {}},
			SlotCounters:       map[uint16]uint32{3: 4, 7: 2},
			TotalSlotHits:      6,
			TotalEvents:        6,
			ViolationCount:     0,
			MaxSeverity:        0,
			LastThreatID:       0,
			LastScores:         autoFeatureScores{Baseline: 0.62, Periodic: 0.83, Anomaly: 0.04},
			ShadowClass:        share.AutoPolicyPeriodic,
			ShadowConfidence:   0.83,
			ShadowReasons:      []string{"periodic_window_clustered"},
		},
	}

	if err := persistAutoPolicyFeatureStates(); err != nil {
		t.Fatalf("persistAutoPolicyFeatureStates() error = %v", err)
	}
	if _, ok := store[share.CLUSConfigAutoPolicyFeatureStateKey]; !ok {
		t.Fatalf("expected persisted feature snapshot at %s", share.CLUSConfigAutoPolicyFeatureStateKey)
	}

	autoPolicyFeatureMap = map[autoFeatureKey]*autoFeatureState{}
	autoPolicyBootstrapFeatureStates()

	restored, ok := autoPolicyFeatureMap[key]
	if !ok {
		t.Fatal("expected feature state to be restored")
	}
	if restored.TotalWindows != 8 || restored.ConsecutiveWindows != 3 {
		t.Fatalf("unexpected restored window counters: %+v", restored)
	}
	if restored.SlotCounters[3] != 4 || restored.SlotCounters[7] != 2 {
		t.Fatalf("unexpected restored slot counters: %+v", restored.SlotCounters)
	}
	if restored.ShadowClass != share.AutoPolicyPeriodic || restored.ShadowConfidence != 0.83 {
		t.Fatalf("unexpected restored shadow decision: %+v", restored)
	}
	if _, ok := restored.DaysSeen[2]; !ok {
		t.Fatalf("expected restored distinct-day memory, got %+v", restored.DaysSeen)
	}
}

func TestAutoPolicyPeriodicDecisionAndActivation(t *testing.T) {
	preTest()
	defer postTest()
	defer withAutoPolicyTestConfig(t)()

	groupCacheMap = map[string]*groupCache{
		"src": {group: &share.CLUSGroup{Name: "src"}, members: utils.NewSet("w1", "w2", "w3", "w4", "w5", "w6")},
	}

	state := &autoFeatureState{
		Key:                autoFeatureKey{From: "src", To: "dst", IPProto: uint8(syscall.IPPROTO_TCP)},
		ConsecutiveWindows: 1,
		TotalWindows:       7,
		DistinctDays:       7,
		SrcWorkloadsSeen:   map[string]struct{}{"w1": {}},
		Ports:              map[string]struct{}{"tcp/9000": {}},
		SlotCounters:       map[uint16]uint32{5: 14, 6: 1},
	}

	periodicScore, slots, periodicReasons := calculatePeriodicScore(state)
	baselineScore, baselineReasons := calculateBaselineScore(state, 0.05)
	if periodicScore < 0.70 {
		t.Fatalf("expected periodic score >= 0.70, got %.3f", periodicScore)
	}

	decision := decideAutoPolicyClass(state, baselineScore, baselineReasons, periodicScore, slots, periodicReasons, 0.05, nil, false)
	if decision.Class != share.AutoPolicyPeriodic {
		t.Fatalf("expected periodic decision, got %q", decision.Class)
	}

	meta := &share.CLUSAutoPolicyMeta{
		Class:         share.AutoPolicyPeriodic,
		PeriodicSlots: []uint16{autoPolicySlotIndex(autoPolicyNow())},
	}
	if !isPeriodicRuleActive(meta, autoPolicyNow()) {
		t.Fatal("expected periodic rule to be active in current slot")
	}
}

func TestAutoPolicyAnomalyDecision(t *testing.T) {
	preTest()
	defer postTest()
	defer withAutoPolicyTestConfig(t)()

	state := &autoFeatureState{
		Key:              autoFeatureKey{From: "src", To: "dst", IPProto: uint8(syscall.IPPROTO_TCP)},
		TotalWindows:     1,
		DistinctDays:     1,
		Ports:            map[string]struct{}{"tcp/22": {}},
		SlotCounters:     map[uint16]uint32{autoPolicySlotIndex(autoPolicyNow()): 1},
		SrcWorkloadsSeen: map[string]struct{}{"w1": {}},
	}
	agg := &autoWindowAggregate{
		Key:          state.Key,
		LastObserved: autoPolicyNow(),
		Count:        3,
		Ports:        map[string]struct{}{"tcp/22": {}},
		ThreatID:     1001,
		MaxSeverity:  5,
		Violation:    true,
	}
	srcStats := &autoSourceWindowStats{
		Ports: map[string]struct{}{
			"tcp/22": {}, "tcp/80": {}, "tcp/443": {}, "tcp/3306": {}, "tcp/6379": {},
		},
		Dsts: map[string]struct{}{
			"dst": {}, "dst-2": {}, "dst-3": {}, "dst-4": {},
		},
	}

	anomalyScore, anomalyReasons, highConfidence := calculateAnomalyScore(state, agg, srcStats)
	decision := decideAutoPolicyClass(state, 0.20, nil, 0.10, nil, nil, anomalyScore, anomalyReasons, highConfidence)
	if decision.Class != share.AutoPolicyAnomaly {
		t.Fatalf("expected anomaly decision, got %q", decision.Class)
	}
}

func TestCompileActiveAutoRulesOrdering(t *testing.T) {
	preTest()
	defer postTest()
	defer withAutoPolicyTestConfig(t)()
	setAutoPolicyMode(autoPolicyModeEnforce)

	oldRuleMap := policyCache.ruleMap
	oldRuleHeads := policyCache.ruleHeads
	defer func() {
		policyCache.ruleMap = oldRuleMap
		policyCache.ruleHeads = oldRuleHeads
	}()

	now := autoPolicyNow()
	activeSlot := autoPolicySlotIndex(now)

	policyCache.ruleMap = map[uint32]*share.CLUSPolicyRule{
		100001: {ID: 100001, From: "fed", To: "dst", Ports: "tcp/80", Action: share.PolicyActionAllow, CfgType: share.FederalCfg},
		110001: {ID: 110001, From: "ground", To: "dst", Ports: "tcp/80", Action: share.PolicyActionAllow, CfgType: share.GroundCfg},
		10:     {ID: 10, From: "user", To: "dst", Ports: "tcp/80", Action: share.PolicyActionAllow, CfgType: share.UserCreated},
		10010:  {ID: 10010, From: "legacy", To: "dst", Ports: "tcp/80", Action: share.PolicyActionAllow, CfgType: share.Learned},
		10011:  {ID: 10011, From: "anomaly", To: "dst", Ports: "tcp/22", Action: share.PolicyActionDeny, CfgType: share.Learned},
		10012:  {ID: 10012, From: "periodic", To: "dst", Ports: "tcp/5432", Action: share.PolicyActionAllow, CfgType: share.Learned},
		10013:  {ID: 10013, From: "baseline", To: "dst", Ports: "tcp/8080", Action: share.PolicyActionAllow, CfgType: share.Learned},
	}
	policyCache.ruleHeads = []*share.CLUSRuleHead{
		{ID: 10013, CfgType: share.Learned},
		{ID: 10, CfgType: share.UserCreated},
		{ID: 100001, CfgType: share.FederalCfg},
		{ID: 10010, CfgType: share.Learned},
		{ID: 10012, CfgType: share.Learned},
		{ID: 110001, CfgType: share.GroundCfg},
		{ID: 10011, CfgType: share.Learned},
	}
	policyCache.ruleOrderMap = ruleHeads2OrderMap(policyCache.ruleHeads)

	autoPolicyMetaMap = map[uint32]*share.CLUSAutoPolicyMeta{
		10011: {RuleID: 10011, Class: share.AutoPolicyAnomaly},
		10012: {RuleID: 10012, Class: share.AutoPolicyPeriodic, PeriodicSlots: []uint16{activeSlot}},
		10013: {RuleID: 10013, Class: share.AutoPolicyBaseline},
	}

	ordered := compileActiveAutoRules(now)
	got := make([]uint32, 0, len(ordered))
	for _, rule := range ordered {
		got = append(got, rule.ID)
	}

	want := []uint32{100001, 110001, 10011, 10, 10012, 10013}
	if len(got) != len(want) {
		t.Fatalf("unexpected rule count: got %v want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("unexpected ordering at %d: got %v want %v", i, got, want)
		}
	}
}

func TestCompileActiveAutoRulesKeepsLegacyLearnedOnlyInLegacyMode(t *testing.T) {
	preTest()
	defer postTest()
	defer withAutoPolicyTestConfig(t)()

	oldRuleMap := policyCache.ruleMap
	oldRuleHeads := policyCache.ruleHeads
	defer func() {
		policyCache.ruleMap = oldRuleMap
		policyCache.ruleHeads = oldRuleHeads
	}()

	policyCache.ruleMap = map[uint32]*share.CLUSPolicyRule{
		10:    {ID: 10, From: "user", To: "dst", Ports: "tcp/80", Action: share.PolicyActionAllow, CfgType: share.UserCreated},
		10010: {ID: 10010, From: "legacy", To: "dst", Ports: "tcp/80", Action: share.PolicyActionAllow, CfgType: share.Learned},
	}
	policyCache.ruleHeads = []*share.CLUSRuleHead{
		{ID: 10010, CfgType: share.Learned},
		{ID: 10, CfgType: share.UserCreated},
	}
	policyCache.ruleOrderMap = ruleHeads2OrderMap(policyCache.ruleHeads)

	setAutoPolicyMode(autoPolicyModeLegacy)
	legacyOrdered := compileActiveAutoRules(autoPolicyNow())
	if len(legacyOrdered) != 2 || legacyOrdered[0].ID != 10 || legacyOrdered[1].ID != 10010 {
		t.Fatalf("expected legacy mode to keep legacy learned after user rules, got %+v", legacyOrdered)
	}

	setAutoPolicyMode(autoPolicyModeShadow)
	autoOrdered := compileActiveAutoRules(autoPolicyNow())
	if len(autoOrdered) != 1 || autoOrdered[0].ID != 10 {
		t.Fatalf("expected auto mode to exclude legacy learned rules, got %+v", autoOrdered)
	}
}

func TestCompileActiveAutoRulesSystemGuardIsBootstrapScoped(t *testing.T) {
	preTest()
	defer postTest()
	defer withAutoPolicyTestConfig(t)()

	now := time.Unix(0, 0).UTC()
	autoPolicyNow = func() time.Time { return now }
	autoPolicyConfig.Mode = autoPolicyModeShadow

	groupCacheMap = map[string]*groupCache{
		"frontend.default": {
			group: &share.CLUSGroup{Name: "frontend.default", Kind: share.GroupKindContainer},
		},
		"nv.ziti-router.openziti": {
			group:   &share.CLUSGroup{Name: "nv.ziti-router.openziti", Kind: share.GroupKindContainer},
			members: utils.NewSet("ziti-router"),
		},
		"nv.microsegx-manager-pod.microsegx": {
			group:   &share.CLUSGroup{Name: "nv.microsegx-manager-pod.microsegx", Kind: share.GroupKindContainer},
			members: utils.NewSet("manager"),
		},
		"nv.microsegx-controller-pod.microsegx": {
			group:   &share.CLUSGroup{Name: "nv.microsegx-controller-pod.microsegx", Kind: share.GroupKindContainer},
			members: utils.NewSet("controller"),
		},
	}
	wlCacheMap = map[string]*workloadCache{
		"scanner": {
			workload:         &share.CLUSWorkload{ID: "scanner", Name: "microsegx-scanner-pod", Domain: "microsegx", Running: true},
			learnedGroupName: "nv.microsegx-scanner-pod.microsegx",
		},
	}
	policyCache.ruleMap = map[uint32]*share.CLUSPolicyRule{
		10: {ID: 10, From: "frontend.default", To: "backend.default", Ports: "tcp/80", Action: share.PolicyActionDeny, CfgType: share.UserCreated},
	}
	policyCache.ruleHeads = []*share.CLUSRuleHead{{ID: 10, CfgType: share.UserCreated}}
	policyCache.ruleOrderMap = ruleHeads2OrderMap(policyCache.ruleHeads)
	autoPolicyConfig.SystemGuardEnabled = true

	ordered := compileActiveAutoRules(now)
	guardCount := len(ordered) - 1
	if guardCount != 10 {
		t.Fatalf("unexpected bootstrap guard rule count: got %d guards in %+v", guardCount, ordered)
	}
	scannerProtected := false
	for i := 0; i < guardCount; i++ {
		if ordered[i].CfgType != share.SystemDefined || ordered[i].Action != share.PolicyActionAllow {
			t.Fatalf("expected bootstrap guard before user rules: %+v", ordered)
		}
		if ordered[i].From == api.LearnedExternal {
			t.Fatalf("bootstrap guard must not add external ingress rules: %+v", ordered[i])
		}
		if strings.HasSuffix(ordered[i].From, ".openziti") {
			if ordered[i].To != "nv.microsegx-manager-pod.microsegx" || ordered[i].Ports != "tcp/8443" {
				t.Fatalf("expected OpenZiti to be allowed only to manager 8443: %+v", ordered[i])
			}
			continue
		}
		if !strings.HasSuffix(ordered[i].From, ".microsegx") || !strings.HasSuffix(ordered[i].To, ".microsegx") {
			t.Fatalf("expected bootstrap guard to be limited to microsegx internal or openziti->manager: %+v", ordered[i])
		}
		if ordered[i].Ports != "any" {
			t.Fatalf("expected microsegx internal bootstrap guard to be unrestricted: %+v", ordered[i])
		}
		if ordered[i].From == "nv.microsegx-scanner-pod.microsegx" || ordered[i].To == "nv.microsegx-scanner-pod.microsegx" {
			scannerProtected = true
		}
	}
	if !scannerProtected {
		t.Fatalf("expected live workload fallback to protect scanner group: %+v", ordered)
	}
	if ordered[guardCount].ID != 10 {
		t.Fatalf("expected user rule after bootstrap guard: %+v", ordered)
	}
}

func TestBuildMergedPorts(t *testing.T) {
	defer withAutoPolicyTestConfig(t)()

	ports := map[string]struct{}{
		"tcp/8080": {},
		"tcp/8081": {},
		"tcp/8082": {},
		"udp/53":   {},
		"udp/123":  {},
	}

	got := buildMergedPorts(ports)
	want := "tcp/8080-8082,udp/123,udp/53"
	if got != want {
		t.Fatalf("unexpected merged ports: got %q want %q", got, want)
	}
}

func TestAutoPolicyAppFeatureSuppressesLayer4Duplicate(t *testing.T) {
	preTest()
	defer postTest()
	defer withAutoPolicyTestConfig(t)()

	now := time.Unix(1200, 0).UTC()
	l4 := &autoWindowAggregate{
		Key:          autoFeatureKey{From: "nv.ziti-router.openziti", To: "nv.nginx.web", IPProto: uint8(syscall.IPPROTO_TCP)},
		LastObserved: now,
		Count:        1,
		FromWLs:      map[string]struct{}{"router": {}},
		Ports:        map[string]struct{}{"tcp/80": {}},
		FQDNs:        map[string]struct{}{},
		Applications: map[uint32]struct{}{},
	}
	if state := updateAutoFeatureState(l4); state == nil {
		t.Fatal("expected initial layer-4 feature to be stored")
	}

	app := &autoWindowAggregate{
		Key:          autoFeatureKey{From: "nv.ziti-router.openziti", To: "nv.nginx.web", IsApp: true, IPProto: uint8(syscall.IPPROTO_TCP), Application: 1001},
		LastObserved: now.Add(time.Second),
		Count:        1,
		FromWLs:      map[string]struct{}{"router": {}},
		Ports:        map[string]struct{}{},
		FQDNs:        map[string]struct{}{},
		Applications: map[uint32]struct{}{1001: {}},
	}
	if state := updateAutoFeatureState(app); state == nil {
		t.Fatal("expected app feature to be stored")
	}
	if _, ok := autoPolicyFeatureMap[l4.Key]; ok {
		t.Fatal("expected app feature to remove duplicate layer-4 feature")
	}
	if state := updateAutoFeatureState(l4); state != nil {
		t.Fatal("expected future layer-4 feature to be suppressed while app feature exists")
	}
}

func TestAutoPolicyAllowsAndNormalizesPortAuditNodeScanFlow(t *testing.T) {
	defer withAutoPolicyTestConfig(t)()

	if autoPolicyShouldIgnoreFlow("nv.k8s-port-audit.port-audit", "nodes") {
		t.Fatal("expected k8s-port-audit to nodes flow to stay learnable")
	}
	from, to := autoPolicyNormalizeInfrastructureFlowGroups("nv.k8s-port-audit.port-audit", "Host:wushuang-node")
	if from != "nv.k8s-port-audit.port-audit" || to != "nodes" {
		t.Fatalf("expected k8s-port-audit host scan to normalize to nodes, got %q -> %q", from, to)
	}
	if autoPolicyShouldIgnoreFlow("nv.port-audit-ziti-host.port-audit", "nv.k8s-port-audit.port-audit") {
		t.Fatal("expected port-audit ziti host system flow to remain observable")
	}
	if autoPolicyShouldIgnoreFlow("nv.ziti-router.openziti", "nv.microsegx-service-webui.microsegx") {
		t.Fatal("expected ziti-router to microsegx webui flow to remain learnable")
	}
}

func TestAutoPolicyFastAdmitsPortAuditNodeScanAsSingleRule(t *testing.T) {
	defer withAutoPolicyTestConfig(t)()

	state := &autoFeatureState{
		Key:                autoFeatureKey{From: "nv.k8s-port-audit.port-audit", To: "nodes", IPProto: uint8(syscall.IPPROTO_TCP)},
		FirstObserved:      autoPolicyNow(),
		LastObserved:       autoPolicyNow(),
		ConsecutiveWindows: 1,
		TotalWindows:       1,
		DistinctDays:       1,
		SrcWorkloadsSeen:   map[string]struct{}{"audit-pod": {}},
		Ports:              map[string]struct{}{"tcp/22": {}, "tcp/80": {}, "tcp/10250": {}},
		SlotCounters:       map[uint16]uint32{autoPolicySlotIndex(autoPolicyNow()): 3},
	}

	decision := applyAutoPolicyFastAdmissionDecision(state, autoDecision{}, 0.45)
	if decision.Class != share.AutoPolicyBaseline {
		t.Fatalf("expected port-audit node scan to be fast-admitted as baseline, got %+v", decision)
	}

	change, ok := buildAutoPolicyRuleChange(state, decision, nil)
	if !ok || change.Rule == nil {
		t.Fatal("expected port-audit node scan rule change")
	}
	if change.Rule.Ports != "tcp/1-65535" {
		t.Fatalf("expected node scan ports to collapse to a single TCP range, got %q", change.Rule.Ports)
	}
}

func TestAutoPolicyResolvesWorkloadIPToZeroTrustGroup(t *testing.T) {
	defer withAutoPolicyTestConfig(t)()

	wlID := "ziti-router-workload"
	wlCacheMap[wlID] = &workloadCache{
		workload:         &share.CLUSWorkload{ID: wlID, Name: "ziti-router", Domain: "openziti"},
		learnedGroupName: "nv.ziti-router.openziti",
	}
	ipWLMap["10.42.0.163"] = &workloadDigest{wlID: wlID, alive: true, managed: true}

	got := autoPolicyResolveObservedGroup("Workload:10.42.0.163", net.ParseIP("10.42.0.163"))
	if got != "nv.ziti-router.openziti" {
		t.Fatalf("expected workload IP to resolve to zero-trust group, got %q", got)
	}

	semantics := autoPolicyFlowSemanticsForGroups(got, "nv.nginx.web")
	if semantics.TrafficSource != autoPolicyTrafficZeroTrust || !semantics.ZeroTrust {
		t.Fatalf("expected resolved flow to be zero-trust, got %+v", semantics)
	}

	controlPlaneSemantics := autoPolicyFlowSemanticsForGroups("Workload:ingress", "nv.ziti-controller.openziti")
	if controlPlaneSemantics.TrafficSource != autoPolicyTrafficZeroTrust {
		t.Fatalf("expected ingress to ziti-controller to be zero-trust access/control traffic, got %+v", controlPlaneSemantics)
	}
}

func TestAutoPolicyResolvesServiceIPToWorkloadGroupByName(t *testing.T) {
	defer withAutoPolicyTestConfig(t)()

	groupCacheMap["nv.nginx.web"] = &groupCache{
		group:   &share.CLUSGroup{Name: "nv.nginx.web", Kind: share.GroupKindContainer},
		members: utils.NewSet("nginx-1"),
	}
	groupCacheMap["nv.ip.nginx.web"] = &groupCache{
		group:    &share.CLUSGroup{Name: "nv.ip.nginx.web", Kind: share.GroupKindIPService, Domain: "web"},
		svcAddrs: utils.NewSet("10.43.1.10"),
	}

	got := autoPolicyResolveObservedGroup("nv.ip.nginx.web", net.ParseIP("10.43.1.10"))
	if got != "nv.nginx.web" {
		t.Fatalf("expected service IP group to resolve to workload group, got %q", got)
	}
}

func TestAutoPolicyResolvesServiceIPToWorkloadGroupBySelector(t *testing.T) {
	defer withAutoPolicyTestConfig(t)()

	groupCacheMap["nv.ip.backend-svc.learn"] = &groupCache{
		group: &share.CLUSGroup{
			Name:   "nv.ip.backend-svc.learn",
			Kind:   share.GroupKindIPService,
			Domain: "learn",
			Criteria: []share.CLUSCriteriaEntry{
				{Key: share.CriteriaKeyDomain, Value: "learn", Op: share.CriteriaOpEqual},
				{Key: share.CriteriaKeyLabel, Value: "app=backend", Op: share.CriteriaOpEqual},
			},
		},
		svcAddrs: utils.NewSet("10.43.1.20"),
	}
	groupCacheMap["nv.backend.learn"] = &groupCache{
		group:   &share.CLUSGroup{Name: "nv.backend.learn", Kind: share.GroupKindContainer},
		members: utils.NewSet("backend-1"),
	}
	wlCacheMap["backend-1"] = &workloadCache{
		workload: &share.CLUSWorkload{
			ID:      "backend-1",
			Name:    "backend-6897cfb7d-65bvt",
			Domain:  "learn",
			Running: true,
			Labels:  map[string]string{"app": "backend"},
		},
		learnedGroupName: "nv.backend.learn",
	}

	got := autoPolicyResolveObservedGroup("nv.ip.backend-svc.learn", net.ParseIP("10.43.1.20"))
	if got != "nv.backend.learn" {
		t.Fatalf("expected service selector to resolve to backend workload group, got %q", got)
	}
}

func TestAutoPolicyNormalizesConnectionNodeAttribution(t *testing.T) {
	defer withAutoPolicyTestConfig(t)()

	wlID := "ziti-router-workload"
	wlCacheMap[wlID] = &workloadCache{
		workload:         &share.CLUSWorkload{ID: wlID, Name: "ziti-router", Domain: "openziti"},
		learnedGroupName: "nv.ziti-router.openziti",
	}
	ipWLMap["10.42.0.163"] = &workloadDigest{wlID: wlID, alive: true, managed: true}

	conn := &share.CLUSConnection{
		ClientWL: "Workload:10.42.0.163",
		ServerWL: "nginx-workload",
		ClientIP: net.ParseIP("10.42.0.163").To4(),
		ServerIP: net.ParseIP("10.42.0.174").To4(),
	}
	ca := &nodeAttr{external: true}
	sa := &nodeAttr{workload: true, managed: true}
	normalizeAutoPolicyConnectionAttribution(conn, ca, sa)

	if conn.ClientWL != wlID {
		t.Fatalf("expected client node to be normalized to workload id, got %q", conn.ClientWL)
	}
	if !ca.workload || !ca.managed || ca.external {
		t.Fatalf("expected client node attributes to become managed workload, got %+v", ca)
	}
}

func TestAutoPolicySeparatesZeroTrustIngressAndDirectPaths(t *testing.T) {
	preTest()
	defer postTest()
	defer withAutoPolicyTestConfig(t)()

	target := "nv.nginx.web"
	autoPolicyFeatureMap = map[autoFeatureKey]*autoFeatureState{
		{From: "nv.ziti-router.openziti", To: target, IPProto: uint8(syscall.IPPROTO_TCP)}: {
			Key:          autoFeatureKey{From: "nv.ziti-router.openziti", To: target, IPProto: uint8(syscall.IPPROTO_TCP)},
			LastObserved: autoPolicyNow(),
			Ports:        map[string]struct{}{"tcp/80": {}},
		},
		{From: "Workload:ingress", To: target, IPProto: uint8(syscall.IPPROTO_TCP)}: {
			Key:          autoFeatureKey{From: "Workload:ingress", To: target, IPProto: uint8(syscall.IPPROTO_TCP)},
			LastObserved: autoPolicyNow(),
			Ports:        map[string]struct{}{"tcp/80": {}},
		},
		{From: "nv.frontend.web", To: target, IPProto: uint8(syscall.IPPROTO_TCP)}: {
			Key:          autoFeatureKey{From: "nv.frontend.web", To: target, IPProto: uint8(syscall.IPPROTO_TCP)},
			LastObserved: autoPolicyNow(),
			Ports:        map[string]struct{}{"tcp/80": {}},
		},
	}

	status := CacheMethod{}.GetAutoPolicyStatus(nil)
	if status.ZeroTrustFeatureCount != 1 || status.IngressFeatureCount != 1 || status.DirectFeatureCount != 1 {
		t.Fatalf("expected separated path counts, got zero=%d ingress=%d direct=%d",
			status.ZeroTrustFeatureCount, status.IngressFeatureCount, status.DirectFeatureCount)
	}

	features := CacheMethod{}.GetAllAutoPolicyFeatures(nil)
	sources := make(map[string]int)
	for _, feature := range features {
		sources[feature.TrafficSource]++
	}
	if sources[autoPolicyTrafficZeroTrust] != 1 || sources[autoPolicyTrafficIngress] != 1 || sources[autoPolicyTrafficDirect] != 1 {
		t.Fatalf("expected REST features to keep separate path sources, got %+v", sources)
	}
}

func TestCompileActiveAutoRulesKeepsPortAuditNodeScanRules(t *testing.T) {
	preTest()
	defer postTest()
	defer withAutoPolicyTestConfig(t)()
	setAutoPolicyMode(autoPolicyModeEnforce)

	oldRuleMap := policyCache.ruleMap
	oldRuleHeads := policyCache.ruleHeads
	defer func() {
		policyCache.ruleMap = oldRuleMap
		policyCache.ruleHeads = oldRuleHeads
	}()

	policyCache.ruleMap = map[uint32]*share.CLUSPolicyRule{
		10010: {ID: 10010, From: "nv.k8s-port-audit.port-audit", To: "nodes", Ports: "tcp/1-65535", Action: share.PolicyActionAllow, CfgType: share.Learned},
		10011: {ID: 10011, From: "nv.ziti-router.openziti", To: "nv.microsegx-service-webui.microsegx", Ports: "tcp/8443", Action: share.PolicyActionAllow, CfgType: share.Learned},
	}
	policyCache.ruleHeads = []*share.CLUSRuleHead{
		{ID: 10010, CfgType: share.Learned},
		{ID: 10011, CfgType: share.Learned},
	}
	policyCache.ruleOrderMap = ruleHeads2OrderMap(policyCache.ruleHeads)
	autoPolicyMetaMap = map[uint32]*share.CLUSAutoPolicyMeta{
		10010: {RuleID: 10010, Class: share.AutoPolicyBaseline},
		10011: {RuleID: 10011, Class: share.AutoPolicyBaseline},
	}

	ordered := compileActiveAutoRules(autoPolicyNow())
	if len(ordered) != 2 || ordered[0].ID != 10010 || ordered[1].ID != 10011 {
		t.Fatalf("expected port-audit node scan and ziti-router webui rules to remain active, got %+v", ordered)
	}
}

func TestGetAutoPolicyStatusIncludesCandidates(t *testing.T) {
	preTest()
	defer postTest()
	defer withAutoPolicyTestConfig(t)()

	autoPolicyFeatureMap = map[autoFeatureKey]*autoFeatureState{
		{From: "frontend", To: "backend", IPProto: uint8(syscall.IPPROTO_TCP)}: {
			Key:                autoFeatureKey{From: "frontend", To: "backend", IPProto: uint8(syscall.IPPROTO_TCP)},
			LastObserved:       autoPolicyNow(),
			ConsecutiveWindows: 6,
			TotalWindows:       9,
			DistinctDays:       3,
			Ports:              map[string]struct{}{"tcp/8080": {}, "tcp/8081": {}},
			FQDNs:              map[string]struct{}{"api.demo.local": {}},
			LastScores: autoFeatureScores{
				Baseline: 0.91,
				Periodic: 0.12,
				Anomaly:  0.04,
			},
			ShadowClass:      share.AutoPolicyBaseline,
			ShadowConfidence: 0.91,
			ShadowReasons:    []string{"stable_windows", "distinct_days"},
		},
	}
	observedEvents = []autoObservedEvent{{}}

	status := CacheMethod{}.GetAutoPolicyStatus(nil)
	if status == nil {
		t.Fatal("expected auto policy status")
	}
	if status.ObservedEventCount != 1 {
		t.Fatalf("unexpected observed event count: %d", status.ObservedEventCount)
	}
	if status.CandidateBaseline != 1 {
		t.Fatalf("unexpected baseline candidate count: %d", status.CandidateBaseline)
	}
	if len(status.Candidates) != 1 {
		t.Fatalf("unexpected candidate list length: %d", len(status.Candidates))
	}

	candidate := status.Candidates[0]
	if candidate.Class != string(share.AutoPolicyBaseline) {
		t.Fatalf("unexpected candidate class: %q", candidate.Class)
	}
	if candidate.From != "frontend" || candidate.To != "backend" {
		t.Fatalf("unexpected candidate groups: %+v", candidate)
	}
	if len(candidate.Ports) != 2 || candidate.Ports[0] != "tcp/8080" || candidate.Ports[1] != "tcp/8081" {
		t.Fatalf("unexpected candidate ports: %+v", candidate.Ports)
	}
	if len(candidate.FQDNs) != 1 || candidate.FQDNs[0] != "api.demo.local" {
		t.Fatalf("unexpected candidate fqdns: %+v", candidate.FQDNs)
	}
}

func TestAutoPolicyFeatureStatusIncludesCoverageSource(t *testing.T) {
	preTest()
	defer postTest()
	defer withAutoPolicyTestConfig(t)()

	groupCacheMap = map[string]*groupCache{
		"frontend": {group: &share.CLUSGroup{Name: "frontend"}, members: utils.NewSet("w1", "w2")},
	}

	state := &autoFeatureState{
		Key:              autoFeatureKey{From: "frontend", To: "backend", IPProto: uint8(syscall.IPPROTO_TCP)},
		LastObserved:     autoPolicyNow(),
		TotalWindows:     1,
		DistinctDays:     1,
		SrcWorkloadsSeen: map[string]struct{}{"w1": {}},
		Ports:            map[string]struct{}{"tcp/8080": {}},
	}

	resp := autoPolicyFeatureToREST(state)
	if resp == nil {
		t.Fatal("expected feature response")
	}
	if resp.SourceWorkloadCount != 1 || resp.SourceGroupSize != 2 || resp.SourceGroupSizeEstimated {
		t.Fatalf("unexpected source coverage fields: %+v", resp)
	}
	if resp.WorkloadCoverage != 0.5 {
		t.Fatalf("unexpected workload coverage: %f", resp.WorkloadCoverage)
	}
}

func TestCleanupAutoPolicyFeatureStates(t *testing.T) {
	preTest()
	defer postTest()
	defer withAutoPolicyTestConfig(t)()

	autoPolicyConfig.FeatureRetentionDuration = 10 * time.Minute
	now := autoPolicyNow()
	staleKey := autoFeatureKey{From: "stale", To: "backend", IPProto: uint8(syscall.IPPROTO_TCP)}
	freshKey := autoFeatureKey{From: "fresh", To: "backend", IPProto: uint8(syscall.IPPROTO_TCP)}
	serviceIPKey := autoFeatureKey{From: "client", To: "nv.ip.backend.learn", IPProto: uint8(syscall.IPPROTO_TCP)}
	autoPolicyFeatureMap = map[autoFeatureKey]*autoFeatureState{
		staleKey: {
			Key:          staleKey,
			LastObserved: now.Add(-11 * time.Minute),
		},
		freshKey: {
			Key:          freshKey,
			LastObserved: now.Add(-9 * time.Minute),
		},
		serviceIPKey: {
			Key:          serviceIPKey,
			LastObserved: now,
		},
	}

	deleted := cleanupAutoPolicyFeatureStatesLocked(now)
	if deleted != 2 {
		t.Fatalf("unexpected deleted feature count: %d", deleted)
	}
	if _, ok := autoPolicyFeatureMap[staleKey]; ok {
		t.Fatal("expected stale feature to be deleted")
	}
	if _, ok := autoPolicyFeatureMap[serviceIPKey]; ok {
		t.Fatal("expected service IP feature to be deleted")
	}
	if _, ok := autoPolicyFeatureMap[freshKey]; !ok {
		t.Fatal("expected fresh feature to remain")
	}
}
