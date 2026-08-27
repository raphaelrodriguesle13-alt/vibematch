# Handoff Manus → ChatGPT — VibeMatch Android

Atualizado em **2026-08-27** após a continuação exclusiva na branch `continuity`. Esta entrega manteve o backend como autoridade para Auth, Age Assurance, telefone, MatchIntent, Consent, Video Session, LiveKit, moderação, Block, Billing e entitlement.

## Escopo e estado do Git

O objetivo desta etapa foi concluir a integração Android do logout server-authorized com refresh token, sem enfraquecer o Play Billing server-authorized, o Age Assurance hosted, a UX de estados vazios e retry, o lifecycle do RTC, a navegação compacta/acessível, o runner reproduzível para sessão E2E e a renovação de sessão server-authorized. Os gates de segurança de release permaneceram fail-closed.
O rebase obrigatório preservou os commits cooperativos publicados entre o HEAD inicial e o trabalho local; não houve reset destrutivo, force-push, alteração da `main` ou alteração da lógica de produção backend.

| Item                                        | Valor                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Repositório                                 | `raphaelrodriguesle13-alt/vibematch`                                                        |
| Branch exclusiva                            | `continuity`                                                                                |
| HEAD inicial histórico da continuidade      | `ad25840923e00663e83365b606bd5af8ec81942f` — `test: assert age assurance column privileges` |
| HEAD inicial desta tarefa                   | `015d4b640a67718cbec51feaa8808b9c1e6c7773` — `test(android): add keystore refresh runner`   |
| HEAD cooperativo final encontrado no rebase | `67a7a53` — `test(auth): harden concurrency test cleanup`                                   |

| Commit do plano E2E na ancestralidade atual | `6558d04` — `docs(android): add real e2e release plan` |
| Commit do preflight E2E na ancestralidade atual | `4710982` — `test(android): add sanitized e2e preflight` |
| Commit do runner de sessão E2E | `7b6da8b` — `test(android): add manual e2e session runner` |
| HEAD local após avanço Android/backend | `6c93835` — `fix(http): narrow sanitized error status safely` |
| HEAD final da etapa anterior | `e01866c` — `docs(android): document e2e runner and accessibility advance` |
| HEAD cooperativo base desta tarefa | `38d6373` — `test(auth): require refresh credential on Google login` |
| HEAD inicial da fase de revogação por refresh | `9e665ec` — `test(db): align restricted session invariants with active revocation` |
| Commit Android desta fase 1 | `97d1e43a` — `feat(android): harden refresh-token logout lifecycle` |
| Commit Android desta fase 2 | `f3bdda4e` — `fix(android): revoke expired sessions with refresh snapshot` |
| HEAD de código antes do handoff final | `f3bdda4e` — `fix(android): revoke expired sessions with refresh snapshot` |

| Publicação permitida | Somente `origin/continuity`, sem force-push |

Durante os rebases, `origin/continuity` avançou do HEAD inicial desta tarefa `015d4b6` até `67a7a53`, incluindo hardening cooperativo de JWT, rotação de `kid`, validação fail-closed de configuração de produção, observabilidade segura, readiness por privilégios mínimos, limites de conexão, smoke pós-deploy, documentação de timeouts/DB, refresh rotativo, revogação idempotente por refresh, bloqueio de entitlement para contas restritas, testes de Billing sob restrição, corrida suspensão/login fail-closed e limpeza de testes concorrentes.
O trabalho Android e a matriz E2E foram preservados por `stash`, `rebase origin/continuity` e `stash pop`. A lógica de produção backend não foi reescrita nesta etapa; o único diff backend local adicional foi formatação e uma fixture de teste compatível com `exactOptionalPropertyTypes`.

## Commits desta entrega

