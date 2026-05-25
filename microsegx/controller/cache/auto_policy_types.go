package cache

import (
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	log "github.com/sirupsen/logrus"

	"github.com/wushuang233/MicroSegX/microsegx/share"
	"github.com/wushuang233/MicroSegX/microsegx/share/utils"
)

type autoPolicyMode string

const (
	autoPolicyModeLegacy  autoPolicyMode = "legacy"
	autoPolicyModeShadow  autoPolicyMode = "shadow"
	autoPolicyModeEnforce autoPolicyMode = "enforce"
)

type autoPolicyConfigData struct {
	Mode                     autoPolicyMode
	WindowDuration           time.Duration
	SlotDuration             time.Duration
	DistinctDayDuration      time.Duration
	TTLCheckInterval         time.Duration
	ScheduleCheckInterval    time.Duration
	AgingInterval            time.Duration
	AnomalyRuleTTL           time.Duration
	BaselineAgingDuration    time.Duration
	PeriodicAgingDuration    time.Duration
	FeatureRetentionDuration time.Duration
	ObservationBufferLimit   int
	SystemGuardEnabled       bool
}

type autoFeatureKey struct {
	From        string
	To          string
	IsApp       bool
	IPProto     uint8
	Application uint32
}

type autoObservedEvent struct {
	Key        autoFeatureKey
	FromWL     string
	ToWL       string
	Port       string
	FQDN       string
	ObservedAt time.Time
	ThreatID   uint32
	Severity   uint32
	Violates   uint32
}

type autoWindowAggregate struct {
	Key          autoFeatureKey
	LastObserved time.Time
	Count        int
	FromWLs      map[string]struct{}
	Ports        map[string]struct{}
	FQDNs        map[string]struct{}
	Applications map[uint32]struct{}
	ThreatID     uint32
	MaxSeverity  uint32
	Violation    bool
}

type autoSourceWindowStats struct {
	Ports map[string]struct{}
	Dsts  map[string]struct{}
}

type autoFeatureScores struct {
	Baseline float64
	Periodic float64
	Anomaly  float64
}

type autoFeatureState struct {
	Key                autoFeatureKey
	FirstObserved      time.Time
	LastObserved       time.Time
	LastWindowIndex    int64
	ConsecutiveWindows uint32
	TotalWindows       uint32
	DistinctDays       uint32
	DaysSeen           map[int64]struct{}
	SrcWorkloadsSeen   map[string]struct{}
	Ports              map[string]struct{}
	FQDNs              map[string]struct{}
	Applications       map[uint32]struct{}
	SlotCounters       map[uint16]uint32
	TotalSlotHits      uint64
	TotalEvents        uint64
	ViolationCount     uint32
	MaxSeverity        uint32
	LastThreatID       uint32
	LastScores         autoFeatureScores
	ShadowClass        share.AutoPolicyClass
	ShadowConfidence   float64
	ShadowReasons      []string
}

type autoPolicyRuleChangeOp string

const (
	autoPolicyRuleUpsert autoPolicyRuleChangeOp = "upsert"
	autoPolicyRuleDelete autoPolicyRuleChangeOp = "delete"
)

type autoPolicyRuleChange struct {
	Op             autoPolicyRuleChangeOp
	Rule           *share.CLUSPolicyRule
	Meta           *share.CLUSAutoPolicyMeta
	ExistingRuleID uint32
}

type autoPolicyRuntimeStats struct {
	LastWindowProcessedAt time.Time
	LastWindowEventCount  int
	PromotionCount        uint64
	DeleteCount           uint64
	LastPromotionAt       time.Time
	LastDeleteAt          time.Time
}

type autoPolicyEvent struct {
	ID         uint64
	EventType  string
	EventClass share.AutoPolicyClass
	TargetType string
	TargetID   uint32
	TargetKey  string
	Summary    string
	CreatedAt  time.Time
	Extra      map[string]string
}

