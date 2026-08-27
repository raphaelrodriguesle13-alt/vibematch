# Handoff Manus → ChatGPT — VibeMatch Android

Atualizado em **2026-08-27** após a continuação exclusiva na branch `continuity`. Esta entrega manteve o backend como autoridade para Auth, Age Assurance, telefone, MatchIntent, Consent, Video Session, LiveKit, moderação, Block, Billing e entitlement.

## Escopo e estado do Git

O objetivo desta etapa foi aproximar o cliente Android de um AAB release-ready, reforçando o Play Billing server-authorized, o Age Assurance hosted, a UX de estados vazios e retry, o lifecycle do RTC e os gates de segurança de release. O rebase obrigatório preservou os commits cooperativos publicados entre o HEAD inicial e o trabalho local; não houve reset destrutivo, force-push, alteração da `main` ou alteração da lógica de produção backend.

| Item                                  | Valor                                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Repositório                           | `raphaelrodriguesle13-alt/vibematch`                                                                 |
| Branch exclusiva                      | `continuity`                                                                                         |
| HEAD inicial desta continuação        | `ad25840923e00663e83365b606bd5af8ec81942f` — `test: assert age assurance column privileges`          |
| HEAD cooperativo encontrado no rebase | `a2a39998488de7283c5b8541e0676180916ec025` — `style(config): apply production validation formatting` |
| HEAD local do plano/runner E2E        | `4710982` — `test(android): add sanitized e2e preflight`                                             |
| Publicação permitida                  | Somente `origin/continuity`, sem force-push                                                          |

Durante os rebases, `origin/continuity` avançou do HEAD inicial até `a2a3999`, incluindo hardening cooperativo de JWT, rotação de `kid` e validação fail-closed de configuração de produção. O trabalho Android e a matriz E2E foram preservados por `stash`, `rebase origin/continuity` e `stash pop`. Nenhum arquivo de produção backend foi alterado nesta etapa.

## Commits desta entrega

| Commit                      | Descrição                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `913da41`                   | `fix(android): harden billing callback lifecycle`                                                                             |
| `e20ff8f`                   | `feat(android): add hosted age assurance flow`                                                                                |
| `59302db`                   | `build(android): reject local release endpoints`                                                                              |
| `057e199`                   | `style: align cooperative provider test formatting`                                                                           |
| `4710982`                   | `test(android): add sanitized e2e preflight`                                                                                  |
| `338d9ea`                   | `docs(android): add real e2e release plan`                                                                                    |
| Commit documental posterior | Atualiza este handoff com o inventário final; o SHA da branch deve ser confirmado com `git rev-parse HEAD` após a publicação. |

Os arquivos Android modificados foram `Billing.kt`, `BillingTest.kt`, `MainActivity.kt`, `ProfileApiClient.kt`, `ProfileModels.kt`, `ProfileViewModel.kt`, `ProfileApiClientTest.kt`, `ProfileViewModelTest.kt` e `android/app/build.gradle.kts`. A documentação alterada foi `android/README.md`, `docs/CHANGELOG.md` e este handoff. Os três testes backend formatados foram `tests/auth/twilio-verify.test.ts`, `tests/profile/age-webhook-reconciler.test.ts` e `tests/profile/didit.test.ts`.

## Contratos Android implementados

O fluxo autenticado continua sendo **Perfil → Age Assurance → Telefone → Chat → MatchIntent → Consent → Video Session → RTC**. O Android envia requisições autenticadas e renderiza respostas; não calcula nem persiste autorização crítica.

