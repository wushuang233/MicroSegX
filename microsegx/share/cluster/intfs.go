package cluster

import (
	"errors"
	"fmt"
	"net"
	"strings"
	"time"

	log "github.com/sirupsen/logrus"
	"github.com/wushuang233/MicroSegX/microsegx/share"
	consulapi "github.com/wushuang233/MicroSegX/microsegx/share/cluster/api"
	"github.com/wushuang233/MicroSegX/microsegx/share/system"
	"github.com/wushuang233/MicroSegX/microsegx/share/utils"
)

const InternalCertDir = "/etc/microsegx/certs/internal/"

const InternalCACert string = "ca.cert"
const InternalCert string = "cert.pem"
const InternalCertKey string = "cert.key"
const InternalCertCN string = "MicroSegX"

// --

const DefaultControllerGRPCPort = 18400
const DefaultAgentGRPCPort = 18401
const DefaultScannerGRPCPort = 18402
const DefaultMigrationGRPCPort = 18500

const DefaultDataCenter string = "microsegx"

var ErrPutCAS error = errors.New("CAS put error")
var errSizeTooBig error = errors.New("size too big")

const putRetryTimes int = 2
const putRetryInterval time.Duration = time.Millisecond * 500

var errorRestart bool

type ClusterConfig struct {
	ID             string
	Server         bool
	Debug          bool
	Ifaces         map[string][]share.CLUSIPAddr
	JoinAddr       string
	joinAddrList   []string
	joinTargetList []string
	BindAddr       string
	AdvertiseAddr  string
	DataCenter     string
	RPCPort        uint
	LANPort        uint
	WANPort        uint
	HTTPPort       uint
	EnableDebug    bool
}

var clusterCfg ClusterConfig

const (
	ClusterNotifyAdd = iota
	ClusterNotifyModify
	ClusterNotifyDelete
	ClusterNotifyStateOnline
	ClusterNotifyStateOffline
)

var ClusterNotifyName = []string{
	ClusterNotifyAdd:          "add",
	ClusterNotifyModify:       "modify",
	ClusterNotifyDelete:       "delete",
	ClusterNotifyStateOnline:  "connect",
	ClusterNotifyStateOffline: "disconnect",
}

type ClusterNotifyType int

const (
	NodeRoleServer = iota
	NodeRoleClient
)

const (
	NodeStateAlive = iota
	NodeStateLeft
	NodeStateFail
)

type ClusterMemberInfo struct {
	Name  string
	Role  int
	State int
}

const (
	consulNodeServerSuffix = "-server"
	consulNodeClientSuffix = "-client"
)

func BuildConsulNodeName(addr string, server bool) string {
	if server {
		return addr + consulNodeServerSuffix
	}
	return addr + consulNodeClientSuffix
}

func GetConsulNodeAddress(name string) string {
	switch {
	case strings.HasSuffix(name, consulNodeServerSuffix):
		return strings.TrimSuffix(name, consulNodeServerSuffix)
	case strings.HasSuffix(name, consulNodeClientSuffix):
		return strings.TrimSuffix(name, consulNodeClientSuffix)
	default:
		return name
	}
}

func GetConsulNodeRole(name string) (int, bool) {
	switch {
	case strings.HasSuffix(name, consulNodeServerSuffix):
		return NodeRoleServer, true
	case strings.HasSuffix(name, consulNodeClientSuffix):
		return NodeRoleClient, true
	default:
		return 0, false
	}
}

func splitClusterJoinAddr(addr string) (string, string) {
	addr = strings.TrimSpace(addr)
	if host, port, err := net.SplitHostPort(addr); err == nil {
		return host, port
	}
	return addr, ""
}

func resolveJoinAddrs(addrStr string, skipLoopback bool) ([]string, bool) {
	var resolved bool

	addrList := strings.Split(addrStr, ",")
	ipList := make([]string, 0)
	seen := make(map[string]struct{})

	for _, addr := range addrList {
		host, _ := splitClusterJoinAddr(addr)
		if host == "" {
			continue
		}

		if ip := net.ParseIP(host); ip != nil {
			if skipLoopback && ip.IsLoopback() {
				continue
			}
			ipStr := ip.String()
			if _, ok := seen[ipStr]; ok {
				log.WithFields(log.Fields{"addr": addr}).Error("duplicate addr")
				continue
			}
			seen[ipStr] = struct{}{}
			ipList = append(ipList, ipStr)
			continue
		}

		resolved = true

		ips, err := utils.ResolveIP(host)
		if err != nil || len(ips) == 0 {
			log.WithFields(log.Fields{"addr": addr}).Error("cannot resolve")
			time.Sleep(time.Second)
			continue
		}

		for _, ip := range ips {
			if skipLoopback && ip.IsLoopback() {
				continue
			}
			ipStr := ip.String()
			if _, ok := seen[ipStr]; ok {
				log.WithFields(log.Fields{"addr": addr}).Error("duplicate addr")
				continue
			}
			seen[ipStr] = struct{}{}
			ipList = append(ipList, ipStr)
		}
	}

	return ipList, resolved
}