| Commit     | Descrição                                                      |
| ---------- | -------------------------------------------------------------- |
| `913da41`  | `fix(android): harden billing callback lifecycle`              |
| `e20ff8f`  | `feat(android): add hosted age assurance flow`                 |
| `59302db`  | `build(android): reject local release endpoints`               |
| `057e199`  | `style: align cooperative provider test formatting`            |
| `4710982`  | `test(android): add sanitized e2e preflight`                   |
| `6558d04`  | `docs(android): add real e2e release plan`                     |
| `68a1c3f`  | `test(runtime): use ephemeral jwt smoke keys`                  |
| `7b6da8b`  | `test(android): add manual e2e session runner`                 |
| `34b3531`  | `fix(android): make chat navigation compact and accessible`    |
| `6c93835`  | `fix(http): narrow sanitized error status safely`              |
| `38d6373`  | `test(auth): require refresh credential on Google login`       |
| `97f64ce`  | `feat(android): add server-authorized session refresh`         |
| `a7157da`  | `test(auth): align refresh contract fixture with strict types` |
| `0a79e12`  | `docs(android): document server-authorized session refresh`    |
| `015d4b6`  | `test(android): add keystore refresh runner`                   |
| `c2ff52b`  | `ci(android): compile instrumented test artifact`              |
| `97d1e43a` | `feat(android): harden refresh-token logout lifecycle`         |
| `f3bdda4e` | `fix(android): revoke expired sessions with refresh snapshot`  |

| HEAD final de código desta fase | `f3bdda4e` — `fix(android): revoke expired sessions with refresh snapshot` |
| Commit documental base desta fase | `e95d05fe` — `docs(android): document refresh-token logout handoff` |

Os arquivos Android modificados foram `Billing.kt`, `BillingTest.kt`, `MainActivity.kt`, `ProfileApiClient.kt`, `ProfileModels.kt`, `ProfileViewModel.kt`, `ProfileApiClientTest.kt`, `ProfileViewModelTest.kt`, `auth/AuthRepository.kt`, `auth/AuthViewModel.kt`, `auth/SessionRefresh.kt`, `AuthRepositoryTest.kt`, `AuthViewModelTest.kt`, `SessionRefreshTest.kt`, `androidTest/SecureSessionStoreInstrumentedTest.kt` e `android/app/build.gradle.kts`.
A documentação alterada nesta fase foi `android/README.md`, `docs/CHANGELOG.md`, `docs/ANDROID_AUTH_REFRESH_NOTES.md`, `docs/ANDROID_E2E_RELEASE_PLAN.md` e este handoff. O backend cooperativo publicou o contrato de revogação por refresh antes da alteração Android; não foi necessário reescrever sua lógica de produção.

## Contratos Android implementados

O fluxo autenticado continua sendo **Perfil → Age Assurance → Telefone → Chat → MatchIntent → Consent → Video Session → RTC**. O Android envia requisições autenticadas e renderiza respostas; não calcula nem persiste autorização crítica.

| Capacidade          | Contrato usado pelo Android                                                                               | Invariante preservada                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth refresh/logout | `POST /auth/google`, `POST /auth/refresh` e `POST /auth/logout/refresh` com rotação/revogação server-side | Access JWT e refresh token são emitidos, rotacionados e revogados pelo backend; Android só transporta o refresh de forma transitória e armazena o par com proteção. |
| Perfil              | `GET /api/interests`, `GET /api/profile`, `PUT /api/profile`                                              | Interesses, validação, bloqueio, suspensão e completude vêm do backend.                                                                                             |
| Age Assurance       | `GET /api/age-assurance/status`, `POST /api/age-assurance/start`, `POST /api/age-assurance/refresh`       | Somente `APPROVED` libera recursos restritos; `UNKNOWN`, erro e indisponibilidade permanecem bloqueados.                                                            |
| Telefone            | `POST /auth/phone/start`, `POST /auth/phone/confirm`                                                      | `phone_verified` só muda após resposta server-side positiva.                                                                                                        |
| MatchIntent         | `GET /api/match-intents/incoming`, `POST /api/match-intents/:id/respond`                                  | Identidade, elegibilidade, validade e decisão final são server-side.                                                                                                |
| Consent             | `POST /api/consents`, `POST /api/consents/:id/decision`                                                   | Decisão mútua e `request_id` são controlados pelo backend.                                                                                                          |
| Video Session       | `POST /api/video/sessions`, `POST /api/video/sessions/:id/token`                                          | Corpo sem `room`/`identity`; sessão e token são revalidados e emitidos pelo backend.                                                                                |
| Moderação           | `POST /api/blocks`, `POST /api/reports`                                                                   | Block confirmado encerra RTC local; severidade e punição não são decididas no Android.                                                                              |
| Billing             | `POST /api/billing/verify-purchase` com `{ purchase_token }`, `GET /api/billing/entitlement`              | Premium somente após `data.entitled=true` server-side; Google Play Developer API permanece no backend.                                                              |