| Capacidade    | Contrato usado pelo Android                                                                         | Invariante preservada                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Perfil        | `GET /api/interests`, `GET /api/profile`, `PUT /api/profile`                                        | Interesses, validação, bloqueio, suspensão e completude vêm do backend.                                  |
| Age Assurance | `GET /api/age-assurance/status`, `POST /api/age-assurance/start`, `POST /api/age-assurance/refresh` | Somente `APPROVED` libera recursos restritos; `UNKNOWN`, erro e indisponibilidade permanecem bloqueados. |
| Telefone      | `POST /auth/phone/start`, `POST /auth/phone/confirm`                                                | `phone_verified` só muda após resposta server-side positiva.                                             |
| MatchIntent   | `GET /api/match-intents/incoming`, `POST /api/match-intents/:id/respond`                            | Identidade, elegibilidade, validade e decisão final são server-side.                                     |
| Consent       | `POST /api/consents`, `POST /api/consents/:id/decision`                                             | Decisão mútua e `request_id` são controlados pelo backend.                                               |
| Video Session | `POST /api/video/sessions`, `POST /api/video/sessions/:id/token`                                    | Corpo sem `room`/`identity`; sessão e token são revalidados e emitidos pelo backend.                     |
| Moderação     | `POST /api/blocks`, `POST /api/reports`                                                             | Block confirmado encerra RTC local; severidade e punição não são decididas no Android.                   |
| Billing       | `POST /api/billing/verify-purchase` com `{ purchase_token }`, `GET /api/billing/entitlement`        | Premium somente após `data.entitled=true` server-side; Google Play Developer API permanece no backend.   |

### Age Assurance hosted

Quando o status server-side é `NOT_STARTED`, `ProfileViewModel` chama `POST /api/age-assurance/start`. O cliente aceita somente `PENDING` com `verification_url` em HTTPS e abre essa URL apenas depois da validação de esquema. O Android não marca aprovação, não interpreta decisão do provedor e não persiste a URL fora do estado transitório da tela.

Enquanto o status é `PENDING`, o usuário pode solicitar `POST /api/age-assurance/refresh`. O retorno do navegador é tratado por `ActivityResult` e pelo evento `ON_RESUME`, ambos acionando novo refresh no backend. Não foi inventado um app link/deep link Android, pois o contrato backend atual não publica uma URI de retorno; portanto, o cliente não deve ser descrito como tendo callback deep-link implementado. Respostas `APPROVED`, `REJECTED` e `UNKNOWN` vêm exclusivamente do servidor. Respostas tardias após reset ou troca de token são descartadas por geração de requisição e token autenticado.

### Billing server-authorized

O Play Billing usa `com.android.billingclient:billing:9.1.0`, consulta de produto de assinatura, compra, restore, callbacks e acknowledgement. O fluxo é estritamente **Google Play → purchase token transitório → HTTPS backend → entitlement server-side → UI → acknowledgement**, e nenhum estado `PURCHASED`, SKU, preço ou callback isolado concede Premium.

O hardening atual deduplica callbacks concorrentes e sequenciais no ciclo ativo por `purchaseToken`, ignora callbacks após `reset`, logout ou troca de sessão, impede `start` durante `WAITING_FOR_PURCHASE`, `RESTORING`, `VALIDATING` ou outras operações ativas, e descarta respostas de uma geração anterior. O token não aparece em `BillingUiState`, `SharedPreferences`, `DataStore`, `SavedStateHandle`, logs, analytics ou crash metadata. Se a validação falhar, o entitlement for revogado ou o acknowledgement falhar, a UI permanece sem Premium.

A restauração consulta as compras ativas do Play e, quando não há compra local correspondente, consulta somente `GET /api/billing/entitlement`. Não há polling de RTDN no Android; RTDN permanece webhook autenticado do backend. Transporte Billing não HTTPS é bloqueado, e `BILLING_PRODUCT_ID` é obrigatório em release.

### RTC, dispositivo e lifecycle

A credencial LiveKit continua sendo JIT, transitória e entregue por callback em memória. O Android não recebe chave ou segredo LiveKit, não monta `room`/`identity` no request e não persiste token. Câmera e microfone só são solicitados no clique explícito de entrada, depois de token fresco; publicação automática não ocorre. Controls de câmera/microfone só ficam habilitados em `CONNECTED`.

`LiveKitRtcRoomGateway` encerra e libera room, tracks, eventos e renderers em saída, falha terminal, desconexão, logout, troca de sessão, Block confirmado, revogação de autorização e `ON_STOP` da Activity. `AndroidView` usa `onRelease` para detach/release. Ao retornar de background ou de uma permissão negada, uma nova autorização JIT e ação explícita são necessárias.