func resolveJoinTargets(addrStr string, defaultPort uint, skipLoopback bool) ([]string, bool) {
	var resolved bool

	addrList := strings.Split(addrStr, ",")
	targets := make([]string, 0)
	seen := make(map[string]struct{})

	for _, addr := range addrList {
		host, port := splitClusterJoinAddr(addr)
		if host == "" {
			continue
		}
		if port == "" && defaultPort != 0 {
			port = fmt.Sprintf("%d", defaultPort)
		}

		appendTarget := func(ip net.IP) {
			if skipLoopback && ip.IsLoopback() {
				return
			}
			ipStr := ip.String()
			target := ipStr
			if port != "" {
				target = net.JoinHostPort(ipStr, port)
			}
			if _, ok := seen[target]; ok {
				log.WithFields(log.Fields{"addr": addr}).Error("duplicate addr")
				return
			}
			seen[target] = struct{}{}
			targets = append(targets, target)
		}

		if ip := net.ParseIP(host); ip != nil {
			appendTarget(ip)
			continue
		}

		resolved = true

		ips, err := utils.ResolveIP(host)
		if err != nil || len(ips) == 0 {
			log.WithFields(log.Fields{"addr": addr}).Error("cannot resolve")
			time.Sleep(time.Second)
			continue
		}

		for _, ip := range ips {
			appendTarget(ip)
		}
	}

	return targets, resolved
}

// cluster operations

const startWaitTime time.Duration = time.Second * 10
const initialLeadCheckDelay time.Duration = time.Second * 20
const leadCheckInterval time.Duration = time.Second * 20
const retryLimitJoin = 3
const retryLimitRestart = 3

func shouldRetryJoin(cc *ClusterConfig, lead string, serverAlive bool, serverAliveErr error) bool {
	if cc == nil || cc.Server {
		return lead == ""
	}

	if lead != "" && serverAliveErr == nil && serverAlive {
		return false
	}

	if lead == "" && serverAliveErr == nil && serverAlive {
		return false
	}

	return serverAliveErr != nil || !serverAlive
}

func buildJoinTargetsFromAddrs(addrs []string, defaultPort uint) []string {
	targets := make([]string, 0, len(addrs))
	seen := make(map[string]struct{}, len(addrs))

	for _, addr := range addrs {
		addr = strings.TrimSpace(addr)
		if addr == "" {
			continue
		}

		target := addr
		if defaultPort != 0 {
			target = net.JoinHostPort(addr, fmt.Sprintf("%d", defaultPort))
		}

		if _, ok := seen[target]; ok {
			continue
		}
		seen[target] = struct{}{}
		targets = append(targets, target)
	}

	return targets
}

func joinDefaultPort(cc *ClusterConfig) uint {
	if cc != nil && !cc.Server {
		return defaultLANPort
	}
	return 0
}

func refreshJoinTargets(cc *ClusterConfig) bool {
	if cc == nil {
		return false
	}

	defaultPort := joinDefaultPort(cc)
	addrs, _ := resolveJoinAddrs(cc.JoinAddr, true)
	targets, _ := resolveJoinTargets(cc.JoinAddr, defaultPort, true)
	if len(addrs) > 0 && len(targets) > 0 {
		cc.joinAddrList = addrs
		cc.joinTargetList = targets
		return true
	}

	if len(cc.joinTargetList) == 0 && len(cc.joinAddrList) > 0 {
		cc.joinTargetList = buildJoinTargetsFromAddrs(cc.joinAddrList, defaultPort)
	}

	if len(cc.joinAddrList) > 0 && len(cc.joinTargetList) > 0 {
		log.WithFields(log.Fields{
			"join":    cc.JoinAddr,
			"addrs":   cc.joinAddrList,
			"targets": cc.joinTargetList,
		}).Warn("Falling back to cached join targets")
		return true
	}

	return false
}