### Age Assurance hosted

Quando o status server-side é `NOT_STARTED`, `ProfileViewModel` chama `POST /api/age-assurance/start`. O cliente aceita somente `PENDING` com `verification_url` em HTTPS e abre essa URL apenas depois da validação de esquema. O Android não marca aprovação, não interpreta decisão do provedor e não persiste a URL fora do estado transitório da tela.

Enquanto o status é `PENDING`, o usuário pode solicitar `POST /api/age-assurance/refresh`. O retorno do navegador é tratado por `ActivityResult` e pelo evento `ON_RESUME`, ambos acionando novo refresh no backend. Não foi inventado um app link/deep link Android, pois o contrato backend atual não publica uma URI de retorno; portanto, o cliente não deve ser descrito como tendo callback deep-link implementado. Respostas `APPROVED`, `REJECTED` e `UNKNOWN` vêm exclusivamente do servidor. Respostas tardias após reset ou troca de token são descartadas por geração de requisição e token autenticado.

### Auth refresh server-authorized

O login Google agora exige que o backend entregue `session_jwt`, `refresh_token`, `expires_at` e `refresh_expires_at`; a ausência do par de refresh falha com `SESSION_ISSUANCE_FAILED`. O Android guarda o par por `SecureSessionStore`, usando `EncryptedSharedPreferences` protegido por `MasterKey` do Android Keystore, sem colocar o refresh token no `AuthUiState`, Compose, SavedState, logs ou analytics.

Todos os ApiClients autenticados compartilham um `OkHttpClient` com `SessionAuthenticator`; o `AuthApiClient` usa cliente separado e não aplica o Authenticator ao endpoint de refresh. Em HTTP 401, o `SessionRefreshCoordinator` faz uma única rotação single-flight por access token stale, valida usuário, tokens novos e expirações futuras, grava o par de forma atômica e permite no máximo uma repetição da requisição original. Respostas 401 posteriores não iniciam nova rotação.

Falha, expiração, reutilização, incoerência, logout ou troca de conta limpa as credenciais e aciona logout fail-closed. Respostas tardias não podem ressuscitar uma sessão anterior nem usar o token de uma conta diferente. O logout captura atomicamente o par, limpa localmente antes da rede, chama `/auth/logout/refresh` sem Authorization quando há refresh válido e usa Bearer legado somente sem refresh; clique duplicado é ignorado e uma geração antiga não pode limpar a conta nova. A cobertura local inclui concorrência, duplicata sequencial, 401, resposta incompleta, access expirado com refresh válido, 503, troca de conta, logout durante refresh e retry único; o E2E real ainda requer device lab e backend configurado.

### Logout por refresh server-authorized

O backend publica `POST /auth/logout/refresh` com `{ "refresh_token": "..." }`, sem header `Authorization`. O retorno `200 {"ok":true}` é idempotente e não revela se o token era conhecido; falhas de infraestrutura retornam `503 REVOCATION_UNAVAILABLE`. O Android usa um cliente sem Authenticator para essa chamada. O teste HTTP Android confirma método, endpoint, payload mínimo, ausência de Authorization e o mapeamento de 503.