A UX recebeu retries nos estados vazios de MatchIntent, Consent e criação de Video Session, mensagens públicas para erro/offline/provider indisponível e loading visível. Os retries repetem apenas chamadas server-side já previstas; nenhum deles contorna Age Assurance, telefone, Consent, Video, moderação ou entitlement.

## Gates executados

Os gates foram executados no sandbox com Java 21 configurando toolchain Android 17, Android SDK 35 e sem credenciais reais de Google, Play, Didit, Twilio ou LiveKit.

| Gate                                                                                    | Resultado                                                                                  |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run typecheck`                                                                     | Aprovado                                                                                   |
| `npm run lint`                                                                          | Aprovado                                                                                   |
| `npm run format:check`                                                                  | Aprovado                                                                                   |
| `npm run test:unit`                                                                     | Aprovado: **25 suítes, 116 testes**                                                        |
| `./gradlew :app:testDebugUnitTest`                                                      | Aprovado: **13 suítes, 76 testes**                                                         |
| `./gradlew :app:compileDebugKotlin`                                                     | Aprovado                                                                                   |
| `./gradlew :app:assembleDebug`                                                          | Aprovado                                                                                   |
| `./gradlew :app:lintDebug`                                                              | Aprovado                                                                                   |
| `./gradlew :app:bundleRelease` com API HTTPS, LiveKit WSS e produto público placeholder | Aprovado; AAB unsigned buildable                                                           |
| Release com API HTTP                                                                    | Rejeitado: `Release API_BASE_URL must use HTTPS`                                           |
| Release com API em `localhost`                                                          | Rejeitado: `Release API_BASE_URL must not use a local host`                                |
| Release com LiveKit HTTP                                                                | Rejeitado: `Release LIVEKIT_URL must use wss://`                                           |
| Release com LiveKit em `localhost`                                                      | Rejeitado: `Release LIVEKIT_URL must not use a local host`                                 |
| Release sem `BILLING_PRODUCT_ID`                                                        | Rejeitado: `Release BILLING_PRODUCT_ID must be configured`                                 |
| Release com caminho Billing relativo                                                    | Rejeitado: `Release BILLING_VALIDATION_PATH must be an absolute API path`                  |
| `git diff --check`                                                                      | Aprovado antes da documentação; repetir após o commit documental                           |
| Secret scan e scan de persistência Android                                              | Aprovado; nenhum segredo encontrado e nenhum sink de persistência/log para tokens críticos |
| `tools/android-e2e-preflight.sh`                                                        | Executado; `BLOCKED / no_authorized_device` sem coletar tokens ou PII                      |
| AVD Google Play API 35 headless                                                         | Provisionado, mas boot falhou após 300 s sem `/dev/kvm`; não é evidência de E2E            |

A implementação de segurança de release aceita placeholders públicos apenas para demonstrar o build. Isso não configura API real, produto real, endpoint LiveKit real ou credencial de assinatura.

## Artefatos e hashes

Os artefatos foram regenerados no gate final antes do commit documental. O AAB é construível, mas não está assinado.

| Artefato             | Caminho                                                    | SHA-256                                                            |
| -------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| Debug APK            | `android/app/build/outputs/apk/debug/app-debug.apk`        | `36b43ad92ef40baa782163dc277fcf9852063fc74914dacf0c013e80d83eb4c9` |
| Release AAB unsigned | `android/app/build/outputs/bundle/release/app-release.aab` | `9bbd2ccc94187ed898375aa070b47013506666fae78f05286814a4dbec044c14` |

## Classificação de readiness e validação externa

