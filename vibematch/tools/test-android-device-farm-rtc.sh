#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRAPPER_SOURCE="$SOURCE_DIR/android-device-farm-rtc.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

make_fixture() {
  local name="$1"
  local session_exit="$2"
  local stop_exit="$3"
  local dir="$tmp/$name"
  mkdir -p "$dir"
  cp "$WRAPPER_SOURCE" "$dir/android-device-farm-rtc.sh"
  chmod +x "$dir/android-device-farm-rtc.sh"
  cat > "$dir/android-e2e-session.sh" <<EOF_SESSION
#!/usr/bin/env bash
exit $session_exit
EOF_SESSION
  cat > "$dir/android-rtc-logcat.sh" <<EOF_HARNESS
#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  start) exit 0 ;;
  stop) exit $stop_exit ;;
  *) exit 2 ;;
esac
EOF_HARNESS
  chmod +x "$dir/android-e2e-session.sh" "$dir/android-rtc-logcat.sh"
  printf '%s\n' "$dir"
}

pass_dir="$(make_fixture pass 0 0)"
RTC_ARTIFACT_DIR="$pass_dir/artifacts" "$pass_dir/android-device-farm-rtc.sh" -- bash -c true >/dev/null
grep -Fxq 'DEVICE_FARM_RTC=PASS' "$pass_dir/artifacts/device-farm-summary.env"
grep -Fxq 'FLOW_EXIT_CODE=0' "$pass_dir/artifacts/device-farm-summary.env"
grep -Fxq 'RTC_DIAGNOSTICS_EXIT_CODE=0' "$pass_dir/artifacts/device-farm-summary.env"

diag_dir="$(make_fixture diagnostics-fail 0 1)"
set +e
RTC_ARTIFACT_DIR="$diag_dir/artifacts" "$diag_dir/android-device-farm-rtc.sh" -- bash -c true >/dev/null
status=$?
set -e
[[ "$status" -eq 1 ]]
grep -Fxq 'REASON=rtc_diagnostics_failed' "$diag_dir/artifacts/device-farm-summary.env"

flow_dir="$(make_fixture flow-fail 7 0)"
set +e
RTC_ARTIFACT_DIR="$flow_dir/artifacts" "$flow_dir/android-device-farm-rtc.sh" >/dev/null
status=$?
set -e
[[ "$status" -eq 7 ]]
grep -Fxq 'REASON=flow_command_failed' "$flow_dir/artifacts/device-farm-summary.env"
grep -Fxq 'FLOW_EXIT_CODE=7' "$flow_dir/artifacts/device-farm-summary.env"

echo 'RTC_DEVICE_FARM_WRAPPER_SELF_TEST=PASS'