O `AuthViewModel` usa `readLogoutSnapshot()` sincronizado no `SecureSessionStore`, limpa access/refresh e a UI antes de chamar a rede e mantém o refresh apenas no escopo transitório da coroutine. Se o access estiver expirado, o refresh ainda é revogado; respostas tardias da conta A não limpam nem ressuscitam a conta B. RTC e JIT são encerrados na ação de logout e também na expiração automática.

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

| Gate                                                                                   | Resultado                           |
| -------------------------------------------------------------------------------------- | ----------------------------------- |
| `npm run typecheck`                                                                    | Aprovado                            |
| `npm run lint`                                                                         | Aprovado                            |
| `npm run format:check`                                                                 | Aprovado                            |
| `npm run test:unit`                                                                    | Aprovado: **32 suítes, 160 testes** |
| `NODE_OPTIONS=--experimental-vm-modules npx jest tests/http tests/runtime --runInBand` | Aprovado: **2 suítes, 8 testes**    |

| `./gradlew :app:testDebugUnitTest` | Aprovado: **14 suítes, 96 testes** |
| `./gradlew :app:compileDebugKotlin` | Aprovado |
| `./gradlew :app:compileDebugAndroidTestKotlin` | Aprovado |
| `./gradlew :app:assembleDebugAndroidTest` | Aprovado |
| CI Android com `:app:assembleDebugAndroidTest` | Workflow atualizado e sintaticamente validado; execução remota depende do próximo CI run |
| `./gradlew :app:assembleDebug` | Aprovado |
| `./gradlew :app:lintDebug` | Aprovado |
| `./gradlew :app:bundleRelease` com API HTTPS, LiveKit WSS e produto público placeholder | Aprovado; AAB unsigned buildable |
| Release com API HTTP | Rejeitado: `Release API_BASE_URL must use HTTPS` |
| Release com API em `localhost` | Rejeitado: `Release API_BASE_URL must not use a local host` |
| Release com LiveKit HTTP | Rejeitado: `Release LIVEKIT_URL must use wss://` |
| Release com LiveKit em `localhost` | Rejeitado: `Release LIVEKIT_URL must not use a local host` |
| Release sem `BILLING_PRODUCT_ID` | Rejeitado: `Release BILLING_PRODUCT_ID must be configured` |
| Release com caminho Billing relativo | Rejeitado: `Release BILLING_VALIDATION_PATH must be an absolute API path` |
| `POST /auth/logout/refresh` backend HTTP | Aprovado: rota registrada em produção; contrato cobre payload inválido, sucesso idempotente, 503 e ausência de oracle; 401 permanece específico de `/auth/refresh` |
| Android logout refresh contract | Aprovado: payload/endpoint/headers, 503 e access expirado com refresh válido cobertos em testes locais |
| `git diff --check` | Aprovado no estado fonte e repetido após as atualizações documentais |
| Secret scan e scan de persistência Android | Aprovado; nenhum segredo encontrado, nenhum sink proibido e apenas `SecureSessionStore` criptografado persiste o par |
| `tools/android-e2e-preflight.sh` | Executado; `BLOCKED / no_authorized_device` sem coletar tokens ou PII |
| `tools/android-e2e-session.sh` | Executado sem APK e com APK; `BLOCKED / APK_PATH_required` e `expected_exactly_one_authorized_device` |
| `tools/android-e2e-auth-refresh.sh` | APK debug + APK instrumentado construídos; `BLOCKED / expected_exactly_one_authorized_device`, sem coletar tokens/PII |
| AVD Google Play API 35 headless | Provisionado, mas boot falhou após 300 s sem `/dev/kvm`; não é evidência de E2E |

