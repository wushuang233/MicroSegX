package cluster

import (
	"encoding/json"
	"testing"
)

func TestParseKnownServersFromString(t *testing.T) {
	got, err := parseKnownServers("1")
	if err != nil {
		t.Fatalf("parseKnownServers() error = %v", err)
	}
	if got != 1 {
		t.Fatalf("parseKnownServers() = %d, want 1", got)
	}
}

func TestParseKnownServersFromNumber(t *testing.T) {
	got, err := parseKnownServers(float64(2))
	if err != nil {
		t.Fatalf("parseKnownServers() error = %v", err)
	}
	if got != 2 {
		t.Fatalf("parseKnownServers() = %d, want 2", got)
	}
}

func TestParseKnownServersFromJSONNumber(t *testing.T) {
	got, err := parseKnownServers(json.Number("3"))
	if err != nil {
		t.Fatalf("parseKnownServers() error = %v", err)
	}
	if got != 3 {
		t.Fatalf("parseKnownServers() = %d, want 3", got)
	}
}

func TestParseKnownServersRejectsUnexpectedType(t *testing.T) {
	if _, err := parseKnownServers(true); err == nil {
		t.Fatal("expected parseKnownServers() to reject unsupported types")
	}
}
