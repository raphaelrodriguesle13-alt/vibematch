#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME="${PACKAGE_NAME:-com.vibematch.app}"
APK_PATH="${APK_PATH:-}"
ADB_BIN="${ADB_BIN:-}"

if [[ -z "$ADB_BIN" ]]; then
  if command -v adb >/dev/null 2>&1; then
    ADB_BIN="$(command -v adb)"
  elif [[ -x "${ANDROID_SDK_ROOT:-}/platform-tools/adb" ]]; then
    ADB_BIN="${ANDROID_SDK_ROOT}/platform-tools/adb"
  elif [[ -x "${ANDROID_HOME:-}/platform-tools/adb" ]]; then
    ADB_BIN="${ANDROID_HOME}/platform-tools/adb"
  else
    echo "E2E_PREFLIGHT=BLOCKED"
    echo "REASON=adb_not_found"
    exit 2
  fi
fi

if [[ ! -x "$ADB_BIN" ]]; then
  echo "E2E_PREFLIGHT=BLOCKED"
  echo "REASON=adb_not_executable"
  exit 2
fi

"$ADB_BIN" start-server >/dev/null
mapfile -t devices < <("$ADB_BIN" devices | awk 'NR > 1 && $2 == "device" { print $1 }')
if (( ${#devices[@]} == 0 )); then
  echo "E2E_PREFLIGHT=BLOCKED"
  echo "REASON=no_authorized_device"
  "$ADB_BIN" devices | sed 's/[[:space:]]\+/ /g'
  exit 2
fi
if (( ${#devices[@]} > 1 )); then
  echo "DEVICE_COUNT=${#devices[@]}"
  echo "DEVICE_SELECTION=first_authorized_device"
fi

serial="${devices[0]}"
adb_cmd=("$ADB_BIN" -s "$serial")
model="$("${adb_cmd[@]}" shell getprop ro.product.model | tr -d '\r' | tr ' ' '_' | tr -cd '[:alnum:]_.-')"
api="$("${adb_cmd[@]}" shell getprop ro.build.version.sdk | tr -d '\r' | tr -cd '[:digit:]')"

if [[ -n "$APK_PATH" ]]; then
  if [[ ! -f "$APK_PATH" ]]; then
    echo "E2E_PREFLIGHT=BLOCKED"
    echo "REASON=apk_not_found"
    exit 2
  fi
  "${adb_cmd[@]}" install -r "$APK_PATH" >/tmp/vibematch-e2e-install.log
  echo "APK_INSTALL=PASS"
fi

if ! "${adb_cmd[@]}" shell pm path "$PACKAGE_NAME" >/dev/null 2>&1; then
  echo "E2E_PREFLIGHT=BLOCKED"
  echo "REASON=package_not_installed"
  echo "SERIAL=$serial"
  echo "MODEL=${model:-unknown}"
  echo "API=${api:-unknown}"
  exit 2
fi

if ! "${adb_cmd[@]}" shell pm list packages | grep -Fxq "package:${PACKAGE_NAME}"; then
  echo "E2E_PREFLIGHT=BLOCKED"
  echo "REASON=package_not_visible"
  exit 2
fi

echo "E2E_PREFLIGHT=PASS"
echo "SERIAL=$serial"
echo "MODEL=${model:-unknown}"
echo "API=${api:-unknown}"
echo "PACKAGE=$PACKAGE_NAME"
echo "CREDENTIALS=not_collected"
echo "TOKENS=not_collected"
echo "PII=not_collected"
