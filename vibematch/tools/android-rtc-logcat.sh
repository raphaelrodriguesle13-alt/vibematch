#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-}"
if [[ -n "$MODE" ]]; then shift; fi

PACKAGE_NAME="${PACKAGE_NAME:-com.vibematch.app}"
DEVICE_SERIAL="${DEVICE_SERIAL:-}"
ADB_BIN="${ADB_BIN:-}"
RTC_ARTIFACT_DIR="${RTC_ARTIFACT_DIR:-artifacts/rtc}"
RTC_CAPTURE_SECONDS="${RTC_CAPTURE_SECONDS:-900}"
EXPECT_RTC_CONNECTED="${EXPECT_RTC_CONNECTED:-1}"
EXPECT_REMOTE_PARTICIPANT="${EXPECT_REMOTE_PARTICIPANT:-0}"
EXPECT_REMOTE_VIDEO="${EXPECT_REMOTE_VIDEO:-0}"
ALLOW_SERVER_DISCONNECT="${ALLOW_SERVER_DISCONNECT:-0}"
RAW_PATH_FILE="$RTC_ARTIFACT_DIR/.raw-log-path"
EXIT_INFO_BASELINE_FILE="$RTC_ARTIFACT_DIR/.exit-info-baseline-cleared"
SANITIZED_LOG="$RTC_ARTIFACT_DIR/rtc-logcat.txt"
SUMMARY_FILE="$RTC_ARTIFACT_DIR/rtc-summary.env"
EXIT_INFO_RAW="$RTC_ARTIFACT_DIR/exit-info.raw"
EXIT_INFO="$RTC_ARTIFACT_DIR/exit-info.txt"
PID_FILE="$RTC_ARTIFACT_DIR/.logcat.pid"

usage() {
  cat <<'USAGE'
Usage:
  android-rtc-logcat.sh start
  android-rtc-logcat.sh stop
  android-rtc-logcat.sh analyze-file <log-file>

Environment:
  DEVICE_SERIAL               ADB serial; auto-selected only when exactly one device is authorized.
  RTC_ARTIFACT_DIR            Artifact directory (default: artifacts/rtc).
  RTC_CAPTURE_SECONDS         Hard collector timeout (default: 900).
  EXPECT_RTC_CONNECTED        Require a CONNECTED marker (default: 1).
  EXPECT_REMOTE_PARTICIPANT   Require a remote participant (default: 0).
  EXPECT_REMOTE_VIDEO         Require remote video subscription/evidence (default: 0).
  ALLOW_SERVER_DISCONNECT     Allow an unsolicited server disconnect (default: 0).
USAGE
}

resolve_adb() {
  if [[ -z "$ADB_BIN" ]]; then
    if command -v adb >/dev/null 2>&1; then
      ADB_BIN="$(command -v adb)"
    elif [[ -x "${ANDROID_SDK_ROOT:-}/platform-tools/adb" ]]; then
      ADB_BIN="${ANDROID_SDK_ROOT}/platform-tools/adb"
    elif [[ -x "${ANDROID_HOME:-}/platform-tools/adb" ]]; then
      ADB_BIN="${ANDROID_HOME}/platform-tools/adb"
    else
      echo "RTC_DIAGNOSTICS=BLOCKED"
      echo "REASON=adb_not_found"
      exit 2
    fi
  fi
  if [[ ! -x "$ADB_BIN" ]]; then
    echo "RTC_DIAGNOSTICS=BLOCKED"
    echo "REASON=adb_not_executable"
    exit 2
  fi
}

