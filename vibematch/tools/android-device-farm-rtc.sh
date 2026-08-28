#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SESSION_RUNNER="$SCRIPT_DIR/android-e2e-session.sh"
RTC_HARNESS="$SCRIPT_DIR/android-rtc-logcat.sh"
MANUAL_WINDOW_SECONDS="${MANUAL_WINDOW_SECONDS:-180}"
RTC_ARTIFACT_DIR="${RTC_ARTIFACT_DIR:-artifacts/rtc}"
EXPECT_RTC_CONNECTED="${EXPECT_RTC_CONNECTED:-1}"
EXPECT_REMOTE_PARTICIPANT="${EXPECT_REMOTE_PARTICIPANT:-1}"

if [[ ! -x "$SESSION_RUNNER" || ! -x "$RTC_HARNESS" ]]; then
  echo "DEVICE_FARM_RTC=BLOCKED"
  echo "REASON=required_runner_missing_or_not_executable"
  exit 2
fi

flow_status=0
diagnostics_status=0
started=0

cleanup() {
  if [[ "$started" == "1" ]]; then
    set +e
    RTC_ARTIFACT_DIR="$RTC_ARTIFACT_DIR" \
      EXPECT_RTC_CONNECTED="$EXPECT_RTC_CONNECTED" \
      EXPECT_REMOTE_PARTICIPANT="$EXPECT_REMOTE_PARTICIPANT" \
      "$RTC_HARNESS" stop
    diagnostics_status=$?
    set -e
    started=0
  fi
}
trap cleanup EXIT INT TERM

RTC_ARTIFACT_DIR="$RTC_ARTIFACT_DIR" "$RTC_HARNESS" start
started=1

set +e
"$SESSION_RUNNER"
flow_status=$?
set -e

if [[ "$flow_status" -eq 0 ]]; then
  if [[ "${1:-}" == "--" ]]; then
    shift
  fi
  if (( $# > 0 )); then
    set +e
    "$@"
    flow_status=$?
    set -e
  else
    echo "DEVICE_FARM_RTC=WAITING_FOR_FLOW"
    echo "MANUAL_WINDOW_SECONDS=$MANUAL_WINDOW_SECONDS"
    sleep "$MANUAL_WINDOW_SECONDS"
  fi
fi

cleanup
trap - EXIT INT TERM

if [[ "$flow_status" -ne 0 ]]; then
  echo "DEVICE_FARM_RTC=FAIL"
  echo "REASON=flow_command_failed"
  echo "FLOW_EXIT_CODE=$flow_status"
  echo "RTC_DIAGNOSTICS_EXIT_CODE=$diagnostics_status"
  exit "$flow_status"
fi
if [[ "$diagnostics_status" -ne 0 ]]; then
  echo "DEVICE_FARM_RTC=FAIL"
  echo "REASON=rtc_diagnostics_failed"
  echo "RTC_DIAGNOSTICS_EXIT_CODE=$diagnostics_status"
  exit "$diagnostics_status"
fi

echo "DEVICE_FARM_RTC=PASS"
echo "ARTIFACT_DIR=$RTC_ARTIFACT_DIR"
