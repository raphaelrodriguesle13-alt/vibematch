# Variáveis de Ambiente

Fonte de verdade dos nomes: `.env.example`. Nenhum valor real é versionado.
Produção resolve segredos via GCP Secret Manager (`SECRET_BACKEND=gcp-secret-manager`),
não por arquivo `.env` — ver `backend/src/config/env.ts`.

| Variável                                 | Uso                                      | Obrigatória          | Etapa |
| ---------------------------------------- | ---------------------------------------- | -------------------- | ----- |
| `NODE_ENV`                               | development / test / production          | sim                  | 0     |
| `DATABASE_URL`                           | migrations (owner)                       | sim                  | 0     |
| `DATABASE_URL_OWNER`                     | testes que precisam de owner             | sim (test)           | 1     |
| `DATABASE_URL_MATCHMAKING`               | runtime svc_matchmaking                  | sim (test/runtime)   | 1     |
| `DATABASE_URL_VIDEO`                     | runtime svc_video                        | sim (test/runtime)   | 1     |
| `DATABASE_URL_MODERATION`                | runtime svc_moderation                   | sim (test/runtime)   | 1     |
| `DATABASE_URL_BILLING`                   | runtime svc_billing                      | sim (test/runtime)   | 1     |
| `SVC_*_PASSWORD`                         | bootstrap de papéis local                | sim (local)          | 0     |
| `SESSION_INACTIVITY_TIMEOUT_SECONDS`     | V1.2 D2 (default 60)                     | não                  | 7     |
| `CONSENT_VIDEO_DEADLINE_SECONDS`         | V1.2 D3 (default 3600)                   | não                  | 6     |
| `SECRET_BACKEND`                         | env \| gcp-secret-manager                | não                  | 0     |
| `LIVEKIT_URL`                            | endpoint RTC público `wss://`            | sim para vídeo real  | 7     |
| `LIVEKIT_API_URL`                        | endpoint administrativo backend `https`  | sim para revogação   | 7     |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | assinatura JIT e administração LiveKit   | sim para vídeo real  | 7     |
| `AGE_ASSURANCE_API_KEY`                  | provedor de garantia de idade            | sim em produção      | 4     |
| `OPENAI_API_KEY`                         | chave server-side da Responses API       | sim para `/api/chat` | 2     |
| `OPENAI_BASE_URL`                        | base URL do provedor                     | não                  | 2     |
| `OPENAI_MODEL`                           | modelo usado no chat                     | não                  | 2     |
| `OPENAI_TIMEOUT_MS`                      | timeout da chamada                       | não                  | 2     |
| `PORT`                                   | porta HTTP do backend                    | não                  | 2     |

## LiveKit

`LIVEKIT_URL` e `LIVEKIT_API_URL` são intencionalmente separados. O primeiro é entregue ao cliente/Android para WebSocket RTC e deve usar `wss://`. O segundo nunca é necessário no cliente: é usado pelo backend para a API administrativa do LiveKit e deve usar `https://`. `LIVEKIT_API_SECRET` nunca pode ser incluído em BuildConfig, APK, logs ou respostas HTTP.
