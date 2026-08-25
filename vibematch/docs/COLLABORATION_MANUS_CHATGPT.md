# VibeMatch — Manus + ChatGPT collaboration

## Source of truth

- Integration branch: `continuity`
- Merge base shared with the Manus commit: `f000c069632b388f963bd7a53a442c7b8da60379`
- Manus/OpenAI commit inspected: `8f4dc710a41c55b98020d12fd1c1e7890a12cc4d`
- Do **not** merge that commit wholesale into `continuity`; the branches have diverged and the HTTP layer now uses Fastify.

## Current lanes

### ChatGPT lane — path to release

Continue Stage 2 Auth/Profile on `continuity`:

1. Google OIDC + revocable API sessions.
2. RS256 JWT issue/verification.
3. Fastify auth routes.
4. Phone verification without storing plaintext SMS codes or raw phone numbers.
5. Profile and subsequent release gates.

Every batch must keep Typecheck, Lint, Format, migrations, DB privilege tests, unit tests and secret scanning green.

### Manus lane — OpenAI integration to preserve

The following ideas/files from commit `8f4dc710` are candidates to port selectively after adapting them to the current architecture:

- `features/chat/chat-service.ts`
- `shared/providers/openai.ts`
- provider interfaces for ChatGPT/OpenAI
- unit tests for chat-service and OpenAI provider
- OpenAI environment variables and documentation

Do not port `backend/src/http/server.ts` or `backend/src/main.ts` as-is. The current branch already uses Fastify; chat must be exposed as a Fastify route/plugin and use the same authentication/session middleware.

## Integration rules

1. Never put an OpenAI key in Android or client-side code.
2. `/api/chat` must require an authenticated, non-revoked API session before release.
3. Keep provider calls behind interfaces so OpenAI can be replaced without changing domain logic.
4. Add request-size, history-size and per-user rate limits before enabling the route in production.
5. Preserve `Cache-Control: no-store` for authenticated AI responses.
6. Do not let AI output become authority for age assurance, consent, moderation enforcement, billing, entitlements, or RTC token issuance.
7. Port tests with the code; no untested cherry-picks.

## Handoff protocol

Any new Manus work should be based on the latest `continuity` head or delivered as an isolated commit/PR that does not rewrite Auth/Profile, migrations, CI, Fastify bootstrap, or security-role boundaries. ChatGPT will review and integrate compatible changes into `continuity` while preserving CI gates.