func StartCluster(cc *ClusterConfig) (string, error) {
	log.Debug("")

	if cc == nil {
		lead := waitClusterReady(time.Second*2, 60)
		if lead == "" {
			return "", errors.New("Failed to locate leader")
		}
		return lead, nil
	}

	clusterCfg = *cc

	// Register before start the cluster
	driver.RegisterExistingWatchers()

	errCh := make(chan error)
	go driver.Start(cc, errCh, false)

	select {
	case err := <-errCh:
		log.WithFields(log.Fields{"error": err}).Error("Failed to start cluster")
		return "", err
	case <-time.After(startWaitTime):
	}

	var lead string

	if !cc.Server {
		lead = waitClusterReady(time.Second*2, 60)
		if lead == "" {
			return "", errors.New("Failed to locate leader")
		}
	} else {
		lead = waitClusterReady(time.Second*2, 60)

		// Set ready flag so the controller IP can participate selection after restart
		_ = utils.SetReady("ctrl init done")

		if lead == "" {
			return "", errors.New("Failed to elect leader")
		}
	}

	log.WithFields(log.Fields{"lead": lead}).Info()

	// Monitor cluster lead
	var noLeadChan = make(chan interface{}, 1)
	RegisterLeadChangeWatcher(func(newLead, oldLead string) {
		log.WithFields(log.Fields{"newLead": newLead, "oldLead": oldLead}).Info()
		if newLead == "" {
			noLeadChan <- true
		}
	}, lead)

	go func() {
		errorRestart = true
		retryCluster := 0
		retryLimit := retryLimitJoin
		initialLeadCheck := time.NewTimer(initialLeadCheckDelay)
		defer initialLeadCheck.Stop()
		periodicLeadCheck := time.NewTicker(leadCheckInterval)
		defer periodicLeadCheck.Stop()

		for {
			select {
			case err := <-errCh:
				if errorRestart {
					log.WithFields(log.Fields{"error": err}).Error("Cluster stopped - will restart")

					for !refreshJoinTargets(cc) {
						time.Sleep(time.Second * 5)
					}

					time.Sleep(time.Second * 2)
					go driver.Start(cc, errCh, true)
					retryCluster = 0
					retryLimit = retryLimitRestart
				}
				continue
			case <-noLeadChan:
				log.Info("Lead loss detected")
				retryCluster = 0
				retryLimit = retryLimitJoin
			case <-initialLeadCheck.C:
				log.Info("Initial lead check timer expired")
			case <-periodicLeadCheck.C:
				log.Debug("Periodic lead check timer expired")
			}

			lead, leadErr := driver.GetLead()
			if leadErr != nil {
				log.WithFields(log.Fields{"error": leadErr}).Debug("Failed to query cluster lead")
			}

			serverAlive := false
			var serverAliveErr error
			if !cc.Server {
				serverAlive, serverAliveErr = driver.ServerAlive()
				if serverAliveErr != nil {
					log.WithFields(log.Fields{"error": serverAliveErr}).Debug("Failed to query cluster server state")
				}
			}

			if !shouldRetryJoin(cc, lead, serverAlive, serverAliveErr) {
				if lead != "" {
					log.WithFields(log.Fields{"lead": lead, "serverAlive": serverAlive}).Debug("Lead elected")
				} else {
					log.Info("Server is reachable, waiting for leader election")
				}
				retryCluster = 0
			} else {
				log.WithFields(log.Fields{"join": cc.JoinAddr}).Info("Cannot locate lead")

				for !refreshJoinTargets(cc) {
					time.Sleep(time.Second * 5)
				}

				if retryCluster < retryLimit {
					log.WithFields(log.Fields{"JoinAddr": cc.joinTargetList}).Info("Retry join")
					if err := driver.Join(cc); err != nil {
						log.WithFields(log.Fields{"error": err}).Error("Join")
					}
					retryCluster++
				} else {
					log.WithFields(log.Fields{"JoinAddr": cc.JoinAddr}).Info("Leave cluster")
					// errCh will trigger restart
					if err := driver.Leave(cc.Server); err != nil {
						log.WithFields(log.Fields{"error": err}).Error("Leave")
					}
				}
			}
		}
	}()

	return lead, nil
}

func LeaveCluster(server bool) {
	log.Debugf("")

	errorRestart = false

	driver.StopAllWatchers()

	if err := driver.Leave(server); err != nil {
		log.WithFields(log.Fields{"error": err}).Error("Error when leaving cluster")
	}

	clusterCfg.JoinAddr = ""
	clusterCfg.BindAddr = ""
	clusterCfg.AdvertiseAddr = ""
}

// -- watch

type NodeWatcher func(ClusterNotifyType, string, string)
type KeyWatcher func(ClusterNotifyType, string, []byte, uint64)
type StoreWatcher func(ClusterNotifyType, string, []byte, uint64)
type StateWatcher func(ClusterNotifyType, string, string)

func RegisterWatcherMonitor(failFunc func() bool, recoverFunc func()) {
	log.Debug("")
	driver.RegisterWatcherMonitor(failFunc, recoverFunc)
}

func RegisterNodeWatcher(f NodeWatcher) {
	log.Debug("")
	driver.RegisterNodeWatcher(f)
}

func RegisterKeyWatcher(key string, f KeyWatcher) {
	log.WithFields(log.Fields{"key": key}).Debug("")
	driver.RegisterKeyWatcher(key, f)
}

func RegisterStateWatcher(f StateWatcher) {
	log.Debug("")
	driver.RegisterStateWatcher(f)
}

func RegisterStoreWatcher(store string, f StoreWatcher, bCongestCtl bool) {
	log.WithFields(log.Fields{"store": store}).Debug("")
	driver.RegisterStoreWatcher(store, f, bCongestCtl)
}

func PauseAllWatchers(includeMonitorWatch bool) {
	log.Debug("")
	driver.PauseAllWatchers(includeMonitorWatch)
}

func ResumeAllWatchers() {
	log.Debug("")
	driver.ResumeAllWatchers()
}

func PauseWatcher(key string) {
	log.WithFields(log.Fields{"key": key}).Debug("")
	driver.PauseWatcher(key)
}

func ResumeWatcher(key string) {
	log.WithFields(log.Fields{"key": key}).Debug("")
	driver.ResumeWatcher(key)
}

func SetWatcherCongestionCtl(key string, enabled bool) {
	log.WithFields(log.Fields{"key": key, "enabled": enabled}).Debug("")
	driver.SetWatcherCongestionCtl(key, enabled)
}

func ForceLeave(node string, server bool) {
	log.WithFields(log.Fields{"node": node}).Debug("")
	if err := driver.ForceLeave(node, server); err != nil {
		log.WithFields(log.Fields{"err": err}).Debug("")
	}
}

func GetClusterLead() string {
	lead, _ := driver.GetLead()
	if lead != "" {
		idx := strings.Index(lead, ":")
		return lead[:idx]
	}
	return ""
}

func GetAllMembers() []ClusterMemberInfo {
	return driver.GetAllMembers()
}

