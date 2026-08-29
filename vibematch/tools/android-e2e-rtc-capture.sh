#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME="${PACKAGE_NAME:-com.vibematch.app}"
DEVICE_SERIAL="${DEVICE_SERIAL:-}"
ADB_BIN="${ADB_BIN:-}"
OUTPUT_DIR="${OUTPUT_DIR:-/tmp/vibematch-rtc-capture-$(date -u +%Y%m%dT%H%M%SZ)}"
DURATION_SECONDS="${DURATION_SECONDS:-0}"

blocked() {
  echo "RTC_CAPTURE=BLOCKED"
  echo "REASON=$1"
  exit 2
}

if [[ -z "$ADB_BIN" ]]; then
  if command -v adb >/dev/null 2>&1; then
    ADB_BIN="$(command -v adb)"
  elif [[ -x "${ANDROID_SDK_ROOT:-}/platform-tools/adb" ]]; then
    ADB_BIN="${ANDROID_SDK_ROOT}/platform-tools/adb"
  elif [[ -x "${ANDROID_HOME:-}/platform-tools/adb" ]]; then
    ADB_BIN="${ANDROID_HOME}/platform-tools/adb"
  else
    blocked "adb_not_found"
  fi
fi
[[ -x "$ADB_BIN" ]] || blocked "adb_not_executable"
"$ADB_BIN" start-server >/dev/null

mapfile -t devices < <("$ADB_BIN" devices | awk 'NR > 1 && $2 == "device" { print $1 }')
if [[ -z "$DEVICE_SERIAL" ]]; then
  (( ${#devices[@]} == 1 )) || {
    echo "RTC_CAPTURE=BLOCKED"
    echo "REASON=expected_exactly_one_authorized_device"
    echo "AUTHORIZED_DEVICE_COUNT=${#devices[@]}"
    exit 2
  }
  DEVICE_SERIAL="${devices[0]}"
else
  printf '%s\n' "${devices[@]}" | grep -Fxq "$DEVICE_SERIAL" || blocked "device_not_authorized"
fi

adb_cmd=("$ADB_BIN" -s "$DEVICE_SERIAL")
"${adb_cmd[@]}" get-state >/dev/null 2>&1 || blocked "device_not_ready"
mkdir -p "$OUTPUT_DIR"
chmod 700 "$OUTPUT_DIR"

model="$("${adb_cmd[@]}" shell getprop ro.product.model | tr -d '\r' | tr ' ' '_' | tr -cd '[:alnum:]_.-')"
api="$("${adb_cmd[@]}" shell getprop ro.build.version.sdk | tr -d '\r' | tr -cd '[:digit:]')"
package_version="$("${adb_cmd[@]}" shell dumpsys package "$PACKAGE_NAME" 2>/dev/null | grep -m1 -Eo 'versionName=[^ ]+|versionCode=[^ ]+' | tr '\n' ';' | tr -cd '[:alnum:]_.=;-')"

cat >"$OUTPUT_DIR/summary.env" <<EOF
RTC_CAPTURE=RUNNING
CAPTURE_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
DEVICE_SERIAL_REDACTED=present
MODEL=${model:-unknown}
API=${api:-unknown}
PACKAGE=$PACKAGE_NAME
PACKAGE_VERSION=${package_version:-unknown}
TOKENS=not_collected
CREDENTIALS=not_collected
PII=not_collected
EOF

# Capture only sanitized lines. Raw logcat is never written to disk.
redact='s/[A-Za-z0-9_-]*\(token\|secret\|password\|authorization\|jwt\|purchase\)[A-Za-z0-9_.-]*[=:][^ ]*/REDACTED_SECRET/g; s/Bearer[[:space:]]+[A-Za-z0-9._-]+/Bearer REDACTED/g; s/[A-Za-z0-9_-]{24,}/REDACTED_LONG_VALUE/g; s/[0-9a-fA-F]{32,}/REDACTED_HEX/g; s/[A-Za-z0-9._%+-]\+@[A-Za-z0-9.-]\+\.[A-Za-z]\{2,\}/REDACTED_EMAIL/g'
filter='LiveKit|livekit|WebRTC|webrtc|RtcRoom|RtcRoomStatus|com\.vibematch\.app|AndroidRuntime|FATAL EXCEPTION|SecurityException|Camera|AudioRecord|AudioTrack|permission|Network|Connectivity|ICE|RTCPeerConnection|Disconnected|Reconnecting|FailedToConnect'

"${adb_cmd[@]}" logcat -c >/dev/null 2>&1 || true
if [[ "$DURATION_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  timeout "${DURATION_SECONDS}s" "${adb_cmd[@]}" logcat -b all -v threadtime 2>/dev/null \
    | grep -Ei "$filter" \
    | sed -E "$redact" >"$OUTPUT_DIR/logcat-sanitized.txt" || true
else
  "${adb_cmd[@]}" logcat -d -b all -v threadtime 2>/dev/null \
    | grep -Ei "$filter" \
    | sed -E "$redact" >"$OUTPUT_DIR/logcat-sanitized.txt" || true
fi

{
  echo "DEVICE_STATE=$("${adb_cmd[@]}" get-state 2>/dev/null | tr -d '\r' || echo unknown)"
  echo "BOOT_COMPLETED=$("${adb_cmd[@]}" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' | tr -cd '[:digit:]' || echo unknown)"
  echo "GMS_PRESENT=$("${adb_cmd[@]}" shell pm path com.google.android.gms >/dev/null 2>&1 && echo yes || echo no)"
  echo "PLAY_STORE_PRESENT=$("${adb_cmd[@]}" shell pm path com.android.vending >/dev/null 2>&1 && echo yes || echo no)"
  echo "APP_PRESENT=$("${adb_cmd[@]}" shell pm path "$PACKAGE_NAME" >/dev/null 2>&1 && echo yes || echo no)"
} >"$OUTPUT_DIR/device-state.env"

# Classify only high-signal, public failure categories. A disconnect is not by
# itself a defect: the harness needs the test case to identify intentional exit.
if grep -Eiq 'FATAL EXCEPTION|SecurityException|FailedToConnect|ICE.*failed|permission.*denied|Camera.*(error|failed)|AudioRecord.*(error|failed)|RTCPeerConnection.*(failed|closed)' "$OUTPUT_DIR/logcat-sanitized.txt"; then
  result=FAIL
  reason=high_signal_rtc_or_runtime_error
else
  result=CAPTURED
  reason=no_high_signal_failure_in_filtered_log
fi
printf 'RTC_CAPTURE=%s\nREASON=%s\nOUTPUT_DIR=%s\nTOKENS=not_collected\nCREDENTIALS=not_collected\nPII=not_collected\n' "$result" "$reason" "$OUTPUT_DIR" \
  >"$OUTPUT_DIR/result.env"
echo "RTC_CAPTURE=$result"
echo "REASON=$reason"
echo "OUTPUT_DIR=$OUTPUT_DIR"
echo "TOKENS=not_collected"
echo "CREDENTIALS=not_collected"
echo "PII=not_collected"