var autoPolicyConfig autoPolicyConfigData
var autoPolicyModeMutex sync.RWMutex
var autoPolicyMetaMap map[uint32]*share.CLUSAutoPolicyMeta = make(map[uint32]*share.CLUSAutoPolicyMeta)
var autoPolicyFeatureMap map[autoFeatureKey]*autoFeatureState = make(map[autoFeatureKey]*autoFeatureState)
var autoPolicyFeatureMutex sync.RWMutex
var observedEvents []autoObservedEvent
var autoPolicyStats autoPolicyRuntimeStats
var autoPolicyEvents []autoPolicyEvent
var autoPolicyEventMutex sync.RWMutex
var autoPolicyEventSeq uint64
var autoPolicyNow = func() time.Time {
	return time.Now().UTC()
}

const autoPolicyStatusCandidateLimit = 32
const autoPolicyStatusFeatureLimit = 64
const autoPolicyEventLimit = 64

func loadAutoPolicyConfig() {
	cfg := autoPolicyConfigData{
		Mode:                   autoPolicyModeLegacy,
		WindowDuration:         30 * time.Second,
		SlotDuration:           30 * time.Minute,
		DistinctDayDuration:    24 * time.Hour,
		TTLCheckInterval:       5 * time.Minute,
		ScheduleCheckInterval:  time.Minute,
		AgingInterval:          time.Hour,
		AnomalyRuleTTL:         10 * time.Minute,
		ObservationBufferLimit: 8192,
		SystemGuardEnabled:     true,
	}

	if raw := strings.TrimSpace(os.Getenv("AUTO_POLICY_MODE")); raw != "" {
		switch autoPolicyMode(strings.ToLower(raw)) {
		case autoPolicyModeLegacy, autoPolicyModeShadow, autoPolicyModeEnforce:
			cfg.Mode = autoPolicyMode(strings.ToLower(raw))
		default:
			log.WithField("value", raw).Warn("Ignore invalid AUTO_POLICY_MODE")
		}
	}

	if raw := strings.TrimSpace(os.Getenv("AUTO_POLICY_WINDOW_SECONDS")); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 {
			cfg.WindowDuration = time.Duration(v) * time.Second
		}
	}

	if raw := strings.TrimSpace(os.Getenv("AUTO_POLICY_SLOT_MINUTES")); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 {
			cfg.SlotDuration = time.Duration(v) * time.Minute
		}
	}

	if raw := strings.TrimSpace(os.Getenv("AUTO_POLICY_DISTINCT_DAY_DURATION")); raw != "" {
		if d, err := time.ParseDuration(raw); err == nil && d > 0 {
			cfg.DistinctDayDuration = d
		}
	}

	if raw := strings.TrimSpace(os.Getenv("AUTO_POLICY_TTL_CHECK_SECONDS")); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 {
			cfg.TTLCheckInterval = time.Duration(v) * time.Second
		}
	}

	if raw := strings.TrimSpace(os.Getenv("AUTO_POLICY_FEATURE_RETENTION_SECONDS")); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 {
			cfg.FeatureRetentionDuration = time.Duration(v) * time.Second
		}
	}

	if raw := strings.TrimSpace(os.Getenv("AUTO_POLICY_SYSTEM_GUARD")); raw != "" {
		switch strings.ToLower(raw) {
		case "1", "true", "yes", "on", "enable", "enabled":
			cfg.SystemGuardEnabled = true
		case "0", "false", "no", "off", "disable", "disabled":
			cfg.SystemGuardEnabled = false
		default:
			log.WithField("value", raw).Warn("Ignore invalid AUTO_POLICY_SYSTEM_GUARD")
		}
	}

	if cfg.WindowDuration <= 0 {
		cfg.WindowDuration = 5 * time.Second
	}
	if cfg.SlotDuration <= 0 {
		cfg.SlotDuration = time.Minute
	}
	if cfg.DistinctDayDuration < cfg.SlotDuration {
		cfg.DistinctDayDuration = cfg.SlotDuration
	}

	cfg.BaselineAgingDuration = 21 * cfg.DistinctDayDuration
	cfg.PeriodicAgingDuration = 21 * cfg.DistinctDayDuration
	if cfg.FeatureRetentionDuration <= 0 {
		cfg.FeatureRetentionDuration = 14 * cfg.DistinctDayDuration
	}
	if cfg.FeatureRetentionDuration < 3*cfg.WindowDuration {
		cfg.FeatureRetentionDuration = 3 * cfg.WindowDuration
	}
	autoPolicyConfig = cfg

	log.WithFields(log.Fields{
		"mode":                 cfg.Mode,
		"window":               cfg.WindowDuration,
		"slot":                 cfg.SlotDuration,
		"distinct_day":         cfg.DistinctDayDuration,
		"ttl_check":            cfg.TTLCheckInterval,
		"anomaly_ttl":          cfg.AnomalyRuleTTL,
		"baseline_aging":       cfg.BaselineAgingDuration,
		"periodic_aging":       cfg.PeriodicAgingDuration,
		"feature_retention":    cfg.FeatureRetentionDuration,
		"observation_buf_size": cfg.ObservationBufferLimit,
		"system_guard_enabled": cfg.SystemGuardEnabled,
	}).Info("Loaded auto policy config")
}

