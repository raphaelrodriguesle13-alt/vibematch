#!/usr/bin/env bash
set -euo pipefail

failed=0

run_gate() {
  local name="$1"
  shift
  echo "==> ${name}"
  if "$@"; then
    echo "PASS: ${name}"
  else
    echo "FAIL: ${name}" >&2
    failed=1
  fi
}

run_gate "typecheck" npm run typecheck
run_gate "lint" npm run lint
run_gate "format" npm run format:check
run_gate "migrations" npm run migrate
run_gate "database security" npm run test:db
run_gate "unit tests" npm run test:unit

if command -v gitleaks >/dev/null 2>&1; then
  run_gate "secret scan" gitleaks detect --no-banner --redact
else
  echo "FAIL: secret scan (gitleaks not installed)" >&2
  failed=1
fi

if [[ -x android/gradlew ]]; then
  run_gate "android unit tests" bash -lc 'cd android && ./gradlew test --no-daemon'
  run_gate "android debug build" bash -lc 'cd android && ./gradlew :app:assembleDebug --no-daemon'
else
  echo "FAIL: android gate (android/gradlew missing or not executable)" >&2
  failed=1
fi

if [[ "$failed" -eq 0 ]]; then
  echo "RELEASE GATE: PASS"
  exit 0
fi

echo "RELEASE GATE: FAIL" >&2
exit 1