A implementação de segurança de release aceita placeholders públicos apenas para demonstrar o build. Isso não configura API real, produto real, endpoint LiveKit real ou credencial de assinatura.

## Artefatos e hashes

Os artefatos foram regenerados no gate final antes do commit documental. O AAB é construível, mas não está assinado.

| Artefato             | Caminho                                                                     | SHA-256                                                            |
| -------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Debug APK            | `android/app/build/outputs/apk/debug/app-debug.apk`                         | `b1fb5fd6e393db1a39bf6e0a1373427fcefd5a7c1efc68e6e26615fa15e4bdff` |
| Release AAB unsigned | `android/app/build/outputs/bundle/release/app-release.aab`                  | `18e81afd8843314ab4b157617970453fa20d1ce4c711b5bcfae533589a081d3f` |
| Debug test APK       | `android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk` | `131c763ab89848be33e8c1b8b3c518cba910431c9ec754d056eca022585cf69c` |

## Classificação de readiness e validação externa

| Área                             | Classificação                                 | Observação                                                                                                                                                             |
| -------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Billing Android client flow      | **IMPLEMENTED + TESTED**                      | Contrato, entitlement server-side, restore sem compra local, deduplicação, stale callback e fail-closed cobertos por testes locais.                                    |
| Play sandbox/Play Console        | **IMPLEMENTED, NEEDS REAL CREDENTIAL/DEVICE** | Não há produto, licença de teste, conta Play Console ou dispositivo neste ambiente; nenhuma compra real foi alegada.                                                   |
| Age Assurance hosted UX          | **IMPLEMENTED + TESTED**                      | Start/refresh, URL HTTPS, estados e respostas tardias têm cobertura de contrato/ViewModel.                                                                             |
| Didit/provider Age Assurance E2E | **IMPLEMENTED, NEEDS REAL CREDENTIAL/DEVICE** | Requer API key/workflow, webhook autenticado, navegador/dispositivo e decisão real; não foi executado.                                                                 |
| Auth/Google OIDC Android client  | **IMPLEMENTED + TESTED**                      | Login/refresh/logout server-side, encrypted storage, snapshot atômico, limpeza local imediata, single-flight, retry único, corridas e fail-closed têm cobertura local. |
| Auth/Google OIDC Android E2E     | **IMPLEMENTED, NEEDS REAL CREDENTIAL/DEVICE** | Credential Manager, Web client ID real e dispositivo/Google Play ainda são necessários para expiração/rotação real.                                                    |
| LiveKit/RTC duas partes          | **IMPLEMENTED, NEEDS REAL CREDENTIAL/DEVICE** | Lifecycle, JIT e renderer cleanup têm testes locais; mídia, reconexão e revogação reais exigem duas contas e backend configurado.                                      |
| Block/Report                     | **IMPLEMENTED + TESTED**                      | UI e contratos server-side estão conectados; a confirmação depende do backend e o E2E operacional não foi executado.                                                   |
| AAB                              | **IMPLEMENTED, NEEDS REAL CREDENTIAL/DEVICE** | Build unsigned aprovado; assinatura, keystore, Play App Signing e Play Console ainda são externos.                                                                     |
| Notificações Android             | **NOT IMPLEMENTED**                           | Nenhum contrato backend seguro de registro/entrega foi observado; não foi inventada autoridade local.                                                                  |
| Deep link Age Assurance          | **NOT IMPLEMENTED**                           | O retorno atual é ActivityResult/`ON_RESUME`; não há app link/deep link backend publicado.                                                                             |
| Renovação de sessão              | **IMPLEMENTED + TESTED**                      | Contrato `/auth/refresh`, encrypted storage, single-flight, retry único, stale protection e logout fail-closed cobertos localmente.                                    |
| Revogação por refresh no logout  | **IMPLEMENTED + TESTED**                      | `/auth/logout/refresh` confirmado no backend; Android limpa localmente antes da rede, trata access expirado, 503, duplicata e troca de conta; E2E físico bloqueado.    |
| Keystore instrumentado           | **IMPLEMENTED, NEEDS REAL DEVICE**            | `SecureSessionStoreInstrumentedTest` compila, o CI compila o APK instrumentado e o runner está pronto; execução não ocorreu por ausência de device autorizado.         |

