# Handoff Manus → ChatGPT — VibeMatch

Atualizado em **2026-08-26** após a integração Android RTC na branch exclusiva `continuity`.

## Resumo da entrega

Esta etapa conclui o caminho Android de autorização de Video Session até uma chamada RTC LiveKit controlada pelo backend. Depois de perfil completo, Age Assurance aprovado, telefone confirmado, MatchIntent aceita e Consent em `ACCEPTED_BOTH`, o usuário pode criar a Video Session, solicitar explicitamente uma credencial JIT, conceder câmera/microfone em runtime e entrar na chamada.

O fluxo autenticado permanece **Perfil → Age Assurance → Telefone → Chat → MatchIntent → Consent → Video Session → RTC**. O Android apenas solicita operações e renderiza estados retornados. Identidade, elegibilidade, telefone, idade, bloqueios, participantes, validade, `video_deadline`, revogação, room, identidade LiveKit, grants, TTL e autorização do token continuam sob responsabilidade do backend e do banco.

> **Fonte de verdade:** o cliente Android não aprova localmente idade, telefone, matchmaking, consentimento, vídeo, entitlement, room ou punições. O backend LiveKit é o único lugar que conhece a chave e o segredo de assinatura.

## Estado do Git

| Item                              | Valor                                                     |
| --------------------------------- | --------------------------------------------------------- |
| Repositório                       | `raphaelrodriguesle13-alt/vibematch`                      |
| Branch utilizada                  | `continuity`                                              |
| HEAD publicado antes do lote RTC  | `5cf646e` — `feat: add Android community safety controls` |
| HEAD da implementação Android RTC | `5f8c3a2` — `feat: add Android LiveKit RTC call flow`     |
| HEAD da documentação inicial RTC  | `5fbd908` — `docs: document Android LiveKit integration`  |
| HEAD do ajuste Jest/signer        | `72efdb3` — `test: run LiveKit signer under Jest ESM`     |
| HEAD antes deste handoff final    | `fff515e` — `style: format RTC handoff documentation`     |

| Publicação | Deve ser feita somente em `origin/continuity`, sem force-push e sem tocar na `main` |

O `MANUS_HANDOFF.md` é o commit documental imediatamente posterior ao HEAD indicado acima. O SHA do commit final deste arquivo deve ser confirmado com `git rev-parse HEAD` após a publicação; a mensagem de entrega registra esse valor sem ambiguidade.

## Commits relevantes

| Commit    | Descrição                                     |
| --------- | --------------------------------------------- |
| `6f9b44f` | `feat: add LiveKit JIT token provider`        |
| `719db57` | `test: verify LiveKit JIT token claims`       |
| `3bc4183` | `docs: advance Manus Android RTC handoff`     |
| `5cf646e` | `feat: add Android community safety controls` |
| `5f8c3a2` | `feat: add Android LiveKit RTC call flow`     |
| `5fbd908` | `docs: document Android LiveKit integration`  |
| `72efdb3` | `test: run LiveKit signer under Jest ESM`     |
| `fff515e` | `style: format RTC handoff documentation`     |

O commit `5f8c3a2` contém dependência, configuração, Manifest, gateway, ViewModel, tela Compose, wiring de moderação e testes Android RTC. O commit `72efdb3` é uma correção mínima de infraestrutura de testes: Jest passou a carregar `jose` ESM em Node 22 e o teste do signer verifica HS256 com `node:crypto`. Nenhuma regra de autorização ou lógica de produção do backend foi enfraquecida.

## Contratos HTTP integrados

| Endpoint                              | Uso Android                    | Regra preservada                                                    |
| ------------------------------------- | ------------------------------ | ------------------------------------------------------------------- |
| `GET /api/interests`                  | Catálogo do onboarding/perfil  | Catálogo e validação server-side                                    |
| `GET /api/profile`                    | Perfil existente ou onboarding | `404 PROFILE_NOT_FOUND` inicia onboarding; `401` encerra sessão     |
| `PUT /api/profile`                    | Criar/editar perfil            | Validação final no backend                                          |
| `GET /api/age-assurance/status`       | Gate etário                    | Somente `APPROVED` libera recursos restritos                        |
| `POST /auth/phone/start`              | Início SMS                     | `verification_id` somente no estado da tela                         |
| `POST /auth/phone/confirm`            | Confirmação SMS                | Dica local só muda após `{ ok: true, phone_verified: true }`        |
| `GET /api/match-intents/incoming`     | Inbox de solicitações          | Backend controla identidade, elegibilidade e validade               |
| `POST /api/match-intents/:id/respond` | Aceitar/recusar                | Envia somente `ACCEPTED` ou `DECLINED`                              |
| `POST /api/consents`                  | Criar Consent                  | Envia somente `match_intent_id`                                     |
| `POST /api/consents/:id/decision`     | Decidir Consent                | Envia decisão e `request_id` UUID novo                              |
| `POST /api/video/sessions`            | Criar sessão autorizada        | Envia somente `consent_id`                                          |
| `POST /api/video/sessions/:id/token`  | Emitir token JIT               | Corpo sem identity/room; backend revalida e assina                  |
| `POST /api/blocks`                    | Bloquear participante          | Backend revoga relações; Android encerra RTC local após confirmação |
| `POST /api/reports`                   | Denunciar participante         | Backend determina severidade e encaminhamento                       |

O Android trata `AGE_ASSURANCE_REQUIRED`, `PHONE_VERIFICATION_REQUIRED`, `VIDEO_NOT_AUTHORIZED`, `RATE_LIMITED`, HTTP 401, HTTP 429, indisponibilidade, respostas inválidas e estados desconhecidos sem liberar recursos localmente.

## Implementação RTC Android