func waitClusterReady(t time.Duration, maxRetry int) string {
	var lead string
	retry := 0

Wait:
	for {
		lead, _ = driver.GetLead()
		if lead == "" {
			time.Sleep(t)
			retry++
		} else {
			self := driver.GetSelfAddress()
			members := driver.GetAllMembers()
			for _, m := range members {
				if self == m.Name {
					break Wait
				}
			}
			time.Sleep(t)
			retry++
		}
		if maxRetry != 0 && retry > maxRetry {
			return ""
		}
	}

	log.WithFields(log.Fields{"lead": lead}).Debug("cluster ready")
	idx := strings.Index(lead, ":")
	return lead[:idx]
}

type LeadChangeCallback func(string, string)

func RegisterLeadChangeWatcher(fn LeadChangeCallback, lead string) {
	var leaveChan = make(chan string, 1)

	RegisterNodeWatcher(func(nType ClusterNotifyType, memberAddr string, member string) {
		if nType != ClusterNotifyDelete {
			return
		}

		if role, ok := GetConsulNodeRole(member); ok && role != NodeRoleServer {
			return
		}

		leaveChan <- GetConsulNodeAddress(member)
	})

	go func() {

		leadMonitorTicker := time.Tick(time.Second * 5)
		for {
			select {
			case <-leadMonitorTicker:
			case leaveNode := <-leaveChan:
				if lead != "" && leaveNode != lead {
					continue
				}
			}

			newLead := GetClusterLead()
			if newLead != lead {
				fn(newLead, lead)
				lead = newLead
			}
		}
	}()
}

// --

var ErrKeyNotFound error = errors.New("Key not found")
var ErrEmptyStore error = errors.New("Empty store")

var KVValueSizeMax = 512 * 1024

type LockInterface interface {
	Lock(stopCh <-chan struct{}) (<-chan struct{}, error)
	Unlock() error
	Key() string
}

// Session is a mechanism to implement short-lived keys. When the session is created, a TTL value is given.
// Keys are "associated" with the session will be deleted when the session expires.
type SessionInterface interface {
	Associate(key string) error
	Disassociate(key string) error
}

type ClusterDriver interface {
	Start(cc *ClusterConfig, eCh chan error, recover bool)
	Join(cc *ClusterConfig) error
	Leave(server bool) error
	ForceLeave(node string, server bool) error
	Reload(cc *ClusterConfig) error

	GetSelfAddress() string
	GetLead() (string, error)
	ServerAlive() (bool, error)
	GetAllMembers() []ClusterMemberInfo

	NewLock(key string, wait time.Duration) (LockInterface, error)
	NewSession(name string, ttl time.Duration) (SessionInterface, error)

	// KV
	Exist(key string) bool
	GetKeys(prefix, separater string) ([]string, error)
	Get(key string) ([]byte, error)
	GetRev(key string) ([]byte, uint64, error)
	GetStoreKeys(store string) ([]string, error)
	Put(key string, value []byte) error
	PutRev(key string, value []byte, rev uint64) error
	PutIfNotExist(key string, value []byte) error
	Delete(key string) error
	List(keyPrefix string) (consulapi.KVPairs, error)
	DeleteTree(keyPrefix string) error
	Transact([]transactEntry) (bool, error)

	// Watcher
	RegisterKeyWatcher(key string, watcher KeyWatcher)
	RegisterStoreWatcher(store string, watcher StoreWatcher, bCongestCtl bool)
	RegisterStateWatcher(watcher StateWatcher)
	RegisterNodeWatcher(watcher NodeWatcher)
	RegisterWatcherMonitor(failFunc func() bool, recoverFunc func())
	RegisterExistingWatchers()

	StopAllWatchers()
	PauseAllWatchers(includeMonitorWatch bool)
	ResumeAllWatchers()
	PauseWatcher(key string)
	ResumeWatcher(key string)
	SetWatcherCongestionCtl(key string, enabled bool)
}

var driver ClusterDriver = &consul

func NewLock(key string, wait time.Duration) (LockInterface, error) {
	return driver.NewLock(key, wait)
}

func NewSession(name string, ttl time.Duration) (SessionInterface, error) {
	return driver.NewSession(name, ttl)
}

func Exist(key string) bool {
	return driver.Exist(key)
}

func GetKeys(prefix, separater string) ([]string, error) {
	return driver.GetKeys(prefix, separater)
}

func Get(key string) ([]byte, error) {
	// log.WithFields(log.Fields{"key": key}).Debug("")
	return driver.Get(key)
}

func GetRev(key string) ([]byte, uint64, error) {
	// log.WithFields(log.Fields{"key": key}).Debug("")
	return driver.GetRev(key)
}

func GetStoreKeys(store string) ([]string, error) {
	// log.WithFields(log.Fields{"store": store}).Debug("")
	return driver.GetStoreKeys(store)
}

func put(key string, value []byte) error {
	return driver.Put(key, value)
}

func putBinary(key string, value []byte) error {
	// Logging should be done at the caller code
	err := put(key, value)
	if err != nil {
		for i := 0; i < putRetryTimes; i++ {
			time.Sleep(putRetryInterval)
			log.WithFields(log.Fields{"retry": i}).Debug(err)
			err = put(key, value)
			if err == nil {
				break
			}
		}
	}
	if err != nil {
		log.WithFields(log.Fields{"key": key, "error": err}).Error("Failed to put key")
	}
	return err
}

