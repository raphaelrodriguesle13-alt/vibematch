# Handoff Manus → ChatGPT — VibeMatch

Atualizado em **2026-08-26** após a publicação na branch exclusiva `continuity`.

## Resumo da entrega

Esta etapa adiciona ao Android a primeira UX de consentimento mútuo sobre as novas rotas HTTP públicas do backend. Depois de perfil completo, Age Assurance aprovado, telefone confirmado e MatchIntent aceita, o app cria Consent, mostra os estados dos dois participantes e envia a decisão do usuário com um `request_id` UUID. O Android exibe o resultado server-controlled e não cria sessão de vídeo, token RTC ou entitlement localmente.

O fluxo autenticado permanece **Perfil → Age Assurance → Telefone → Chat → MatchIntent → Consent**. A identidade, a elegibilidade, os participantes, os prazos, a transição para `ACCEPTED_BOTH` e a autorização de vídeo continuam sendo decisões do backend e do banco.

> **Fonte de verdade:** o cliente Android apresenta estados e solicita transições; ele não aprova localmente idade, telefone, matchmaking, consentimento, vídeo, bloqueio, suspensão ou entitlement.

## Estado do Git

| Item                                           | Valor                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| Repositório                                    | `raphaelrodriguesle13-alt/vibematch`                                  |
| Branch utilizada                               | `continuity`                                                          |
| HEAD inicial histórico desta retomada          | `d9487c9`                                                             |
| Base cooperativa reconciliada antes de Consent | `b3743c7`                                                             |
| HEAD final desta etapa                         | `c9dbed8`                                                             |
| Estado final                                   | `continuity` sincronizada com `origin/continuity`, working tree limpo |
| Push                                           | Realizado sem force-push e sem tocar na `main`                        |

Durante a implementação, o ChatGPT publicou em paralelo reforços de telefone, revogação ativa, rate limiting, APIs públicas de Consent/Video/Moderation e testes de banco. O trabalho Android foi preservado por rebases lineares sucessivos; não houve reset destrutivo nem sobrescrita de Auth, JWT, migrations, Fastify ou controles server-side.

## Commits relevantes

| Commit    | Descrição                                 |
| --------- | ----------------------------------------- |
| `4c99eda` | `feat: add Android match intent inbox`    |
| `b241431` | `fix: complete restricted error mappings` |
| `c9dbed8` | `feat: add Android mutual consent flow`   |

O commit `b241431` contém o fallback mínimo exigido pelo TypeScript para os mapeadores de erro de Consent/Video e a formatação dos arquivos cooperativos que bloqueavam o Prettier. Nenhum código desse ajuste altera os códigos HTTP públicos conhecidos.

## Contratos Android integrados

| Endpoint                               | Uso no Android                        | Regras preservadas                                                              |
| -------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------- |
| `GET /api/interests`                   | Chips do onboarding/perfil            | Catálogo server-side; máximo visual de 10 interesses                            |
| `GET /api/profile`                     | Perfil existente ou onboarding        | `404 PROFILE_NOT_FOUND` inicia onboarding; `401` encerra sessão                 |
| `PUT /api/profile`                     | Criação/edição do perfil              | Validação final permanece no backend                                            |
| `GET /api/age-assurance/status`        | Gate etário                           | Somente `APPROVED` libera recursos restritos                                    |
| `POST /auth/phone/start`               | Início do SMS                         | `verification_id` fica somente no estado da tela                                |
| `POST /auth/phone/confirm`             | Confirmação SMS                       | A dica local só muda após resposta positiva server-side                         |
| `GET /api/match-intents/incoming`      | Inbox de solicitações recebidas       | Backend controla elegibilidade, validade e participantes                        |
| `POST /api/match-intents/{id}/respond` | Aceitar ou recusar MatchIntent        | Envia somente `ACCEPTED` ou `DECLINED`                                          |
| `POST /api/consents`                   | Criar Consent após MatchIntent aceita | Envia somente `match_intent_id`                                                 |
| `POST /api/consents/{id}/decision`     | Decidir Consent                       | Envia `decision` e `request_id` UUID; sessão autenticada é anexada pelo backend |

