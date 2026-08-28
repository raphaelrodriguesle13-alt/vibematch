# RTC diagnostics for device farms

This harness captures actionable LiveKit/WebRTC lifecycle evidence without collecting VibeMatch credentials.

## Recommended device-farm command

```bash
APK_PATH=/path/to/app-debug.apk \
RTC_ARTIFACT_DIR="$PWD/test-results/rtc" \
EXPECT_RTC_CONNECTED=1 \
EXPECT_REMOTE_PARTICIPANT=1 \
EXPECT_REMOTE_VIDEO=1 \
./tools/android-device-farm-rtc.sh -- ./your-ui-automation-command
```

If no automation command is supplied, the wrapper opens a manual window controlled by `MANUAL_WINDOW_SECONDS` (default 180 seconds). `ALLOW_SERVER_DISCONNECT=1` is reserved for negative tests that intentionally revoke/end the room server-side; the normal two-party gate treats an unsolicited server disconnect as a failure.

## Artifacts and privacy

Upload only the sanitized artifact directory after `android-rtc-logcat.sh stop` completes:

- `rtc-summary.env` — machine-readable verdict, counters, last RTC event and last exception class.
- `rtc-logcat.txt` — sanitized RTC lifecycle/crash log.
- `exit-info.txt` — sanitized Android process exit history when supported by the device API level.

Raw logcat is staged under the host temporary directory, never inside the artifact directory, and is deleted after analysis. Before capture, the harness best-effort clears historical `ApplicationExitInfo`; exit-info contributes to the verdict only when that baseline clear succeeded. This prevents an old crash from the same farm device from failing the current run.

The logger and harness must never emit or retain JIT tokens, Authorization headers, refresh/access tokens, LiveKit URLs, room names, user ids, participant identities, phone numbers, e-mail addresses or exception messages. Only a sanitized exception class may be recorded. The app-specific markers are enabled only in debug builds.

## What is classified automatically

- `PASS`: RTC connected and every configured expectation was observed.
- `FAIL / livekit_connect_failure`: missing JIT/config, connect exception, or LiveKit `FailedToConnect`.
- `FAIL / rtc_media_failure`: camera or microphone activation failed after authorization.
- `FAIL / rtc_permission_denied`: the test reached RTC entry but camera/microphone permission was denied.
- `FAIL / server_disconnected`: the room ended from the server side when that was not explicitly allowed.
- `FAIL / reconnect_not_recovered`: capture ended while the last RTC lifecycle marker was `RECONNECTING`.
- `FAIL / remote_participant_not_observed`: a two-party run required a peer but none appeared.
- `FAIL / remote_video_not_observed`: remote video was required but no remote video track was observed.
- `FAIL / app_crash_or_anr`: fatal logcat evidence or trusted per-run `ApplicationExitInfo` reports crash/native crash/ANR/init failure.
- `NO_RTC_SIGNAL`: the automation never reached the RTC path although RTC was expected.

Exit codes are stable for farm orchestration: `0=PASS`, `1=diagnosed test/RTC failure`, `2=blocked or misconfigured harness/device`, `3=RTC flow not observed`.

## Why full LiveKit/WebRTC debug logs stay off

Only `VibeMatchRtc`, Android runtime fatal, and native fatal tags are captured by default. Upstream LiveKit logging stays disabled because full SDK/WebRTC logs are noisy and can expose unnecessary implementation context. The lifecycle markers identify the failing phase without printing the URL, token, room or identity.

## CI protection

`./tools/test-android-rtc-logcat.sh` feeds synthetic success, connection failure, permission denial, stuck reconnect, server disconnect, missing remote video, process-exit crash and secret-bearing logs into the analyzer. CI fails if classification or redaction regresses.