func putRev(key string, value []byte, rev uint64) error {
	err := driver.PutRev(key, value, rev)
	if err != nil && err != ErrPutCAS {
		for i := 0; i < putRetryTimes; i++ {
			time.Sleep(putRetryInterval)
			log.WithFields(log.Fields{"retry": i}).Debug(err)
			err = driver.PutRev(key, value, rev)
			if err == nil || err == ErrPutCAS {
				break
			}
		}
	}
	if err != nil {
		log.WithFields(log.Fields{"key": key, "error": err}).Error("Failed to put key")
	}
	return err
}

func PutQuiet(key string, value []byte) error {
	var err error
	if len(value) >= KVValueSizeMax {
		// [20220712] for consul limitation
		// future: consider auto-gzip text data if text size >= 512k (kv watcher handler needs to take care auto-unzip)
		err = errSizeTooBig
		log.WithFields(log.Fields{"key": key, "size": len(value)}).Error(err)
	} else {
		err = putBinary(key, value)
	}
	return err
}

func PutBinary(key string, value []byte) error {
	var err error
	if len(value) >= KVValueSizeMax {
		// we assume binary data is already in gzip format so do not try to gzip it again
		err = errSizeTooBig
		log.WithFields(log.Fields{"key": key, "size": len(value)}).Error(err)
	} else {
		log.WithFields(log.Fields{"key": key}).Debug()
		err = putBinary(key, value)
	}
	return err
}

func PutBinaryRev(key string, value []byte, rev uint64) error {
	var err error
	if len(value) >= KVValueSizeMax {
		// we assume binary data is already in gzip format so do not try to gzip it again
		err = errSizeTooBig
		log.WithFields(log.Fields{"key": key, "size": len(value)}).Error(err)
	} else {
		log.WithFields(log.Fields{"key": key}).Debug()
		err = putRev(key, value, rev)
	}
	return err
}

func PutQuietRev(key string, value []byte, rev uint64) error {
	var err error
	if len(value) >= KVValueSizeMax {
		// [20220712] for consul limitation
		// future: consider auto-gzip text data if text size >= 512k (kv watcher handler needs to take care auto-unzip)
		err = errSizeTooBig
		log.WithFields(log.Fields{"key": key, "size": len(value)}).Error(err)
	} else {
		err = putRev(key, value, rev)
	}
	return err
}

func Put(key string, value []byte) error {
	var err error
	if len(value) >= KVValueSizeMax {
		// [20220712] for consul limitation
		// future: consider auto-gzip text data if text size >= 512k (kv watcher handler needs to take care auto-unzip)
		err = errSizeTooBig
		log.WithFields(log.Fields{"key": key, "size": len(value)}).Error(err)
	} else {
		log.WithFields(log.Fields{"key": key, "value": string(value)}).Debug()
		err = putBinary(key, value)
	}
	return err
}

func PutRev(key string, value []byte, rev uint64) error {
	var err error
	if len(value) >= KVValueSizeMax {
		// [20220712] for consul limitation
		// future: consider auto-gzip text data if text size >= 512k (kv watcher handler needs to take care auto-unzip)
		err = errSizeTooBig
		log.WithFields(log.Fields{"key": key, "size": len(value)}).Error(err)
	} else {
		log.WithFields(log.Fields{"key": key, "value": string(value), "rev": rev}).Debug()
		err = putRev(key, value, rev)
	}
	return err
}

// The difference between putRev(k, v, 0) and PutIfNotExist(k, v) is the later return nil error
// when the key exists
func PutIfNotExist(key string, value []byte, logKeyOnly bool) error {
	var err error
	if len(value) >= KVValueSizeMax {
		// [20220712] for consul limitation
		// future: consider auto-gzip text data if text size >= 512k (kv watcher handler needs to take care auto-unzip)
		err = errSizeTooBig
		log.WithFields(log.Fields{"key": key, "size": len(value)}).Error(err)
	} else {
		if logKeyOnly {
			log.WithFields(log.Fields{"key": key}).Debug("")
		} else {
			log.WithFields(log.Fields{"key": key, "value": string(value)}).Debug("")
		}

		err = driver.PutIfNotExist(key, value)
		if err != nil && err != ErrPutCAS {
			for i := 0; i < putRetryTimes; i++ {
				time.Sleep(putRetryInterval)
				log.WithFields(log.Fields{"retry": i}).Debug(err)
				err = driver.PutIfNotExist(key, value)
				if err == nil || err == ErrPutCAS {
					break
				}
			}
		}
		if err == ErrPutCAS {
			// no error but key is already existed, ignore the update.
			// Suppress log.
			// log.WithFields(log.Fields{"key": key}).Debug("Put key CAS error")
			err = nil
		} else if err != nil {
			log.WithFields(log.Fields{"key": key, "error": err}).Error("Failed to put key")
		}
	}
	return err
}

func Delete(key string) error {
	log.WithFields(log.Fields{"key": key}).Debug("")

	err := driver.Delete(key)
	if err != nil {
		for i := 0; i < putRetryTimes; i++ {
			time.Sleep(putRetryInterval)
			log.WithFields(log.Fields{"retry": i}).Debug(err)
			err = driver.Delete(key)
			if err == nil {
				break
			}
		}
	}
	if err != nil {
		log.WithFields(log.Fields{"key": key, "error": err}).Error("Failed to delete key")
	}
	return err
}

