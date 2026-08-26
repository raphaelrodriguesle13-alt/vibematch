# Handoff Manus → ChatGPT — VibeMatch

Atualizado em **2026-08-26** após a integração Android Play Billing sobre o backend cooperativo de Billing/RTDN na branch exclusiva `continuity`.

## Resumo da entrega

Esta etapa adiciona ao caminho Android já concluído de autorização de Video Session/RTC uma tela de Premium com Google Play Billing client-side. O usuário pode consultar o produto, iniciar compra ou restaurar, mas o app só exibe Premium depois da confirmação do entitlement pelo backend. O fluxo RTC anterior permanece controlado por token JIT e permissões runtime.

O fluxo autenticado permanece **Perfil → Age Assurance → Telefone → Chat → MatchIntent → Consent → Video Session → RTC**. O Android apenas solicita operações e renderiza estados retornados. Identidade, elegibilidade, telefone, idade, bloqueios, participantes, validade, `video_deadline`, revogação, room, identidade LiveKit, grants, TTL e autorização do token continuam sob responsabilidade do backend e do banco.

> **Fonte de verdade:** o cliente Android não aprova localmente idade, telefone, matchmaking, consentimento, vídeo, entitlement, room ou punições. O backend LiveKit é o único lugar que conhece a chave e o segredo de assinatura.

## Estado do Git

| Item                              | Valor                                                            |
| --------------------------------- | ---------------------------------------------------------------- |
| Repositório                       | `raphaelrodriguesle13-alt/vibematch`                             |
| Branch utilizada                  | `continuity`                                                     |
| HEAD publicado antes do lote RTC  | `5cf646e` — `feat: add Android community safety controls`        |
| HEAD da implementação Android RTC | `5f8c3a2` — `feat: add Android LiveKit RTC call flow`            |
| HEAD da documentação inicial RTC  | `5fbd908` — `docs: document Android LiveKit integration`         |
| HEAD do ajuste Jest/signer        | `72efdb3` — `test: run LiveKit signer under Jest ESM`            |
| HEAD antes desta continuação RTC  | `c40f683` — `docs: refresh RTC handoff after rebase`             |
| HEAD da continuação Android       | `5cdd254` — `fix: harden Android RTC lifecycle and revocation`   |
| HEAD cooperativo antes do Billing | `30ec31b` — providers SMS/Age Assurance e runtime production     |
| HEAD local do lote Billing        | `b87dced` — `feat: add server-authorized Android Play Billing`   |
| HEAD do hardening de callbacks    | `2ddaffa` — `fix: ignore stale Play Billing callbacks`           |
| HEAD dos ajustes de gates         | `9530af4` — `style: align cooperative provider tests with gates` |

| Publicação | Deve ser feita somente em `origin/continuity`, sem force-push e sem tocar na `main` |

O `MANUS_HANDOFF.md` é o commit documental imediatamente posterior ao lote Android e aos ajustes mínimos de testes cooperativos. O SHA do commit final deste arquivo será confirmado com `git rev-parse HEAD` após a publicação; a mensagem de entrega registra esse valor sem ambiguidade.

## Commits relevantes

| Commit    | Descrição                                            |
| --------- | ---------------------------------------------------- |
| `6f9b44f` | `feat: add LiveKit JIT token provider`               |
| `719db57` | `test: verify LiveKit JIT token claims`              |
| `3bc4183` | `docs: advance Manus Android RTC handoff`            |
| `5cf646e` | `feat: add Android community safety controls`        |
| `5f8c3a2` | `feat: add Android LiveKit RTC call flow`            |
| `5fbd908` | `docs: document Android LiveKit integration`         |
| `72efdb3` | `test: run LiveKit signer under Jest ESM`            |
| `fff515e` | `style: format RTC handoff documentation`            |
| `253fce3` | `feat: add LiveKit room revocation adapter`          |
| `5d62cdb` | `feat: add video revocation reconciler`              |
| `fd6ae65` | `feat: add LiveKit runtime configuration`            |
| `939ecb2` | `docs: add LiveKit runtime URL`                      |
| `0d8f3a7` | `test: cover LiveKit room revocation`                |
| `3f29ccf` | `test: clean LiveKit room admin coverage`            |
| `713ccff` | `test: cover video revocation reconciliation`        |
| `5cdd254` | `fix: harden Android RTC lifecycle and revocation`   |
| `f23f611` | `test: align LiveKit revocation test contracts`      |
| `237925d` | `feat: add server-side billing service`              |
| `e481bc5` | `feat: add billing HTTP routes`                      |
| `566b731` | `feat: configure authenticated Google Play RTDN`     |
| `c2f2de9` | `test: cover server-side billing entitlement`        |
| `30ec31b` | `feat: add Didit age assurance provider`             |
| `b87dced` | `feat: add server-authorized Android Play Billing`   |
| `2ddaffa` | `fix: ignore stale Play Billing callbacks`           |
| `9530af4` | `style: align cooperative provider tests with gates` |

