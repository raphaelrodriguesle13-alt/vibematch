# Arquitetura

A fonte técnica de verdade é o **Blueprint V1.2** (documento externo ao repositório
até ser versionado aqui). Este arquivo não redefine arquitetura; apenas indica onde
cada decisão da V1.2 aparece no código.

| Seção V1.2                    | Onde está implementado                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| §2.2 schema                   | `migrations/002`–`004`                                                                  |
| §2.3 invariantes de Consent   | `migrations/003` (constraints + triggers)                                               |
| §2.2 trigger de elegibilidade | `migrations/003` `enforce_session_eligibility`                                          |
| §2.5 privilégios por papel    | `migrations/006`                                                                        |
| §4.2 trilha de autenticidade  | `migrations/003` `consent_decisions` + `005` hash chain                                 |
| §12 audit model               | `migrations/005`                                                                        |
| §1.3 interfaces de fornecedor | `backend/src/shared/providers/index.ts`                                                 |
| Auth HTTP + sessões           | `backend/src/auth`, `backend/src/http/app.ts`, `migrations/007`                         |
| ChatGPT adapter + API         | `backend/src/chat`, `backend/src/shared/providers/openai.ts`, `backend/src/http/app.ts` |
| Android Compose               | `android/app/src/main/java/com/vibematch/app`                                           |
| D2 / D3 (config server-side)  | `backend/src/config/env.ts`                                                             |
| Gates 42/43/44                | `tests/db/privileges/roles.test.ts`                                                     |

**Implementado nesta continuidade:** autenticação Google e sessões revogáveis no backend, login Google no cliente Android via Credential Manager, sessão criptografada via AndroidX Security Crypto, logout coordenado, contrato inicial `POST /api/chat`, adaptador server-side para a OpenAI Responses API e primeira tela Android Compose. **Não implementado nesta etapa:** onboarding de telefone no cliente Android, renovação de sessão, §5 API Contract completo, §7 modelo de concorrência (transações de aplicação), §8 LiveKit, §9 cascatas, §10 event bus, §11 billing, rate limiting e persistência de conversas.