func List(keyPrefix string) (consulapi.KVPairs, error) {
	log.WithFields(log.Fields{"key": keyPrefix}).Debug("")

	return driver.List(keyPrefix)
}

func DeleteTree(keyPrefix string) error {
	log.WithFields(log.Fields{"keyPrefix": keyPrefix}).Debug("")

	err := driver.DeleteTree(keyPrefix)
	if err != nil {
		for i := 0; i < putRetryTimes; i++ {
			time.Sleep(putRetryInterval)
			log.WithFields(log.Fields{"retry": i}).Debug(err)
			err = driver.DeleteTree(keyPrefix)
			if err == nil {
				break
			}
		}
	}
	if err != nil {
		log.WithFields(log.Fields{"keyPrefix": keyPrefix, "error": err}).Error("Failed to delete kv tree")
	}
	return err
}

// -- Transaction

const (
	clusterTransactPut clusterTransactVerb = iota
	clusterTransactPutRev
	clusterTransactDelete
	clusterTransactDeleteRev
	clusterTransactCheckRev
	clusterTransactDeleteTree
)

type clusterTransactVerb int

type transactEntry struct {
	verb  clusterTransactVerb
	key   string
	value []byte
	rev   uint64
}

type ClusterTransact struct {
	entries []transactEntry
}

func Transact() *ClusterTransact {
	return &ClusterTransact{}
}

func (t *ClusterTransact) PutBinary(key string, value []byte) {
	if len(value) >= KVValueSizeMax {
		// we assume binary data is already in gzip format so do not try to gzip it again
		log.WithFields(log.Fields{"key": key, "len": len(value)}).Error(errSizeTooBig)
	} else {
		log.WithFields(log.Fields{"key": key}).Debug("Transact")

		t.entries = append(t.entries, transactEntry{
			verb: clusterTransactPut, key: key, value: value,
		})
	}
}

func (t *ClusterTransact) Put(key string, value []byte) {
	if len(value) >= KVValueSizeMax {
		// [20220712] for consul limitation
		// future: consider auto-gzip text data if text size >= 512k (kv watcher handler needs to take care auto-unzip)
		log.WithFields(log.Fields{"key": key, "len": len(value)}).Error(errSizeTooBig)
	} else {
		log.WithFields(log.Fields{"key": key, "value": string(value)}).Debug("Transact")

		t.entries = append(t.entries, transactEntry{
			verb: clusterTransactPut, key: key, value: value,
		})
	}
}

func (t *ClusterTransact) PutQuiet(key string, value []byte) {
	if len(value) >= KVValueSizeMax {
		// [20220712] for consul limitation
		// future: consider auto-gzip text data if text size >= 512k (kv watcher handler needs to take care auto-unzip)
		log.WithFields(log.Fields{"key": key, "len": len(value)}).Error(errSizeTooBig)
	} else {
		log.WithFields(log.Fields{"key": key}).Debug("Transact")

		t.entries = append(t.entries, transactEntry{
			verb: clusterTransactPut, key: key, value: value,
		})
	}
}

func (t *ClusterTransact) PutRev(key string, value []byte, rev uint64) {
	if len(value) >= KVValueSizeMax {
		// [20220712] for consul limitation
		// future: consider auto-gzip text data if text size >= 512k (kv watcher handler needs to take care auto-unzip)
		log.WithFields(log.Fields{"key": key, "len": len(value)}).Error(errSizeTooBig)
	} else {
		log.WithFields(log.Fields{"key": key, "value": string(value), "rev": rev}).Debug("Transact")

		t.entries = append(t.entries, transactEntry{
			verb: clusterTransactPutRev, key: key, value: value, rev: rev,
		})
	}
}

func (t *ClusterTransact) Delete(key string) {
	log.WithFields(log.Fields{"key": key}).Debug("Transact")

	t.entries = append(t.entries, transactEntry{
		verb: clusterTransactDelete, key: key,
	})
}

func (t *ClusterTransact) DeleteTree(key string) {
	log.WithFields(log.Fields{"key": key}).Debug("Transact")

	t.entries = append(t.entries, transactEntry{
		verb: clusterTransactDeleteTree, key: key,
	})
}

func (t *ClusterTransact) DeleteRev(key string, rev uint64) {
	log.WithFields(log.Fields{"key": key, "rev": rev}).Debug("Transact")

	t.entries = append(t.entries, transactEntry{
		verb: clusterTransactDeleteRev, key: key, rev: rev,
	})
}

func (t *ClusterTransact) CheckRev(key string, rev uint64) {
	log.WithFields(log.Fields{"key": key, "rev": rev}).Debug("Transact")

	t.entries = append(t.entries, transactEntry{
		verb: clusterTransactCheckRev, key: key, rev: rev,
	})
}

func apply(entries []transactEntry) (bool, error) {
	ok, err := driver.Transact(entries)
	if err != nil {
		for i := 0; i < putRetryTimes*2; i++ {
			time.Sleep(putRetryInterval)
			log.WithFields(log.Fields{"retry": i}).Debug(err)
			ok, err = driver.Transact(entries)
			if err == nil {
				return ok, nil
			}
		}
	}
	return ok, err
}