O preflight reproduzível está em `tools/android-e2e-preflight.sh`; ele aceita um APK por `APK_PATH`, usa `ADB_BIN`/`ANDROID_SDK_ROOT` sem coletar credenciais e retorna `BLOCKED` quando não há dispositivo autorizado.
O runner complementar `tools/android-e2e-session.sh` exige exatamente um device, confirma Play Services/Play Store, instala um APK, inicia o package e imprime apenas metadados sanitizados; sem device, retorna `BLOCKED` antes de qualquer fluxo. As notas do contrato de refresh estão em `docs/ANDROID_AUTH_REFRESH_NOTES.md`.
O smoke de composição de produção gera chaves RSA efêmeras em memória, evitando que placeholders inválidos sejam tratados como credenciais reais.
O AVD Google Play API 35 foi criado, mas a máquina não expõe `/dev/kvm` e o boot headless não concluiu. Os testes de banco continuam dependentes de `DATABASE_URL_OWNER` e demais URLs PostgreSQL. A migração de `EncryptedSharedPreferences`/`MasterKey` deprecados não foi forçada, pois preservar a sessão existente com uma migração segura e testada é preferível a uma troca cega antes da release. Também permanecem necessários observabilidade sanitizada, políticas operacionais de moderação, revisão de privacidade, assinatura e configuração de produção. O endpoint de logout por refresh não tem rate limit específico observado nesta revisão; a proteção anti-abuso deve ser definida pelo backend/infra antes da exposição pública em escala.

> **ANDROID RELEASE READINESS: 78%**

O percentual é deliberadamente conservador. O cliente, os contratos de refresh/revogação, os gates locais, os estados fail-closed e o AAB unsigned estão substancialmente implementados, mas a release não pode ser declarada pronta sem assinatura, Play sandbox, dispositivo real, duas contas para RTC, Google OIDC real, Didit/Twilio/LiveKit configurados, ambiente PostgreSQL e E2E físico do contrato de logout.

## Próximo passo recomendado ao ChatGPT

O próximo passo é conectar um dispositivo Android com Google Play ou um device lab que exponha ADB, além de publicar um AAB assinado em Play Internal Testing. Com os contratos de refresh e revogação agora disponíveis, o runner e a matriz devem cobrir access expirado com refresh válido, rotação, reutilização do refresh antigo, `/auth/logout/refresh`, revogação, reinício e troca de conta. Eles deliberadamente não executam login, OTP, Billing ou RTC sem um dispositivo autorizado.
O último gate cooperativo também confirmou o hardening de JWT/configuração de produção no backend; essa parte foi preservada sem reescrita Android.
Com o ambiente disponível, executar a matriz em `docs/ANDROID_E2E_RELEASE_PLAN.md`: Google login real, Age Assurance/Didit, telefone/Twilio, MatchIntent, Consent, RTC LiveKit de duas partes, Block/revogação e Billing/restore/revogação. Registrar apenas estados públicos e confirmações server-side, sem purchase token, token LiveKit, OTP ou PII.

## Referências técnicas

[1]: https://developer.android.com/google/play/billing/integrate 'Google Play Billing integration'
[2]: https://developers.google.com/chromeos/app-development/publish/play-billing-backend 'Google Play Billing backend validation'
[3]: https://docs.livekit.io/transport/sdk-platforms/android/ 'LiveKit Android quickstart'
[4]: https://docs.livekit.io/intro/basics/connect/ 'LiveKit connecting to a room'
[5]: https://github.com/livekit/client-sdk-android 'LiveKit Android SDK'
