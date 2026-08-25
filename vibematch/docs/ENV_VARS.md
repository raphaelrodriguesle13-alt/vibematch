# Variáveis de Ambiente

Fonte de verdade dos nomes: `.env.example`. Nenhum valor real é versionado.
Produção resolve segredos via GCP Secret Manager (`SECRET_BACKEND=gcp-secret-manager`),
não por arquivo `.env` — ver `backend/src/config/env.ts`.

| Variável                                 | Uso                             | Obrigatória | Etapa |
| ---------------------------------------- | ------------------------------- | ----------- | ----- |
| `NODE_ENV`                               | development / test / production | sim         | 0     |
| `DATABASE_URL`                           | migrations (owner)              | sim         | 0     |
| `DATABASE_URL_OWNER`                     | testes que precisam de owner    | sim (test)  | 1     |
| `DATABASE_URL_MATCHMAKING`               | runtime svc_matchmaking         | sim (test)  | 1     |
| `DATABASE_URL_VIDEO`                     | runtime svc_video               | sim (test)  | 1     |
| `DATABASE_URL_MODERATION`                | runtime svc_moderation          | sim (test)  | 1     |
| `DATABASE_URL_BILLING`                   | runtime svc_billing             | sim (test)  | 1     |
| `SVC_*_PASSWORD`                         | bootstrap de papéis local       | sim (local) | 0     |
| `SESSION_INACTIVITY_TIMEOUT_SECONDS`     | V1.2 D2 (default 60)            | não         | 7     |
| `CONSENT_VIDEO_DEADLINE_SECONDS`         | V1.2 D3 (default 3600)          | não         | 6     |
| `SECRET_BACKEND`                         | env \| gcp-secret-manager       | não         | 0     |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | não usados na etapa 0/1         | não         | 7     |
| `AGE_ASSURANCE_API_KEY`                  | não usado na etapa 0/1          | não         | 4     |