A dependência é `io.livekit:livekit-android:2.28.1`, com JitPack no `dependencyResolutionManagement`. `LiveKitRtcRoomGateway` encapsula `LiveKit.create(applicationContext)`, `Room.connect(serverUrl, token)`, `disconnect/release`, inicialização de `SurfaceViewRenderer`, tracks local/remoto e eventos `Connected`, `Reconnecting`, `Reconnected`, `FailedToConnect`, `Disconnected`, participantes e tracks. A sala, tracks e renderers são removidos em saída, falha terminal, logout, troca de sessão e bloqueio confirmado.

O `VideoSessionViewModel` entrega o token ao `RtcRoomViewModel` por callback transitório. O valor bruto não entra no estado Compose, em `SharedPreferences`, `DataStore`, `SavedStateHandle`, logs, analytics ou crash metadata. O indicador exposto é apenas booleano e o handoff é consumido uma vez; após erro, desconexão ou saída, a UI exige nova emissão JIT.

A tela solicita `CAMERA` e `RECORD_AUDIO` somente no clique **Entrar na chamada**, depois da credencial JIT e antes de conectar. Se uma permissão for negada, não há `Room.connect`, câmera, microfone ou publicação de mídia. Depois de conectada, a chamada exibe renderers local/remoto, quantidade de participantes, controles explícitos de mute/câmera, encerramento e acesso a Bloquear/denunciar. A conexão não liga mídia automaticamente.

`LIVEKIT_URL` é um endpoint público vindo de BuildConfig. Em debug vazio é permitido para demonstrar erro visível e fail-closed; em release o Gradle exige `wss://`. Nenhum fallback de endpoint, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` ou segredo OpenAI foi adicionado ao Android.

## Moderação durante a chamada

`ModerationViewModelFactory` recebe `onBlocked = rtcRoomViewModel::disconnect`. O callback só ocorre depois da confirmação positiva do backend, conforme os testes existentes. Ao abrir moderação durante uma chamada, o Android encerra a sala local imediatamente; a operação server-side continua responsável por revogar MatchIntent, Consent e Video Session do par. Report permanece acessível e encaminha o `session_id` atual quando disponível. O Android não calcula severidade nem aplica punição.

## Testes e builds

Os resultados abaixo foram obtidos no sandbox, com código de aplicação publicado nos commits listados e sem credenciais reais:

| Comando/checagem                                | Resultado                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `npm run typecheck`                             | Aprovado                                                           |
| `npm run lint`                                  | Aprovado                                                           |
| `npm run format:check`                          | Aprovado                                                           |
| `npm run test:unit`                             | Aprovado: 14 suítes e 68 testes                                    |
| `./gradlew testDebugUnitTest`                   | Aprovado                                                           |
| `./gradlew :app:compileDebugKotlin`             | Aprovado                                                           |
| `./gradlew :app:assembleDebug`                  | Aprovado                                                           |
| `./gradlew :app:lintDebug`                      | Aprovado                                                           |
| Release com `LIVEKIT_URL=https://...`           | Rejeitado conforme esperado: `Release LIVEKIT_URL must use wss://` |
| Release com API HTTPS e `LIVEKIT_URL=wss://...` | Aprovado: `BUILD SUCCESSFUL`                                       |
| Varredura Android de segredos                   | Aprovada; nenhum padrão de chave/segredo encontrado                |
| `git diff --check`                              | Aprovado                                                           |

O APK debug está em `android/app/build/outputs/apk/debug/app-debug.apk`.

| Artefato        | SHA-256                                                            |
| --------------- | ------------------------------------------------------------------ |
| `app-debug.apk` | `9a1731acfc80b8311a1f379f985b2591c7678f522687357e30ade30e6d8943f4` |

A suíte PostgreSQL/migrations não foi executada neste sandbox por ausência de `DATABASE_URL_OWNER` e das demais URLs de banco de teste. Os testes DB de telefone, revogação, rate limiting, privilégios e imutabilidade devem ser repetidos no CI ou em ambiente local com PostgreSQL configurado. Isso é uma limitação ambiental, não uma falha dos gates unitários executados.

## Riscos e validação pendente

A validação ponta a ponta ainda depende de backend LiveKit configurado, URL pública `wss://`, Web client ID Google real, provedor SMS, dispositivo/emulador e pelo menos duas contas autenticadas. É necessário confirmar mídia local/remota, expiração de token, revogação durante chamada, bloqueio durante chamada, reconexão transitória e falha de autorização em ambiente real.

Renovação de sessão, observabilidade, persistência de conversas, moderação operacional e execução comprovada de migrations Up/Down/Up permanecem pendentes antes da release. Avisos de depreciação de `EncryptedSharedPreferences`/`MasterKey` também devem ser revisados. O cliente não deve ganhar autoridade local para contornar esses gates.

## Próximo passo para o ChatGPT

Publicar o commit deste handoff somente depois de `git fetch origin continuity`, revisar qualquer avanço cooperativo e executar os gates finais. Em seguida, validar com duas contas em um ambiente LiveKit real, registrar logs sanitizados de sucesso/falha sem token ou PII e decidir a política de renovação/expiração de sessão conforme os contratos server-side.

## Invariantes preservados

Nenhuma chave OpenAI, chave LiveKit ou segredo foi incluído no Android ou no repositório. `OPENAI_API_KEY` e o segredo LiveKit permanecem exclusivamente no backend. O único branch utilizado foi `continuity`; não houve merge ou push na `main`, force-push, reset destrutivo ou relaxamento de autorização. O Android mantém HTTPS obrigatório em release, `wss://` obrigatório para LiveKit em release, armazenamento seguro de sessão, token RTC transitório e comportamento fail-closed para qualquer estado restrito desconhecido ou não aprovado.