O commit `5f8c3a2` contém dependência, configuração, Manifest, gateway, ViewModel, tela Compose, wiring de moderação e testes Android RTC. O commit `5cdd254` reforça o lifecycle com `detach`/`onRelease` de renderers, parada centralizada em logout/saída/troca de sessão, desconexão em `VIDEO_NOT_AUTHORIZED` e bloqueio de controles de mídia antes de `CONNECTED`. O commit `72efdb3` é uma correção mínima de infraestrutura de testes: Jest passou a carregar `jose` ESM em Node 22 e o teste do signer verifica HS256 com `node:crypto`. Nenhuma regra de autorização ou lógica de produção do backend foi enfraquecida.

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

| `GET /api/billing/entitlement` | Restaurar entitlement já conhecido | `entitled` server-side; sem compra local não há concessão automática |
| `POST /api/billing/verify-purchase` | Validar compra Google Play | Envia somente `purchase_token`; Google Play Developer API fica no backend |

## Google Play Billing Android

O commit `b87dced` adiciona `com.android.billingclient:billing:9.1.0`, uma única conexão `BillingClient`, consulta de `ProductDetails`, compra de assinatura, listener de atualizações, consulta de compras ativas e acknowledge apenas depois da validação server-side. A tela Premium tem estados `CONNECTING`, `READY`, `PURCHASING`, `WAITING_FOR_PURCHASE`, `RESTORING`, `VALIDATING`, `SUCCESS`, `ERROR`, `SIGNED_OUT` e `NOT_CONFIGURED`, com mensagens públicas e retry. O commit `2ddaffa` ignora callbacks atrasados depois de reset/logout.

O contrato usado pelo Android é `POST /api/billing/verify-purchase` com `{ "purchase_token": "..." }` e `GET /api/billing/entitlement`. O backend publicado por ChatGPT autentica JWT e sessão ativa, consulta o verificador Google server-side, mantém o entitlement e responde `data.entitled`, `data.plan`, `data.status` e `data.current_period_end`. O Android nunca decide a legitimidade da compra, não persiste o purchase token e não libera Premium com base apenas no callback Play, SKU ou preço. A restauração usa compras ativas do Play e, quando não há compra local, consulta apenas o entitlement já registrado pelo servidor.

O endpoint de validação só é considerado utilizável quando `API_BASE_URL` é HTTPS, inclusive em debug; com API HTTP local os botões de compra/restauração permanecem bloqueados. `BILLING_PRODUCT_ID` é obrigatório para build release. O produto e o caminho podem ser informados por propriedades Gradle; nenhum segredo ou service account Google Play entra no `BuildConfig` ou APK. As notas verificadas estão em [`docs/GOOGLE_PLAY_BILLING_ANDROID_NOTES.md`](GOOGLE_PLAY_BILLING_ANDROID_NOTES.md) e o guia operacional em [`android/README.md`](../android/README.md).

## Implementação RTC Android

A dependência é `io.livekit:livekit-android:2.28.1`, com JitPack no `dependencyResolutionManagement`. `LiveKitRtcRoomGateway` encapsula `LiveKit.create(applicationContext)`, `Room.connect(serverUrl, token)`, `disconnect/release`, inicialização de `SurfaceViewRenderer`, tracks local/remoto e eventos `Connected`, `Reconnecting`, `Reconnected`, `FailedToConnect`, `Disconnected`, participantes e tracks. O AndroidView usa `onRelease` para desanexar renderer; a sala, tracks e renderers são removidos em saída, falha terminal, logout, troca de sessão e bloqueio confirmado.

O `VideoSessionViewModel` entrega o token ao `RtcRoomViewModel` por callback transitório. O valor bruto não entra no estado Compose, em `SharedPreferences`, `DataStore`, `SavedStateHandle`, logs, analytics ou crash metadata. O indicador exposto é apenas booleano e o handoff é consumido uma vez; após erro, desconexão ou saída, a UI exige nova emissão JIT.

A tela solicita `CAMERA` e `RECORD_AUDIO` somente no clique **Entrar na chamada**, depois da credencial JIT e antes de conectar. Se uma permissão for negada, não há `Room.connect`, câmera, microfone ou publicação de mídia. Depois de conectada, a chamada exibe renderers local/remoto, quantidade de participantes, controles explícitos de mute/câmera, encerramento e acesso a Bloquear/denunciar. A conexão não liga mídia automaticamente.