O Android trata `AGE_ASSURANCE_REQUIRED`, `PHONE_VERIFICATION_REQUIRED`, `401`, `429`, indisponibilidade, respostas inválidas e estados desconhecidos sem liberar recursos. Quando MatchIntent ou Consent informa que telefone foi revogado, o estado local volta ao onboarding telefônico. Quando idade deixa de ser elegível, o fluxo retorna ao cartão fail-closed de Age Assurance.

## Implementação Android

O novo módulo `android/.../consent/` contém `Consent`, `ConsentDecision`, `ConsentStatus`, `ConsentParticipantStatus`, `ConsentGateway`, `ConsentApiClient` e `ConsentViewModel`. O cliente usa o mesmo Bearer token da sessão segura, serializa campos snake_case e gera um UUID novo para cada decisão. Os campos `expires_at`, `video_deadline` e `accepted_both_at` são apenas exibidos como dados controlados pelo servidor.

A `MainActivity` passou a instanciar o `ConsentViewModel` e a abrir a tela de Consent a partir de uma MatchIntent aceita. A tela mostra o estado de cada participante, permite aceitar ou recusar quando o participante atual está `PENDING`, comunica espera quando apenas uma pessoa aceitou e informa claramente que `ACCEPTED_BOTH` ainda não significa que vídeo esteja autorizado.

Nenhuma chamada Android foi adicionada para criar sessão de vídeo ou emitir token RTC. A próxima integração de vídeo deve consumir exclusivamente os endpoints server-side, aguardar autorização JIT e revalidar Consent, idade, telefone, bloqueio e prazo imediatamente antes de qualquer token.

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
| `app-debug.apk` | `cdc1269118083879ef694941914bf81fc74a0e48ae655a5c432e833a4d2b7835` |

Os testes PostgreSQL/migrations não foram executados neste sandbox por ausência de `DATABASE_URL_OWNER` e das demais URLs de banco de teste. Os novos testes DB de telefone, revogação, rate limiting e privilégios devem ser repetidos no CI ou em ambiente local com PostgreSQL configurado; isso é uma pendência ambiental, não uma falha dos testes unitários executados.

## Pendências externas e riscos

A validação ponta a ponta ainda depende de um provedor SMS real, de um dispositivo/emulador que receba o código, de um Web client ID Google real e de credenciais/ambiente para exercer MatchIntent e Consent com participantes reais. A renovação de sessão e a coordenação de nonce server-side continuam pendentes; não foi implementado nonce apenas no cliente para evitar proteção ilusória.

A criação de MatchIntent de saída ainda não possui uma UX Android porque o branch não oferece, nesta etapa, uma API de descoberta de candidatos/perfis para selecionar o `receiver_id`. A inbox recebida e a resposta de intenções estão integradas; a origem da intenção permanece dependente de uma tela/API de descoberta futura.

A sessão de vídeo, LiveKit/RTC, notificações, persistência de conversas, rate limiting específico do chat, observabilidade, moderação operacional e execução comprovada das migrations Up/Down/Up ainda precisam ser concluídos. Os avisos de depreciação de `EncryptedSharedPreferences`/`MasterKey` devem ser revisados antes da release.

## Próximo passo recomendado

Validar telefone, MatchIntent e Consent em dispositivo com ambiente real. Em seguida, implementar o cliente Android de Video Session somente para Consent `ACCEPTED_BOTH`, usando a API de criação de sessão e emissão de token do backend, com tratamento explícito de `VIDEO_NOT_AUTHORIZED`, `PHONE_VERIFICATION_REQUIRED`, `AGE_ASSURANCE_REQUIRED`, `RATE_LIMITED` e revogação. A implementação não deve iniciar câmera, WebRTC ou LiveKit antes da autorização JIT server-side.

## Invariantes preservados

Nenhuma chave OpenAI ou segredo foi incluído no Android ou no repositório. O `OPENAI_API_KEY` continua exclusivamente no backend. O único branch utilizado foi `continuity`; não houve merge ou push na `main`, nem force-push. O Android mantém HTTPS obrigatório em release, sessão segura local e comportamento fail-closed para qualquer estado restrito desconhecido ou não aprovado.
