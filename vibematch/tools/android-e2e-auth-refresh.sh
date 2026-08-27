#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME="${PACKAGE_NAME:-com.vibematch.app}"
DEVICE_SERIAL="${DEVICE_SERIAL:-}"
APK_PATH="${APK_PATH:-}"
TEST_APK_PATH="${TEST_APK_PATH:-}"
ADB_BIN="${ADB_BIN:-}"
TEST_PACKAGE="${TEST_PACKAGE:-${PACKAGE_NAME}.test}"
TEST_CLASS="${TEST_CLASS:-com.vibematch.app.SecureSessionStoreInstrumentedTest}"

blocked() {
  echo "E2E_AUTH_REFRESH=BLOCKED"
  echo "REASON=$1"
  exit 2
}

[[ -n "$APK_PATH" && -f "$APK_PATH" ]] || blocked "APK_PATH_required_or_not_found"
[[ -n "$TEST_APK_PATH" && -f "$TEST_APK_PATH" ]] || blocked "TEST_APK_PATH_required_or_not_found"

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
if [[ -z "$DEVICE_SERIAL" ]]; then
  mapfile -t devices < <("$ADB_BIN" devices | awk 'NR > 1 && $2 == "device" { print $1 }')
  (( ${#devices[@]} == 1 )) || {
    echo "E2E_AUTH_REFRESH=BLOCKED"
    echo "REASON=expected_exactly_one_authorized_device"
    echo "AUTHORIZED_DEVICE_COUNT=${#devices[@]}"
    exit 2
  }
  DEVICE_SERIAL="${devices[0]}"
fi

adb_cmd=("$ADB_BIN" -s "$DEVICE_SERIAL")
"${adb_cmd[@]}" get-state >/dev/null 2>&1 || blocked "device_not_ready"

model="$(${adb_cmd[@]} shell getprop ro.product.model | tr -d '\r' | tr ' ' '_' | tr -cd '[:alnum:]_.-')"
api="$(${adb_cmd[@]} shell getprop ro.build.version.sdk | tr -d '\r' | tr -cd '[:digit:]')"

"${adb_cmd[@]}" install -r "$APK_PATH" >/dev/null 2>&1 || blocked "app_install_failed"
"${adb_cmd[@]}" install -r "$TEST_APK_PATH" >/dev/null 2>&1 || blocked "test_apk_install_failed"

instrumentation="${TEST_PACKAGE}/androidx.test.runner.AndroidJUnitRunner"
if ! "${adb_cmd[@]}" shell am instrument -w -r -e class "$TEST_CLASS" "$instrumentation" >/tmp/vibematch-e2e-auth-refresh-instrumentation.log 2>&1; then
  echo "E2E_AUTH_REFRESH=FAIL"
  echo "REASON=instrumentation_failed"
  echo "DEVICE_SERIAL=$DEVICE_SERIAL"
  echo "MODEL=${model:-unknown}"
  echo "API=${api:-unknown}"
  echo "TOKENS=not_collected"
  echo "CREDENTIALS=not_collected"
  echo "PII=not_collected"
  exit 1
fi

echo "E2E_AUTH_REFRESH=PASS"
echo "DEVICE_SERIAL=$DEVICE_SERIAL"
echo "MODEL=${model:-unknown}"
echo "API=${api:-unknown}"
echo "TEST_CLASS=$TEST_CLASS"
echo "TOKENS=not_collected"
echo "CREDENTIALS=not_collected"
echo "PII=not_collected"