// caller of this function must make sure 'entries' meets these 2 conditions:
// 1. their estimated transaction request body length < 512*1024
// 2. there are <= 64 entries
func applyImpl(entries []transactEntry) (bool, error) {

	if len(entries) == 0 {
		return true, nil
	}

	if _, err := apply(entries); err != nil {
		// There is no better way to handle one transaction error
		// So we simply iterate the entries in this transaction and re-do them like the non-transaction approach.
		// However, by using transaction, we reduce the driver calls so theoretically we shuld see less error.
		var errFinal error
		for _, entry := range entries {
			switch entry.verb {
			case clusterTransactDelete:
				if err := Delete(entry.key); err != nil {
					log.WithFields(log.Fields{"key": entry.key, "error": err}).Error("delete")
					errFinal = err
				}
			case clusterTransactPut:
				if err := Put(entry.key, entry.value); err != nil {
					log.WithFields(log.Fields{"key": entry.key, "error": err}).Error("put")
					errFinal = err
				}
			case clusterTransactDeleteTree:
				if err := DeleteTree(entry.key); err != nil {
					log.WithFields(log.Fields{"key": entry.key, "error": err}).Error("delete tree")
					errFinal = err
				}
			}
		}
		if errFinal != nil {
			return false, err
		}
	}

	return true, nil
}

// consul kv transaction request body is limited by
// 1. 512*1024 bytes length max &
// 2. 64 entries max
func (t *ClusterTransact) Apply() (bool, error) {
	log.Debug("Transact")

	if len(t.entries) == 0 {
		return true, nil
	}

	const maxSize int = (512 * 1024) - 2
	var ok bool
	var err error
	var startIdx int              // inclusive
	var collectedSizeEstimate int // size estimate of collected entries
	var numCollected int          // number of collected entries

	for i := range t.entries {
		// estimated size of this entry object in transaction req body
		entrySizeEstimate := 160 + len(t.entries[i].key) + ((2 + len(t.entries[i].value)) * 4 / 3)
		// check whether including this entry in the transaction req will make the request body size too big or too many entries.
		if numCollected >= 64 || ((collectedSizeEstimate + entrySizeEstimate) > maxSize) {
			// this entry will make the transaction req failed because of size too big or too many entries.
			// so send those already collected entries in a transaction req first & let this entry be in the next transaction req.
			entries := t.entries[startIdx:i] // this entry is not included
			ok, err = applyImpl(entries)
			if err != nil {
				log.WithFields(log.Fields{"startIdx": startIdx, "entries": len(entries), "sizeEstimate": collectedSizeEstimate,
					"error": err}).Error("Failed to write txn keys")
				return ok, err
			}

			// let this entry be the 1st entry in the next transaction req.
			numCollected = 1
			collectedSizeEstimate = entrySizeEstimate
			startIdx = i
		} else {
			numCollected++
			collectedSizeEstimate += entrySizeEstimate
		}
	}
	if numCollected > 0 {
		// for the last entries that are not applied yet
		entries := t.entries[startIdx:]
		ok, err = applyImpl(entries)
		if err != nil {
			log.WithFields(log.Fields{"startIdx": startIdx, "entries": len(entries), "sizeEstimate": collectedSizeEstimate,
				"error": err}).Error("Failed to write txn keys")
		}
	}

	return ok, err
}

func (t *ClusterTransact) HasData() bool {
	return len(t.entries) > 0
}

func (t *ClusterTransact) Reset() {
	t.entries = nil
}

func (t *ClusterTransact) Close() {
	t.entries = nil
}

func (t *ClusterTransact) Size() int {
	return len(t.entries)
}

// --

func GetSelfAddress() string {
	return driver.GetSelfAddress()
}

func getFirstResolvableAddr(addrStr string) net.IP {
	list := strings.Split(addrStr, ",")
	for _, a := range list {
		host, _ := splitClusterJoinAddr(a)
		if ips, err := utils.ResolveIP(host); err == nil {
			for _, ip := range ips {
				if !ip.IsLoopback() {
					return ip
				}
			}
		}
	}
	return nil
}

func isBindGlobalScope(name string, ip net.IP, ifaces map[string][]share.CLUSIPAddr) bool {
	if addrs, ok := ifaces[name]; !ok {
		return false
	} else {
		for _, addr := range addrs {
			if addr.IPNet.IP.Equal(ip) {
				return addr.Scope == share.CLUSIPAddrScopeGlobal
			}
		}
		return false
	}
}

func ResolveJoinAndBindAddr(joinAddr string, sys *system.SystemTools) (string, string, error) {
	var retry uint = 0

	joinIP := getFirstResolvableAddr(joinAddr)
	for joinIP == nil {
		if retry < 5 {
			time.Sleep(time.Second * (1 << retry))
		} else {
			time.Sleep(time.Second * 30)
		}
		retry++
		log.WithFields(log.Fields{"join": joinAddr, "retry": retry}).Info("resolve")
		joinIP = getFirstResolvableAddr(joinAddr)
	}

	_, bindIPNet := sys.GetBindAddr(joinIP)
	if bindIPNet == nil {
		return joinIP.String(), "", errors.New("Failed to get bind addresses")
	}

	return joinIP.String(), bindIPNet.IP.String(), nil
}