`LIVEKIT_URL` é um endpoint público vindo de BuildConfig. Em debug vazio é permitido para demonstrar erro visível e fail-closed; em release o Gradle exige `wss://`. Nenhum fallback de endpoint, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` ou segredo OpenAI foi adicionado ao Android.

## Moderação durante a chamada

`ModerationViewModelFactory` recebe `onBlocked = rtcRoomViewModel::disconnect`. O callback só ocorre depois da confirmação positiva do backend, conforme os testes existentes. Ao abrir moderação durante uma chamada, o Android encerra a sala local imediatamente; a operação server-side continua responsável por revogar MatchIntent, Consent e Video Session do par. Report permanece acessível e encaminha o `session_id` atual quando disponível. Se uma tentativa de emissão retornar `VIDEO_NOT_AUTHORIZED`, `VideoSessionViewModel` também chama o callback de revogação, que encerra o RTC. No backend, o reconciliador termina a room LiveKit antes de marcar a sessão como revogada e mantém `revocation_pending=true` em falha para permitir retry. O Android não calcula severidade nem aplica punição.

## Testes e builds

Os resultados abaixo foram obtidos no sandbox, com código de aplicação publicado nos commits listados e sem credenciais reais:

| Comando/checagem              | Resultado                       |
| ----------------------------- | ------------------------------- |
| `npm run typecheck`           | Aprovado                        |
| `npm run lint`                | Aprovado                        |
| `npm run format:check`        | Aprovado                        |
| `npm run test:unit`           | Aprovado: 20 suítes e 93 testes |
| `./gradlew testDebugUnitTest` | Aprovado: 13 suítes e 62 testes |

| `./gradlew :app:compileDebugKotlin` | Aprovado |
| `./gradlew :app:assembleDebug` | Aprovado |
| `./gradlew :app:lintDebug` | Aprovado |
| `./gradlew :app:bundleRelease` | Aprovado com HTTPS, `wss://` e `BILLING_PRODUCT_ID` |
| Release com LiveKit `https://...` | Rejeitado: `Release LIVEKIT_URL must use wss://` |
| Release sem `BILLING_PRODUCT_ID` | Rejeitado: `Release BILLING_PRODUCT_ID must be configured` |
| Release com `LIVEKIT_URL=https://...` | Rejeitado conforme esperado: `Release LIVEKIT_URL must use wss://` |
| Release com API HTTPS e `LIVEKIT_URL=wss://...` | Aprovado: `BUILD SUCCESSFUL` |
| Varredura Android de segredos | Aprovada; nenhum padrão de chave/segredo encontrado |
| `git diff --check` | Aprovado |

O APK debug está em `android/app/build/outputs/apk/debug/app-debug.apk`.

| Artefato          | SHA-256                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `app-debug.apk`   | `dd0cc6a94a2f73b5ac75250423e4b6ab1bc1ef53c7729d2deb65098581423f5a` |
| `app-release.aab` | `55899e9db3e300ada91b98bb6ad24b976e464022323bb2ab770374526764ae34` |

A suíte PostgreSQL/migrations não foi executada neste sandbox por ausência de `DATABASE_URL_OWNER` e das demais URLs de banco de teste. Os testes DB de telefone, revogação, rate limiting, privilégios, Billing e imutabilidade devem ser repetidos no CI ou em ambiente local com PostgreSQL configurado. Isso é uma limitação ambiental, não uma falha dos gates unitários executados.

## Riscos e validação pendente

A validação ponta a ponta ainda depende de backend LiveKit configurado, `LIVEKIT_API_URL` server-side, URL pública `wss://`, Web client ID Google real, produto/credenciais Google Play, provedor SMS, dispositivo/emulador e pelo menos duas contas autenticadas. É necessário confirmar mídia local/remota, expiração de token, revogação durante chamada, bloqueio durante chamada, reconexão transitória, compra/restore e falha de autorização em ambiente real.

Renovação de sessão, observabilidade, persistência de conversas, moderação operacional, produto/licença no Play Console, assinatura do AAB e execução comprovada de migrations Up/Down/Up permanecem pendentes antes da release. Avisos de depreciação de `EncryptedSharedPreferences`/`MasterKey` também devem ser revisados; a migração não foi forçada nesta etapa para evitar regressão de sessão. O cliente não deve ganhar autoridade local para contornar esses gates.

## Próximo passo para o ChatGPT

Depois de publicar este handoff somente em `continuity`, o ChatGPT deve validar o Billing com produto Google Play real/teste, duas contas e backend production, confirmar `verify-purchase`/RTDN/entitlement e executar o E2E conjunto de compra, restauração, expiração, revogação e RTC. Registrar apenas logs sanitizados, sem purchase token, token LiveKit ou PII.

## Invariantes preservados

Nenhuma chave OpenAI, chave LiveKit ou segredo foi incluído no Android ou no repositório. `OPENAI_API_KEY` e o segredo LiveKit permanecem exclusivamente no backend. O único branch utilizado foi `continuity`; não houve merge ou push na `main`, force-push, reset destrutivo ou relaxamento de autorização. O Android mantém HTTPS obrigatório em release, `wss://` obrigatório para LiveKit em release, armazenamento seguro de sessão, token RTC transitório e comportamento fail-closed para qualquer estado restrito desconhecido ou não aprovado.
