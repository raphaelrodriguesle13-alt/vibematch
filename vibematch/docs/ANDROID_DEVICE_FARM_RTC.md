# RTC diagnostics for device farms

This harness captures actionable LiveKit/WebRTC lifecycle evidence without collecting VibeMatch credentials.

## Recommended device-farm command

```bash
APK_PATH=/path/to/app-debug.apk \
RTC_ARTIFACT_DIR="$PWD/test-results/rtc" \
EXPECT_RTC_CONNECTED=1 \
EXPECT_REMOTE_PARTICIPANT=1 \
./tools/android-device-farm-rtc.sh -- ./your-ui-automation-command
```

If no automation command is supplied, the wrapper opens a manual window controlled by `MANUAL_WINDOW_SECONDS` (default 180 seconds).

## Artifacts

Upload only the sanitized artifact directory after `android-rtc-logcat.sh stop` completes:

- `rtc-summary.env` — machine-readable verdict and counters.
- `rtc-logcat.txt` — sanitized lifecycle/crash log.
- `exit-info.txt` — sanitized Android process exit history when supported by the device API level.

The temporary `rtc-logcat.raw` file is removed during analysis. The logger and harness must never emit or retain JIT tokens, Authorization headers, refresh/access tokens, LiveKit URLs, room names, user ids, participant identities, phone numbers, or e-mail addresses.

## Verdicts

- `PASS`: an RTC connection was observed and all requested expectations were met.
- `FAIL / livekit_connect_failure`: configuration rejection, connect exception, or `FailedToConnect` was observed.
- `FAIL / rtc_media_failure`: camera or microphone operation failed after authorization.
- `FAIL / reconnect_not_recovered`: capture ended while the last RTC lifecycle marker was `RECONNECTING`.
- `FAIL / remote_participant_not_observed`: two-party evidence was required but never appeared.
- `NO_RTC_SIGNAL`: the test never reached the RTC path even though a connection was required.

`AndroidRuntime`, native fatal signals and the app-specific `VibeMatchRtc` tag are captured. SDK debug logging remains disabled by default because upstream LiveKit logs can contain implementation context that is unnecessary for the primary release gate.

## CI protection

`./tools/test-android-rtc-logcat.sh` feeds synthetic PASS/failure/reconnect/secret-bearing logs into the analyzer. CI fails if classification or redaction regresses.
