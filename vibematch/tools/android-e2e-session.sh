#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME="${PACKAGE_NAME:-com.vibematch.app}"
APK_PATH="${APK_PATH:-}"
DEVICE_SERIAL="${DEVICE_SERIAL:-}"
CLEAR_APP_DATA="${CLEAR_APP_DATA:-0}"
ADB_BIN="${ADB_BIN:-}"

if [[ -z "$APK_PATH" ]]; then
  echo "E2E_SESSION=BLOCKED"
  echo "REASON=APK_PATH_required"
  exit 2
fi
if [[ ! -f "$APK_PATH" ]]; then
  echo "E2E_SESSION=BLOCKED"
  echo "REASON=apk_not_found"
  exit 2
fi

if [[ -z "$ADB_BIN" ]]; then
  if command -v adb >/dev/null 2>&1; then
    ADB_BIN="$(command -v adb)"
  elif [[ -x "${ANDROID_SDK_ROOT:-}/platform-tools/adb" ]]; then
    ADB_BIN="${ANDROID_SDK_ROOT}/platform-tools/adb"
  elif [[ -x "${ANDROID_HOME:-}/platform-tools/adb" ]]; then
    ADB_BIN="${ANDROID_HOME}/platform-tools/adb"
  else
    echo "E2E_SESSION=BLOCKED"
    echo "REASON=adb_not_found"
    exit 2
  fi
fi

if [[ ! -x "$ADB_BIN" ]]; then
  echo "E2E_SESSION=BLOCKED"
  echo "REASON=adb_not_executable"
  exit 2
fi

"$ADB_BIN" start-server >/dev/null
if [[ -z "$DEVICE_SERIAL" ]]; then
  mapfile -t devices < <("$ADB_BIN" devices | awk 'NR > 1 && $2 == "device" { print $1 }')
  if (( ${#devices[@]} != 1 )); then
    echo "E2E_SESSION=BLOCKED"
    echo "REASON=expected_exactly_one_authorized_device"
    echo "AUTHORIZED_DEVICE_COUNT=${#devices[@]}"
    "$ADB_BIN" devices | sed 's/[[:space:]]\+/ /g'
    exit 2
  fi
  DEVICE_SERIAL="${devices[0]}"
fi

adb_cmd=("$ADB_BIN" -s "$DEVICE_SERIAL")
if ! "${adb_cmd[@]}" get-state >/dev/null 2>&1; then
  echo "E2E_SESSION=BLOCKED"
  echo "REASON=device_not_ready"
  echo "DEVICE_SERIAL=$DEVICE_SERIAL"
  exit 2
fi

model="$("${adb_cmd[@]}" shell getprop ro.product.model | tr -d '\r' | tr ' ' '_' | tr -cd '[:alnum:]_.-')"
api="$("${adb_cmd[@]}" shell getprop ro.build.version.sdk | tr -d '\r' | tr -cd '[:digit:]')"
package_sha256="$(sha256sum "$APK_PATH" | awk '{print $1}')"

if ! "${adb_cmd[@]}" shell pm path com.google.android.gms >/dev/null 2>&1; then
  echo "E2E_SESSION=BLOCKED"
  echo "REASON=google_mobile_services_missing"
  echo "DEVICE_SERIAL=$DEVICE_SERIAL"
  echo "MODEL=${model:-unknown}"
  echo "API=${api:-unknown}"
  exit 2
fi
if ! "${adb_cmd[@]}" shell pm path com.android.vending >/dev/null 2>&1; then
  echo "E2E_SESSION=BLOCKED"
  echo "REASON=google_play_store_missing"
  echo "DEVICE_SERIAL=$DEVICE_SERIAL"
  echo "MODEL=${model:-unknown}"
  echo "API=${api:-unknown}"
  exit 2
fi

if [[ "$CLEAR_APP_DATA" == "1" ]]; then
  "${adb_cmd[@]}" shell pm clear "$PACKAGE_NAME" >/dev/null
  echo "APP_DATA_CLEARED=1"
fi

"${adb_cmd[@]}" install -r "$APK_PATH" >/tmp/vibematch-e2e-session-install.log
if ! "${adb_cmd[@]}" shell pm path "$PACKAGE_NAME" >/dev/null 2>&1; then
  echo "E2E_SESSION=BLOCKED"
  echo "REASON=package_install_failed"
  exit 2
fi

"${adb_cmd[@]}" shell monkey -p "$PACKAGE_NAME" 1 >/tmp/vibematch-e2e-session-launch.log 2>&1

echo "E2E_SESSION=READY_FOR_MANUAL_FLOW"
echo "DEVICE_SERIAL=$DEVICE_SERIAL"
echo "MODEL=${model:-unknown}"
echo "API=${api:-unknown}"
echo "PLAY_SERVICES=present"
echo "PLAY_STORE=present"
echo "PACKAGE=$PACKAGE_NAME"
echo "APK_SHA256=$package_sha256"
echo "TOKENS=not_collected"
echo "CREDENTIALS=not_collected"
echo "PII=not_collected"
echo "NEXT=execute_docs/ANDROID_E2E_RELEASE_PLAN.md_with_two_sanitized_accounts"
