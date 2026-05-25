#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${AUTO_POLICY_API_BASE:-https://127.0.0.1:10443/v1}"
TOKEN="${AUTO_POLICY_TOKEN:-}"
INSECURE="${AUTO_POLICY_INSECURE:-1}"

curl_args=(-sS -H "Accept: application/json")
if [[ "${INSECURE}" == "1" ]]; then
	curl_args+=(-k)
fi
if [[ -n "${TOKEN}" ]]; then
	curl_args+=(-H "Authorization: Bearer ${TOKEN}")
fi

status_json="$(curl "${curl_args[@]}" "${BASE_URL}/policy/auto/status")"
rules_json="$(curl "${curl_args[@]}" "${BASE_URL}/policy/auto/rule")"

if command -v jq >/dev/null 2>&1; then
	echo "== Auto Policy Status =="
	jq '
		.status
		| {
			mode,
			window_seconds,
			slot_minutes,
			distinct_day_seconds,
			ttl_check_seconds,
			observed_event_count,
			feature_count,
			baseline_rule_count,
			periodic_rule_count,
			anomaly_rule_count,
			candidate_baseline,
			candidate_periodic,
			candidate_anomaly,
			last_window_processed_timestamp,
			last_window_event_count,
			promotion_count,
			delete_count
		}
	' <<<"${status_json}"

	echo
	echo "== Candidate Preview =="
	jq '
		.status.candidates // []
		| map({
			class,
			confidence,
			from,
			to,
			ip_proto,
			application,
			ports,
			fqdns,
			distinct_days,
			consecutive_windows,
			total_windows,
			reason_codes
		})
	' <<<"${status_json}"

	echo
	echo "== Auto Rules =="
	jq '
		.rules // []
		| map({
			id,
			class,
			active,
			confidence,
			expires_timestamp,
			periodic_slots,
			reason_codes,
			from: .rule.from,
			to: .rule.to,
			ports: .rule.ports,
			action: .rule.action,
			applications: .rule.applications
		})
	' <<<"${rules_json}"
else
	echo "== Auto Policy Status (raw) =="
	echo "${status_json}"
	echo
	echo "== Auto Rules (raw) =="
	echo "${rules_json}"
fi