func autoPolicyInit() {
	loadAutoPolicyConfig()

	cacheMutexLock()
	autoPolicyMetaMap = make(map[uint32]*share.CLUSAutoPolicyMeta)
	cacheMutexUnlock()

	autoPolicyFeatureMutex.Lock()
	autoPolicyFeatureMap = make(map[autoFeatureKey]*autoFeatureState)
	autoPolicyFeatureMutex.Unlock()

	observedEvents = make([]autoObservedEvent, 0, autoPolicyConfig.ObservationBufferLimit)
	autoPolicyStats = autoPolicyRuntimeStats{}
	autoPolicyEventMutex.Lock()
	autoPolicyEvents = make([]autoPolicyEvent, 0, autoPolicyEventLimit)
	autoPolicyEventSeq = 0
	autoPolicyEventMutex.Unlock()

	autoPolicyBootstrapState()
}

func autoPolicyEnabled() bool {
	return currentAutoPolicyMode() != autoPolicyModeLegacy
}

func autoPolicyEnforceEnabled() bool {
	return currentAutoPolicyMode() == autoPolicyModeEnforce
}

func currentAutoPolicyMode() autoPolicyMode {
	autoPolicyModeMutex.RLock()
	defer autoPolicyModeMutex.RUnlock()
	return autoPolicyConfig.Mode
}

func setAutoPolicyMode(mode autoPolicyMode) {
	autoPolicyModeMutex.Lock()
	autoPolicyConfig.Mode = mode
	autoPolicyModeMutex.Unlock()
}

func autoPolicySlotsPerDay() int {
	slots := int(autoPolicyConfig.DistinctDayDuration / autoPolicyConfig.SlotDuration)
	if slots < 1 {
		return 1
	}
	return slots
}

func autoPolicyTotalSlots() int {
	return autoPolicySlotsPerDay() * 7
}

func autoPolicyWindowIndex(ts time.Time) int64 {
	return ts.UTC().UnixNano() / autoPolicyConfig.WindowDuration.Nanoseconds()
}

func autoPolicyDayIndex(ts time.Time) int64 {
	return ts.UTC().UnixNano() / autoPolicyConfig.DistinctDayDuration.Nanoseconds()
}

func autoPolicySlotIndex(ts time.Time) uint16 {
	slotsPerDay := autoPolicySlotsPerDay()
	if slotsPerDay <= 0 {
		return 0
	}

	dayIdx := autoPolicyDayIndex(ts)
	dayStart := time.Unix(0, dayIdx*autoPolicyConfig.DistinctDayDuration.Nanoseconds()).UTC()
	offset := ts.UTC().Sub(dayStart)
	slotWithinDay := int(offset / autoPolicyConfig.SlotDuration)
	if slotWithinDay < 0 {
		slotWithinDay = 0
	} else if slotWithinDay >= slotsPerDay {
		slotWithinDay = slotsPerDay - 1
	}

	slot := int(dayIdx%7)*slotsPerDay + slotWithinDay
	if slot < 0 {
		slot = 0
	}
	return uint16(slot)
}

func autoPolicyStableReasonCodes(values ...string) []string {
	set := utils.NewSet()
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			set.Add(value)
		}
	}

	items := make([]string, 0, set.Cardinality())
	for value := range set.Iter() {
		items = append(items, value.(string))
	}
	if len(items) == 0 {
		return nil
	}

	sort.Strings(items)
	return items
}
