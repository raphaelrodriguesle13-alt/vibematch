# Handoff Manus → ChatGPT — VibeMatch

Atualizado em **2026-08-26** após a publicação na branch exclusiva `continuity`.

## Resumo da entrega

Esta etapa adiciona ao Android a camada de autorização de Video Session sobre os contratos server-side já consolidados pelo ChatGPT. Depois de perfil completo, Age Assurance aprovado, telefone confirmado, MatchIntent aceita e Consent em `ACCEPTED_BOTH`, o usuário pode solicitar explicitamente uma sessão de vídeo e, depois, uma credencial JIT do backend.

O fluxo autenticado permanece **Perfil → Age Assurance → Telefone → Chat → MatchIntent → Consent → autorização de Video Session**. O Android apenas solicita e apresenta estados retornados pelo servidor. Identidade, elegibilidade, telefone, idade, bloqueios, participantes, validade, `video_deadline`, revogação e autorização de token continuam sob responsabilidade do backend e do banco.

> **Fonte de verdade:** o cliente Android não aprova localmente idade, telefone, matchmaking, consentimento, vídeo ou entitlement. A tela de vídeo não inicia câmera, WebRTC, LiveKit ou publicação de mídia nesta etapa.

## Estado do Git

| Item                                  | Valor                                                                 |
| ------------------------------------- | --------------------------------------------------------------------- |
| Repositório                           | `raphaelrodriguesle13-alt/vibematch`                                  |
| Branch utilizada                      | `continuity`                                                          |
| HEAD inicial histórico desta retomada | `d9487c9`                                                             |
| Base cooperativa antes desta etapa    | `a670567`                                                             |
| HEAD final desta etapa                | `703d75aed63ccf036fdf64a61df05b5a01922c44`                            |
| Estado final                          | `continuity` sincronizada com `origin/continuity`, working tree limpo |
| Push                                  | Realizado sem force-push e sem tocar na `main`                        |

O ChatGPT publicou em paralelo reforços de telefone, revogação ativa, rate limiting, APIs públicas de Consent/Video/Moderation e fixtures de banco. O trabalho Android foi preservado por rebases lineares sucessivos, sem reset destrutivo ou sobrescrita dos controles server-side.

## Commits relevantes

| Commit    | Descrição                                    |
| --------- | -------------------------------------------- |
| `c9dbed8` | `feat: add Android mutual consent flow`      |
| `b241431` | `fix: complete restricted error mappings`    |
| `a994436` | `feat: add Android video authorization flow` |
| `703d75a` | `style: format structural immutability test` |

O commit `a994436` contém o cliente, ViewModel, tela Compose e testes de Video Session. O commit `703d75a` contém somente a formatação necessária de um teste cooperativo para o gate Prettier.

## Contratos Android integrados

| Endpoint                               | Uso no Android                        | Regras preservadas                                                                    |
| -------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------- |
| `GET /api/interests`                   | Chips do onboarding/perfil            | Catálogo server-side; máximo visual de 10 interesses                                  |
| `GET /api/profile`                     | Perfil existente ou onboarding        | `404 PROFILE_NOT_FOUND` inicia onboarding; `401` encerra sessão                       |
| `PUT /api/profile`                     | Criação/edição do perfil              | Validação final permanece no backend                                                  |
| `GET /api/age-assurance/status`        | Gate etário                           | Somente `APPROVED` libera recursos restritos                                          |
| `POST /auth/phone/start`               | Início do SMS                         | `verification_id` fica somente no estado da tela                                      |
| `POST /auth/phone/confirm`             | Confirmação SMS                       | A dica local só muda após resposta positiva server-side                               |
| `GET /api/match-intents/incoming`      | Inbox de solicitações recebidas       | Backend controla elegibilidade, validade e participantes                              |
| `POST /api/match-intents/{id}/respond` | Aceitar ou recusar MatchIntent        | Envia somente `ACCEPTED` ou `DECLINED`                                                |
| `POST /api/consents`                   | Criar Consent após MatchIntent aceita | Envia somente `match_intent_id`                                                       |
| `POST /api/consents/{id}/decision`     | Decidir Consent                       | Envia decisão e `request_id` UUID; sessão autenticada é anexada pelo backend          |
| `POST /api/video/sessions`             | Criar sessão autorizada               | Envia somente `consent_id`; backend revalida Consent, idade, telefone e elegibilidade |
| `POST /api/video/sessions/{id}/token`  | Solicitar token JIT                   | Identidade e sala são derivadas pelo backend; token não é persistido                  |

O Android trata `AGE_ASSURANCE_REQUIRED`, `PHONE_VERIFICATION_REQUIRED`, `VIDEO_NOT_AUTHORIZED`, `RATE_LIMITED`, HTTP 401, HTTP 429, indisponibilidade, respostas inválidas e estados desconhecidos sem liberar recursos localmente. Se telefone ou idade forem revogados durante o fluxo, o Android retorna ao onboarding correspondente.