func FillClusterAddrs(cfg *ClusterConfig, sys *system.SystemTools) error {
	log.WithFields(log.Fields{"join": cfg.JoinAddr, "advertise": cfg.AdvertiseAddr}).Info()

	if cfg.JoinAddr != "" {
		var retry uint = 0

		joinIP := getFirstResolvableAddr(cfg.JoinAddr)
		for joinIP == nil {
			if retry < 5 {
				// Set readiness if dns resolve fails, it's more likely this is the first server, make self available
				// for lead election; if dns is resolved, other servers are already running - it's possible it's
				// in the rolling upgrade process, don't make self ready until lead is found.
				if retry == 1 && cfg.Server {
					_ = utils.SetReady("cluster init")
				}
				time.Sleep(time.Second * (1 << retry))
			} else {
				time.Sleep(time.Second * 30)
			}
			retry++
			log.WithFields(log.Fields{"join": cfg.JoinAddr, "retry": retry}).Info("resolve")
			joinIP = getFirstResolvableAddr(cfg.JoinAddr)
		}

		// If dns is resolved in first try, it's more likely to be a new controller, give it more time for the
		// existing server to become leader.

		// Always get bind IP
		iface, bindIPNet := sys.GetBindAddr(joinIP)
		if bindIPNet == nil {
			return errors.New("Failed to get bind addresses")
		}

		if cfg.BindAddr == "" {
			cfg.BindAddr = bindIPNet.IP.String()
		}

		// Get adv. IP if not empty
		var advIP net.IP
		if cfg.AdvertiseAddr == "" {
			ones, _ := bindIPNet.Mask.Size()
			if ones == 0 {
				// joinAddr is a local port. This is must be a bootstrap server, either running
				// in host mode or overlay networking mode. This is allow user to use JOIN_ADDR,
				// instead of ADV_ADDR, for bootstrap server
				advIP = bindIPNet.IP
			} else if bindIPNet.Contains(joinIP) {
				// joinIP and bindIP are in the same subnet, this is client or non-first server,
				// running either in host mode or overlay networking mode.
				advIP = bindIPNet.IP
			} else if isBindGlobalScope(iface, bindIPNet.IP, cfg.Ifaces) {
				advIP = bindIPNet.IP
			} else {
				if adv := sys.GetAdvertiseAddr(joinIP); adv == nil {
					return errors.New("Failed to get advertise addresses")
				} else {
					advIP = adv
				}
			}

			cfg.AdvertiseAddr = advIP.String()
		}

		for !refreshJoinTargets(cfg) {
			time.Sleep(time.Second * 5)
		}

		log.WithFields(log.Fields{"bind": cfg.BindAddr, "advertise": cfg.AdvertiseAddr}).Debug()
		return nil
	} else {
		// If Bootstrap is set without JoinAddr, assume this is the first server node
		if cfg.AdvertiseAddr != "" {
			// Address specified, other nodes should join with addresses too.
			if cfg.BindAddr == "" {
				_, bindIPNet := sys.GetBindAddr(net.ParseIP(cfg.AdvertiseAddr))
				if bindIPNet != nil {
					cfg.BindAddr = bindIPNet.IP.String()
					log.WithFields(log.Fields{"bind": cfg.BindAddr}).Debug()
					return nil
				} else {
					return errors.New("Failed to get cluster bind addresses")
				}
			}
			// When JoinAddr is not set, we assume it is the first server node, and set
			// its JoinAddr to be the same with AdvertiseAddr
			cfg.JoinAddr = cfg.AdvertiseAddr
			cfg.joinAddrList = []string{cfg.AdvertiseAddr}
			cfg.joinTargetList = []string{cfg.AdvertiseAddr}
			return nil
		} else {
			// Not NAT. Locate a unique phyical port to bind
			if cfg.BindAddr == "" {
				ifaces := sys.GetGlobalAddrs(true)
				// Pick the first address to bind
				for _, ipnets := range ifaces {
					if len(ipnets) > 0 {
						cfg.BindAddr = ipnets[0].IP.String()
						cfg.JoinAddr = cfg.BindAddr
						cfg.joinAddrList = []string{cfg.BindAddr}
						cfg.joinTargetList = []string{cfg.BindAddr}
						cfg.AdvertiseAddr = cfg.BindAddr
						log.WithFields(log.Fields{"bind": cfg.BindAddr}).Debug()
						return nil
					}
				}
				log.Error("No address to bind")
				return errors.New("No address to bind")
			}

			cfg.JoinAddr = cfg.BindAddr
			cfg.joinAddrList = []string{cfg.BindAddr}
			cfg.joinTargetList = []string{cfg.BindAddr}
			cfg.AdvertiseAddr = cfg.BindAddr
			return nil
		}
		/*
			} else {
				log.Error("Node should either bootstrap a cluster or join a cluster")
				return errors.New("Node should either bootstrap a cluster or join a cluster")
		*/
	}
}

func Reload(cc *ClusterConfig) error {
	config := cc
	if cc == nil {
		config = &clusterCfg
	}
	return driver.Reload(config)
}

var curLogLevel log.Level = log.InfoLevel

func SetLogLevel(level log.Level) {
	if level == curLogLevel {
		return
	}

	switch level {
	case log.ErrorLevel:
	case log.WarnLevel:
	case log.InfoLevel:
		clusterCfg.Debug = false
	case log.DebugLevel:
		clusterCfg.Debug = true
	default:
		log.WithFields(log.Fields{"level": level}).Error("Not supported")
		return
	}
	// Disable toggling consul debug level
	curLogLevel = level

	/*
		if err := driver.Reload(&clusterCfg); err == nil {
			curLogLevel = level
		}
	*/
}
