# Variáveis de Ambiente

Fonte de verdade dos nomes: `.env.example`. Nenhum valor real é versionado.
Produção resolve segredos via GCP Secret Manager (`SECRET_BACKEND=gcp-secret-manager`), não por arquivo `.env` — ver `backend/src/config/env.ts`.

## Banco e runtime

- `NODE_ENV`: `development`, `test` ou `production`.
- `DATABASE_URL`: conexão de owner usada por migrations.
- `DATABASE_URL_OWNER`: owner em testes que exigem privilégios de migração.
- `DATABASE_URL_MATCHMAKING`: runtime `svc_matchmaking`.
- `DATABASE_URL_VIDEO`: runtime `svc_video` e composição do serviço de vídeo.
- `DATABASE_URL_MODERATION`: runtime `svc_moderation`.
- `DATABASE_URL_BILLING`: runtime `svc_billing`.
- `SVC_*_PASSWORD`: bootstrap local dos papéis de runtime.

## Configuração de domínio

- `SESSION_INACTIVITY_TIMEOUT_SECONDS`: timeout de inatividade da sessão. Default `60`.
- `CONSENT_VIDEO_DEADLINE_SECONDS`: janela de vídeo após consentimento mútuo. Default `3600`.
- `SECRET_BACKEND`: `env` em desenvolvimento/teste ou `gcp-secret-manager` em produção.

## LiveKit

- `LIVEKIT_URL`: endpoint RTC público consumido pelo Android. Em release deve usar `wss://`.
- `LIVEKIT_API_URL`: endpoint administrativo usado somente no backend. Deve usar `https://`.
- `LIVEKIT_API_KEY`: identificador server-side usado para assinatura JIT e chamadas administrativas.
- `LIVEKIT_API_SECRET`: segredo server-side. Nunca pode entrar em BuildConfig, APK, logs ou respostas HTTP.

`LIVEKIT_URL` e `LIVEKIT_API_URL` são intencionalmente separados. O cliente precisa apenas da superfície RTC. Operações como `DeleteRoom` usam a API administrativa no backend.

## Outros provedores

- `AGE_ASSURANCE_API_KEY`: credencial do provedor de garantia de idade.
- `OPENAI_API_KEY`: chave server-side necessária para `/api/chat`.
- `OPENAI_BASE_URL`: base URL do provedor OpenAI. Opcional.
- `OPENAI_MODEL`: modelo usado pelo chat. Opcional.
- `OPENAI_TIMEOUT_MS`: timeout da chamada ao provedor. Opcional.
- `PORT`: porta HTTP do backend. Opcional.