## Implementação Android

O módulo `android/.../video/` contém `VideoSession`, `VideoSessionStatus`, `VideoSessionGateway`, `VideoSessionApiClient`, `VideoSessionUiState` e `VideoSessionViewModel`. O cliente serializa `consent_id`, envia Bearer token seguro e solicita o token em uma operação POST sem aceitar `user_id`, `room_name`, participante ou decisão de Consent fornecidos pelo cliente.

A tela Compose de Video Session é acessível somente a partir de Consent `ACCEPTED_BOTH`. Primeiro ela solicita a criação server-side da sessão. Depois de criada, uma ação explícita do usuário solicita o token JIT. A credencial é entregue apenas a um callback transitório em memória para a futura camada de mídia; não é gravada em `SharedPreferences`, logs ou arquivos e não é exibida na interface.

Nesta etapa não foi adicionada dependência RTC, permissão de câmera, conexão LiveKit, WebRTC, publicação de mídia ou reconexão automática. O botão e as mensagens da tela deixam claro que a autorização do servidor não equivale à inicialização de vídeo.

## Testes e builds

| Comando                                                        | Resultado                                    |
| -------------------------------------------------------------- | -------------------------------------------- |
| `npm run typecheck`                                            | Aprovado                                     |
| `npm run lint`                                                 | Aprovado                                     |
| `npm run format:check`                                         | Aprovado                                     |
| `npm run test:unit`                                            | Aprovado: 13 suítes e 65 testes              |
| `./gradlew test :app:assembleDebug :app:lintDebug --no-daemon` | Aprovado: `BUILD SUCCESSFUL`                 |
| Scanner local de padrões de segredo no Android                 | Aprovado; nenhuma chave real encontrada      |
| `git diff --check`                                             | Aprovado                                     |
| Branch/working tree                                            | Limpa e sincronizada com `origin/continuity` |

O APK debug atualizado foi gerado em `android/app/build/outputs/apk/debug/app-debug.apk`.

| Artefato        | SHA-256                                                            |
| --------------- | ------------------------------------------------------------------ |
| `app-debug.apk` | `219c0d021275f7f954631866f42820d921a7940e8ec8cfdd765e6deb3c633f28` |

Os testes PostgreSQL/migrations não foram executados neste sandbox por ausência de `DATABASE_URL_OWNER` e das demais URLs de banco de teste. Os testes DB de telefone, revogação, rate limiting, privilégios e imutabilidade devem ser repetidos no CI ou em ambiente local com PostgreSQL configurado. Isso permanece uma pendência ambiental, não uma falha dos gates unitários executados.

## Pendências externas e riscos

A validação ponta a ponta ainda depende de provedor SMS real, dispositivo/emulador, Web client ID Google real e ambiente com participantes reais para exercer MatchIntent, Consent e Video Session. A renovação de sessão e a coordenação de nonce server-side continuam pendentes; não foi implementado nonce apenas no cliente.

A criação de MatchIntent de saída ainda não possui UX Android porque não há, nesta etapa, uma API de descoberta de candidatos/perfis para selecionar `receiver_id`. A inbox recebida, a resposta de intenção, a criação de Consent e a decisão de Consent já estão integradas.

A credencial JIT ainda não é consumida por uma camada de mídia. Antes de conectar LiveKit/WebRTC, é necessário definir fornecedor RTC, ciclo de vida da sessão, revogação ativa, tratamento de `VIDEO_NOT_AUTHORIZED`/`RATE_LIMITED`, expiração de `video_deadline`, limpeza de credenciais em memória e revalidação imediatamente antes de publicação.

Persistência de conversas, rate limiting específico do chat, observabilidade, moderação operacional, notificações e execução comprovada das migrations Up/Down/Up ainda precisam ser concluídos. Os avisos de depreciação de `EncryptedSharedPreferences`/`MasterKey` devem ser revisados antes da release.

## Próximo passo recomendado

Validar telefone, MatchIntent, Consent e Video Session em dispositivo com ambiente real. Depois, implementar a camada RTC somente por autorização JIT server-side, sem permitir que o Android derive identidade, sala, participantes, prazo ou entitlement. A próxima mudança deve ser isolada, incluir testes negativos de revogação/expiração/rate limiting e preservar a separação entre autorização de vídeo e conexão efetiva de mídia.

## Invariantes preservados

Nenhuma chave OpenAI ou segredo foi incluído no Android ou no repositório. O `OPENAI_API_KEY` continua exclusivamente no backend. O único branch utilizado foi `continuity`; não houve merge ou push na `main`, nem force-push. O Android mantém HTTPS obrigatório em release, sessão segura local e comportamento fail-closed para qualquer estado restrito desconhecido ou não aprovado.
