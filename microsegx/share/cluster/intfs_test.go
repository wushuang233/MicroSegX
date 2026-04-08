package cluster

import (
	"reflect"
	"testing"
)

func TestResolveJoinAddrsStripsPort(t *testing.T) {
	addrs, _ := resolveJoinAddrs("192.168.198.128:18301", true)
	want := []string{"192.168.198.128"}
	if !reflect.DeepEqual(addrs, want) {
		t.Fatalf("resolveJoinAddrs() = %v, want %v", addrs, want)
	}
}

func TestResolveJoinTargetsKeepsExplicitPort(t *testing.T) {
	targets, _ := resolveJoinTargets("192.168.198.128:18301", defaultLANPort, true)
	want := []string{"192.168.198.128:18301"}
	if !reflect.DeepEqual(targets, want) {
		t.Fatalf("resolveJoinTargets() = %v, want %v", targets, want)
	}
}

func TestResolveJoinTargetsAddsDefaultPort(t *testing.T) {
	targets, _ := resolveJoinTargets("192.168.198.128", defaultLANPort, true)
	want := []string{"192.168.198.128:18301"}
	if !reflect.DeepEqual(targets, want) {
		t.Fatalf("resolveJoinTargets() = %v, want %v", targets, want)
	}
}

func TestIsBootstrapServerOnly(t *testing.T) {
	serverCfg := &ClusterConfig{
		Server:        true,
		AdvertiseAddr: "192.168.198.128",
		joinAddrList:  []string{"192.168.198.128"},
	}
	if !isBootstrap(serverCfg) {
		t.Fatal("expected server config to be bootstrap")
	}

	clientCfg := &ClusterConfig{
		Server:        false,
		AdvertiseAddr: "192.168.198.128",
		joinAddrList:  []string{"192.168.198.128"},
	}
	if isBootstrap(clientCfg) {
		t.Fatal("expected client config to not be bootstrap")
	}
}

func TestShouldRetryJoinWhenLeaderMissingAndNoServerAlive(t *testing.T) {
	cc := &ClusterConfig{Server: false}
	if !shouldRetryJoin(cc, "", false, nil) {
		t.Fatal("expected client to retry join when no leader and no server are available")
	}
}

func TestShouldNotRetryJoinWhenServerStillAlive(t *testing.T) {
	cc := &ClusterConfig{Server: false}
	if shouldRetryJoin(cc, "", true, nil) {
		t.Fatal("expected client to wait for leader election while server is still reachable")
	}
}

func TestShouldRetryJoinForServerWithoutLeader(t *testing.T) {
	cc := &ClusterConfig{Server: true}
	if !shouldRetryJoin(cc, "", true, nil) {
		t.Fatal("expected server node to retry join when no leader is available")
	}
}

func TestShouldNotRetryJoinWhenLeaderExists(t *testing.T) {
	cc := &ClusterConfig{Server: false}
	if shouldRetryJoin(cc, "192.168.198.128", true, nil) {
		t.Fatal("expected healthy cluster to skip retry join")
	}
}

func TestShouldRetryJoinWhenLeaderIsStale(t *testing.T) {
	cc := &ClusterConfig{Server: false}
	if !shouldRetryJoin(cc, "192.168.198.128", false, nil) {
		t.Fatal("expected client to retry join when leader is reported but no server is alive")
	}
}

func TestBuildJoinTargetsFromAddrsAddsDefaultPort(t *testing.T) {
	targets := buildJoinTargetsFromAddrs([]string{"192.168.198.128"}, defaultLANPort)
	want := []string{"192.168.198.128:18301"}
	if !reflect.DeepEqual(targets, want) {
		t.Fatalf("buildJoinTargetsFromAddrs() = %v, want %v", targets, want)
	}
}

func TestRefreshJoinTargetsFallsBackToCachedTargets(t *testing.T) {
	cc := &ClusterConfig{
		Server:         false,
		JoinAddr:       "",
		joinAddrList:   []string{"192.168.198.128"},
		joinTargetList: []string{"192.168.198.128:18301"},
	}

	if !refreshJoinTargets(cc) {
		t.Fatal("expected refreshJoinTargets() to fall back to cached targets")
	}

	wantTargets := []string{"192.168.198.128:18301"}
	if !reflect.DeepEqual(cc.joinTargetList, wantTargets) {
		t.Fatalf("refreshJoinTargets() joinTargetList = %v, want %v", cc.joinTargetList, wantTargets)
	}
}