| Área                             | Classificação                                 | Observação                                                                                                                          |
| -------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Billing Android client flow      | **IMPLEMENTED + TESTED**                      | Contrato, entitlement server-side, restore sem compra local, deduplicação, stale callback e fail-closed cobertos por testes locais. |
| Play sandbox/Play Console        | **IMPLEMENTED, NEEDS REAL CREDENTIAL/DEVICE** | Não há produto, licença de teste, conta Play Console ou dispositivo neste ambiente; nenhuma compra real foi alegada.                |
| Age Assurance hosted UX          | **IMPLEMENTED + TESTED**                      | Start/refresh, URL HTTPS, estados e respostas tardias têm cobertura de contrato/ViewModel.                                          |
| Didit/provider Age Assurance E2E | **IMPLEMENTED, NEEDS REAL CREDENTIAL/DEVICE** | Requer API key/workflow, webhook autenticado, navegador/dispositivo e decisão real; não foi executado.                              |
| Auth/Google OIDC Android E2E     | **IMPLEMENTED, NEEDS REAL CREDENTIAL/DEVICE** | O contrato e Credential Manager existem, mas não há Web client ID configurado nem validação física.                                 |
| LiveKit/RTC duas partes          | **IMPLEMENTED, NEEDS REAL CREDENTIAL/DEVICE** | Lifecycle, JIT e renderer cleanup têm testes locais; mídia, reconexão e revogação reais exigem duas contas e backend configurado.   |
| Block/Report                     | **IMPLEMENTED + TESTED**                      | UI e contratos server-side estão conectados; a confirmação depende do backend e o E2E operacional não foi executado.                |
| AAB                              | **IMPLEMENTED, NEEDS REAL CREDENTIAL/DEVICE** | Build unsigned aprovado; assinatura, keystore, Play App Signing e Play Console ainda são externos.                                  |
| Notificações Android             | **NOT IMPLEMENTED**                           | Nenhum contrato backend seguro de registro/entrega foi observado; não foi inventada autoridade local.                               |
| Deep link Age Assurance          | **NOT IMPLEMENTED**                           | O retorno atual é ActivityResult/`ON_RESUME`; não há app link/deep link backend publicado.                                          |
| Renovação de sessão              | **NOT IMPLEMENTED**                           | O backend não expõe contrato cliente de refresh; HTTP 401 encerra a sessão de forma fail-closed.                                    |

O preflight reproduzível está em `tools/android-e2e-preflight.sh`; ele aceita um APK por `APK_PATH`, usa `ADB_BIN`/`ANDROID_SDK_ROOT` sem coletar credenciais e retorna `BLOCKED` quando não há dispositivo autorizado. O AVD Google Play API 35 foi criado, mas a máquina não expõe `/dev/kvm` e o boot headless não concluiu. Os testes de banco continuam dependentes de `DATABASE_URL_OWNER` e demais URLs PostgreSQL. A migração de `EncryptedSharedPreferences`/`MasterKey` deprecados não foi forçada, pois preservar a sessão existente com uma migração segura e testada é preferível a uma troca cega antes da release. Também permanecem necessários observabilidade sanitizada, políticas operacionais de moderação, revisão de privacidade, assinatura e configuração de produção.

> **ANDROID RELEASE READINESS: 74%**

O percentual é deliberadamente conservador. O cliente, os contratos, os gates locais, os estados fail-closed e o AAB unsigned estão substancialmente implementados, mas a release não pode ser declarada pronta sem assinatura, Play sandbox, dispositivo real, duas contas para RTC, Google OIDC real, Didit/Twilio/LiveKit configurados, ambiente PostgreSQL e validação de produção do backend cooperativo.

## Próximo passo recomendado ao ChatGPT

O próximo passo é conectar um dispositivo Android com Google Play ou um device lab que exponha ADB, além de publicar um AAB assinado em Play Internal Testing. Com o ambiente disponível, executar a matriz em `docs/ANDROID_E2E_RELEASE_PLAN.md`: Google login real, Age Assurance/Didit, telefone/Twilio, MatchIntent, Consent, RTC LiveKit de duas partes, Block/revogação e Billing/restore/revogação. Registrar apenas estados públicos e confirmações server-side, sem purchase token, token LiveKit, OTP ou PII.

## Referências técnicas

[1]: https://developer.android.com/google/play/billing/integrate 'Google Play Billing integration'
[2]: https://developers.google.com/chromeos/app-development/publish/play-billing-backend 'Google Play Billing backend validation'
[3]: https://docs.livekit.io/transport/sdk-platforms/android/ 'LiveKit Android quickstart'
[4]: https://docs.livekit.io/intro/basics/connect/ 'LiveKit connecting to a room'
[5]: https://github.com/livekit/client-sdk-android 'LiveKit Android SDK'