resolve_device() {
  resolve_adb
  "$ADB_BIN" start-server >/dev/null
  if [[ -z "$DEVICE_SERIAL" ]]; then
    mapfile -t devices < <("$ADB_BIN" devices | awk 'NR > 1 && $2 == "device" { print $1 }')
    if (( ${#devices[@]} != 1 )); then
      echo "RTC_DIAGNOSTICS=BLOCKED"
      echo "REASON=expected_exactly_one_authorized_device"
      echo "AUTHORIZED_DEVICE_COUNT=${#devices[@]}"
      exit 2
    fi
    DEVICE_SERIAL="${devices[0]}"
  fi
  ADB_CMD=("$ADB_BIN" -s "$DEVICE_SERIAL")
  if ! "${ADB_CMD[@]}" get-state >/dev/null 2>&1; then
    echo "RTC_DIAGNOSTICS=BLOCKED"
    echo "REASON=device_not_ready"
    exit 2
  fi
}

sanitize_file() {
  local input="$1"
  local output="$2"
  if [[ ! -f "$input" ]]; then
    : > "$output"
    return
  fi
  sed -E -e 's#(https?|wss?)://[^[:space:]"<>]+#<redacted-url>#g' -e 's#([Bb]earer)[[:space:]]+[^[:space:]"]+#\1 <redacted>#g' -e 's#([Tt]oken|[Cc]redential|[Aa]uthorization|access_token|refresh_token)=([^[:space:]]+)#\1=<redacted>#g' -e 's#[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}#<redacted-jwt>#g' -e 's#[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}#<redacted-id>#g' -e 's#\+[1-9][0-9]{7,14}#<redacted-phone>#g' -e 's#[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}#<redacted-email>#g' "$input" > "$output"
}

count_matches() {
  local pattern="$1"
  local file="$2"
  grep -Ec "$pattern" "$file" 2>/dev/null || true
}

analyze() {
  local input="$1"
  mkdir -p "$RTC_ARTIFACT_DIR"
  sanitize_file "$input" "$SANITIZED_LOG"
  local activity_count connected_count reconnecting_count reconnected_count
  local connect_failure_count media_failure_count permission_denied_count log_fatal_count exit_info_fatal_count fatal_count
  local remote_seen remote_video_seen server_disconnect_count last_event last_error_class exit_info_trusted
  activity_count="$(count_matches 'RTC_DIAG event=' "$SANITIZED_LOG")"
  connected_count="$(count_matches 'RTC_DIAG event=(CONNECTED|SDK_CONNECT_SUCCESS)' "$SANITIZED_LOG")"
  reconnecting_count="$(count_matches 'RTC_DIAG event=RECONNECTING' "$SANITIZED_LOG")"
  reconnected_count="$(count_matches 'RTC_DIAG event=RECONNECTED' "$SANITIZED_LOG")"
  connect_failure_count="$(count_matches 'RTC_DIAG event=(CONFIG_REJECTED|JIT_OR_URL_MISSING|CONNECT_EXCEPTION|FAILED_TO_CONNECT)' "$SANITIZED_LOG")"
  media_failure_count="$(count_matches 'RTC_DIAG event=(CAMERA_FAILURE|MICROPHONE_FAILURE)' "$SANITIZED_LOG")"
  permission_denied_count="$(count_matches 'RTC_DIAG event=PERMISSION_DENIED' "$SANITIZED_LOG")"
  log_fatal_count="$(count_matches 'FATAL EXCEPTION|Fatal signal|ANR in com\.vibematch\.app|Process: com\.vibematch\.app' "$SANITIZED_LOG")"
  exit_info_trusted="$(cat "$EXIT_INFO_BASELINE_FILE" 2>/dev/null || echo 0)"
  if [[ "$exit_info_trusted" == "1" && -f "$EXIT_INFO" ]]; then
    exit_info_fatal_count="$(count_matches 'APP CRASH\(EXCEPTION\)|APP CRASH\(NATIVE\)|ANR|INITIALIZATION FAILURE' "$EXIT_INFO")"
  else
    exit_info_fatal_count=0
  fi
  fatal_count=$((log_fatal_count + exit_info_fatal_count))
  remote_seen="$(count_matches 'RTC_DIAG event=(SDK_CONNECT_SUCCESS|PARTICIPANT_CONNECTED|REMOTE_VIDEO_SUBSCRIBED|REMOTE_VIDEO_EXISTING) remote_count=[1-9][0-9]*' "$SANITIZED_LOG")"
  remote_video_seen="$(count_matches 'RTC_DIAG event=(REMOTE_VIDEO_SUBSCRIBED|REMOTE_VIDEO_EXISTING) remote_count=[1-9][0-9]*' "$SANITIZED_LOG")"
  server_disconnect_count="$(count_matches 'RTC_DIAG event=SERVER_DISCONNECTED' "$SANITIZED_LOG")"
  last_event="$(grep -Eo 'RTC_DIAG event=[A-Z0-9_]+' "$SANITIZED_LOG" 2>/dev/null | tail -n 1 | sed 's/.*event=//' || true)"
  last_event="${last_event:-NONE}"
  last_error_class="$(grep -E 'RTC_DIAG event=.* error_class=[A-Za-z0-9_.$]+' "$SANITIZED_LOG" 2>/dev/null | tail -n 1 | sed -E 's/.* error_class=([A-Za-z0-9_.$]+).*/\1/' || true)"
  last_error_class="${last_error_class:-NONE}"

  local status="PASS"
  local reason="none"
  local exit_code=0

  if (( fatal_count > 0 )); then
    status="FAIL"
    reason="app_crash_or_anr"
    exit_code=1
  elif (( connect_failure_count > 0 )); then
    status="FAIL"
    reason="livekit_connect_failure"
    exit_code=1
  elif (( media_failure_count > 0 )); then
    status="FAIL"
    reason="rtc_media_failure"
    exit_code=1
  elif (( permission_denied_count > 0 )); then
    status="FAIL"
    reason="rtc_permission_denied"
    exit_code=1
  elif (( server_disconnect_count > 0 )) && [[ "$ALLOW_SERVER_DISCONNECT" != "1" ]]; then
    status="FAIL"
    reason="server_disconnected"
    exit_code=1
  elif [[ "$last_event" == "RECONNECTING" ]]; then
    status="FAIL"
    reason="reconnect_not_recovered"
    exit_code=1
  elif [[ "$EXPECT_RTC_CONNECTED" == "1" && "$connected_count" -eq 0 ]]; then
    if (( activity_count == 0 )); then
      status="NO_RTC_SIGNAL"
      reason="rtc_flow_not_observed"
      exit_code=3
    else
      status="FAIL"
      reason="rtc_never_connected"
      exit_code=1
    fi
  elif [[ "$EXPECT_REMOTE_PARTICIPANT" == "1" && "$remote_seen" -eq 0 ]]; then
    status="FAIL"
    reason="remote_participant_not_observed"
    exit_code=1
  elif [[ "$EXPECT_REMOTE_VIDEO" == "1" && "$remote_video_seen" -eq 0 ]]; then
    status="FAIL"
    reason="remote_video_not_observed"
    exit_code=1
  fi

  {
    echo "RTC_DIAGNOSTICS=$status"
    echo "REASON=$reason"
    echo "RTC_ACTIVITY_COUNT=$activity_count"
    echo "RTC_CONNECTED_COUNT=$connected_count"
    echo "RTC_RECONNECTING_COUNT=$reconnecting_count"
    echo "RTC_RECONNECTED_COUNT=$reconnected_count"
    echo "RTC_CONNECT_FAILURE_COUNT=$connect_failure_count"
    echo "RTC_MEDIA_FAILURE_COUNT=$media_failure_count"
    echo "RTC_PERMISSION_DENIED_COUNT=$permission_denied_count"
    echo "RTC_SERVER_DISCONNECT_COUNT=$server_disconnect_count"
    echo "RTC_LOG_FATAL_COUNT=$log_fatal_count"
    echo "RTC_EXIT_INFO_FATAL_COUNT=$exit_info_fatal_count"
    echo "RTC_FATAL_COUNT=$fatal_count"
    echo "RTC_REMOTE_EVIDENCE_COUNT=$remote_seen"
    echo "RTC_REMOTE_VIDEO_EVIDENCE_COUNT=$remote_video_seen"
    echo "RTC_LAST_EVENT=$last_event"
    echo "RTC_LAST_ERROR_CLASS=$last_error_class"
    echo "EXIT_INFO_BASELINE_CLEARED=$exit_info_trusted"
    echo "SANITIZED_LOG=$SANITIZED_LOG"
    echo "TOKENS=redacted_or_not_collected"
    echo "CREDENTIALS=redacted_or_not_collected"
    echo "PII=redacted_by_harness"
  } | tee "$SUMMARY_FILE"

  return "$exit_code"
}

start_capture() {
  resolve_device
  mkdir -p "$RTC_ARTIFACT_DIR"
  rm -f "$SANITIZED_LOG" "$SUMMARY_FILE" "$EXIT_INFO_RAW" "$EXIT_INFO" "$PID_FILE" "$RAW_PATH_FILE" "$EXIT_INFO_BASELINE_FILE"
  "${ADB_CMD[@]}" logcat -c >/dev/null 2>&1 || true
  if "${ADB_CMD[@]}" shell am clear-exit-info --user current "$PACKAGE_NAME" >/dev/null 2>&1; then
    echo 1 > "$EXIT_INFO_BASELINE_FILE"
  else
    echo 0 > "$EXIT_INFO_BASELINE_FILE"
  fi
  raw_log="$(mktemp "${TMPDIR:-/tmp}/vibematch-rtc-logcat.XXXXXX")"
  printf '%s\n' "$raw_log" > "$RAW_PATH_FILE"

  # Raw capture is staged outside the artifact directory. Only sanitized output
  # is eligible for upload, even if the device disappears before stop.
  nohup timeout "$RTC_CAPTURE_SECONDS" \
    "${ADB_CMD[@]}" logcat -v threadtime \
      VibeMatchRtc:I AndroidRuntime:E libc:F DEBUG:F '*:S' \
      >"$raw_log" 2>&1 < /dev/null &
  echo "$!" > "$PID_FILE"
  echo "RTC_DIAGNOSTICS=CAPTURING"
  echo "ARTIFACT_DIR=$RTC_ARTIFACT_DIR"
  echo "CAPTURE_SECONDS=$RTC_CAPTURE_SECONDS"
  echo "DEVICE=authorized"
}

stop_capture() {
  resolve_device
  mkdir -p "$RTC_ARTIFACT_DIR"
  if [[ -f "$PID_FILE" ]]; then
    collector_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ "$collector_pid" =~ ^[0-9]+$ ]]; then
      kill "$collector_pid" >/dev/null 2>&1 || true
      wait "$collector_pid" >/dev/null 2>&1 || true
    fi
    rm -f "$PID_FILE"
  fi

  if "${ADB_CMD[@]}" shell dumpsys activity exit-info "$PACKAGE_NAME" >"$EXIT_INFO_RAW" 2>/dev/null; then
    sanitize_file "$EXIT_INFO_RAW" "$EXIT_INFO"
    rm -f "$EXIT_INFO_RAW"
  else
    : > "$EXIT_INFO"
  fi

  raw_log="$(cat "$RAW_PATH_FILE" 2>/dev/null || true)"
  if [[ -z "$raw_log" || ! -f "$raw_log" ]]; then
    echo "RTC_DIAGNOSTICS=BLOCKED"
    echo "REASON=raw_capture_missing"
    return 2
  fi
  set +e
  analyze "$raw_log"
  result=$?
  set -e
  rm -f "$raw_log" "$RAW_PATH_FILE" "$EXIT_INFO_BASELINE_FILE"
  return "$result"
}

case "$MODE" in
  start)
    start_capture
    ;;
  stop)
    stop_capture
    ;;
  analyze-file)
    if [[ $# -ne 1 || ! -f "$1" ]]; then
      echo "RTC_DIAGNOSTICS=BLOCKED"
      echo "REASON=log_file_required"
      exit 2
    fi
    analyze "$1"
    ;;
  *)
    usage
    exit 2
    ;;
esac
