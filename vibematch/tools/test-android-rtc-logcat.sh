#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS="$SCRIPT_DIR/android-rtc-logcat.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

pass_log="$tmp/pass.log"
cat > "$pass_log" <<'LOG'
08-28 20:00:00.000 I/VibeMatchRtc: RTC_DIAG event=CONNECT_REQUESTED
08-28 20:00:00.100 I/VibeMatchRtc: RTC_DIAG event=SDK_CONNECT_SUCCESS remote_count=0
08-28 20:00:00.200 I/VibeMatchRtc: RTC_DIAG event=CONNECTED remote_count=0
08-28 20:00:00.300 I/VibeMatchRtc: RTC_DIAG event=PARTICIPANT_CONNECTED remote_count=1
08-28 20:00:00.400 I/VibeMatchRtc: RTC_DIAG event=REMOTE_VIDEO_SUBSCRIBED remote_count=1
08-28 20:00:01.000 W/VibeMatchRtc: RTC_DIAG event=RECONNECTING
08-28 20:00:01.500 I/VibeMatchRtc: RTC_DIAG event=RECONNECTED remote_count=1
LOG
RTC_ARTIFACT_DIR="$tmp/pass" EXPECT_RTC_CONNECTED=1 EXPECT_REMOTE_PARTICIPANT=1 \
  "$HARNESS" analyze-file "$pass_log" >/dev/null

grep -Fxq 'RTC_DIAGNOSTICS=PASS' "$tmp/pass/rtc-summary.env"

fail_log="$tmp/fail.log"
cat > "$fail_log" <<'LOG'
08-28 20:00:00.000 I/VibeMatchRtc: RTC_DIAG event=CONNECT_REQUESTED
08-28 20:00:00.100 E/VibeMatchRtc: RTC_DIAG event=FAILED_TO_CONNECT error_class=ConnectException
LOG
set +e
RTC_ARTIFACT_DIR="$tmp/fail" EXPECT_RTC_CONNECTED=1 "$HARNESS" analyze-file "$fail_log" >/dev/null
status=$?
set -e
[[ "$status" -eq 1 ]]
grep -Fxq 'REASON=livekit_connect_failure' "$tmp/fail/rtc-summary.env"

stuck_log="$tmp/stuck.log"
cat > "$stuck_log" <<'LOG'
08-28 20:00:00.000 I/VibeMatchRtc: RTC_DIAG event=CONNECTED remote_count=0
08-28 20:00:01.000 W/VibeMatchRtc: RTC_DIAG event=RECONNECTING
LOG
set +e
RTC_ARTIFACT_DIR="$tmp/stuck" EXPECT_RTC_CONNECTED=1 "$HARNESS" analyze-file "$stuck_log" >/dev/null
status=$?
set -e
[[ "$status" -eq 1 ]]
grep -Fxq 'REASON=reconnect_not_recovered' "$tmp/stuck/rtc-summary.env"

secret_log="$tmp/secret.log"
cat > "$secret_log" <<'LOG'
08-28 20:00:00.000 E/AndroidRuntime: wss://rtc.secret.example/room token=abc123 Authorization=Bearer.secret user@example.com +5511999999999 123e4567-e89b-12d3-a456-426614174000
LOG
set +e
RTC_ARTIFACT_DIR="$tmp/secret" EXPECT_RTC_CONNECTED=0 "$HARNESS" analyze-file "$secret_log" >/dev/null
status=$?
set -e
[[ "$status" -eq 0 ]]
! grep -Fq 'rtc.secret.example' "$tmp/secret/rtc-logcat.txt"
! grep -Fq 'user@example.com' "$tmp/secret/rtc-logcat.txt"
! grep -Fq '+5511999999999' "$tmp/secret/rtc-logcat.txt"
! grep -Fq '123e4567-e89b-12d3-a456-426614174000' "$tmp/secret/rtc-logcat.txt"

echo 'RTC_HARNESS_SELF_TEST=PASS'
