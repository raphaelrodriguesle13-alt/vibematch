# VibeMatch Android

O módulo Android usa **Kotlin + Jetpack Compose** e entrega autenticação Google, onboarding de perfil, verificação telefônica, MatchIntent, Consent, Video Session JIT, moderação comunitária e uma chamada RTC LiveKit controlada pelo backend.

## Requisitos

É necessário Android Studio com Android SDK 35 e Java 17 ou superior. O repositório não versiona credenciais, tokens de sessão, chaves LiveKit ou chaves de provedores.

## Executar contra o backend local

Inicie o backend na porta 3000 e, dentro deste diretório, execute:

```bash
./gradlew test
./gradlew :app:assembleDebug \
  -PAPI_BASE_URL=http://10.0.2.2:3000 \
  -PGOOGLE_SERVER_CLIENT_ID=seu-web-client-id.apps.googleusercontent.com
```

`10.0.2.2` aponta do emulador Android para o `localhost` da máquina hospedeira. Para um dispositivo físico, substitua a URL pelo endereço acessível da máquina na rede local. A aplicação usa HTTP claro somente no debug local; o Manifest de release força `android:usesCleartextTraffic="false"`, e o build release exige uma `API_BASE_URL` com HTTPS.

Para testar o RTC em um ambiente configurado, forneça somente a URL pública do servidor LiveKit, nunca a chave ou o segredo de assinatura:

```bash
./gradlew :app:assembleDebug \
  -PAPI_BASE_URL=http://10.0.2.2:3000 \
  -PGOOGLE_SERVER_CLIENT_ID=seu-web-client-id.apps.googleusercontent.com \
  -PLIVEKIT_URL=wss://livekit.seu-dominio.example
```

Em debug, `LIVEKIT_URL` pode permanecer vazio para que a tela falhe de forma visível e segura. Em release, o Gradle rejeita a construção se `LIVEKIT_URL` não começar por `wss://` e se `API_BASE_URL` não usar HTTPS. A dependência é fixada em `io.livekit:livekit-android:2.28.1`; JitPack é usado apenas como repositório auxiliar exigido pelo SDK.

## Estado de autenticação

O cliente usa Credential Manager para obter um Google ID token e o envia ao endpoint `/auth/google`. O valor de `GOOGLE_SERVER_CLIENT_ID` é um identificador público de OAuth, não um segredo; ele deve ser o mesmo audience aceito pelo `GoogleOidcProvider` do backend. O ID token do Google é descartado depois da troca por um JWT curto de sessão emitido pelo backend.

O JWT de sessão é guardado em `EncryptedSharedPreferences`, protegido por uma `MasterKey` do Android Keystore. O logout revoga a sessão no backend, limpa o estado de credencial Google, encerra qualquer sala RTC e remove o conteúdo local.

## Premium e Google Play Billing

O cliente usa `com.android.billingclient:billing:9.1.0`. A entrada **Premium** aparece no cabeçalho do Chat e abre uma tela que consulta o produto, inicia a compra no Google Play e oferece restauração de compras. Estados de conexão, carregamento, compra pendente, validação, sucesso, erro, sessão expirada e produto ausente são mostrados explicitamente; o botão de retry repete a consulta sem conceder acesso localmente.

Depois de uma compra `PURCHASED`, o Android envia imediatamente o `purchase_token` transitório ao endpoint configurado em `BILLING_VALIDATION_PATH` (padrão `/api/billing/verify-purchase`) com o payload `{ "purchase_token": "..." }`. O backend consulta a Google Play Developer API, associa a compra à sessão autenticada, atualiza seu entitlement e responde com `data.entitled`, `data.plan`, `data.status` e `data.current_period_end`. O Android só exibe Premium quando essa resposta server-side confirma `entitled=true`; respostas ausentes, inválidas, `403`, `409`, `429`, `5xx` ou sessão expirada permanecem sem acesso.

Na restauração, o Android primeiro consulta as compras ativas do Google Play. Se não houver compra local correspondente, chama `GET /api/billing/entitlement` para recuperar somente um entitlement já registrado pelo servidor. Essa consulta não transforma ausência de compra local em Premium e também falha fechada em erro.

O purchase token não entra em estado Compose, `SharedPreferences`, `DataStore`, `SavedStateHandle`, logs, analytics ou crash metadata. O Android nunca interpreta a resposta do Google Play como entitlement final e nunca concede Premium a partir de preço, SKU, estado local ou callback isolado. Após a confirmação server-side, a compra é acknowledged no Google Play; se o servidor não confirmar, ela não é acknowledged pelo cliente.

O backend agora expõe `POST /api/billing/verify-purchase` e `GET /api/billing/entitlement`; o Android não implementa a verificação Google nem altera tabelas de entitlement. Configure o produto apenas em build de release:

```bash
./gradlew :app:assembleDebug \\
  -PAPI_BASE_URL=http://10.0.2.2:3000 \\
  -PGOOGLE_SERVER_CLIENT_ID=seu-web-client-id.apps.googleusercontent.com \\
  -PBILLING_PRODUCT_ID=premium_monthly

./gradlew :app:bundleRelease \\
  -PAPI_BASE_URL=https://api.seu-dominio.example \\
  -PGOOGLE_SERVER_CLIENT_ID=seu-web-client-id.apps.googleusercontent.com \\
  -PLIVEKIT_URL=wss://livekit.seu-dominio.example \\
  -PBILLING_PRODUCT_ID=premium_monthly
```

O Gradle rejeita build release sem `BILLING_PRODUCT_ID`, exige HTTPS na API e `wss://` no LiveKit. Nenhuma chave de serviço Google Play, segredo LiveKit ou token de compra deve ser colocado no APK, no `BuildConfig` ou no repositório.

## Age Assurance hosted

O perfil consulta `GET /api/age-assurance/status` e só o status `APPROVED` libera as etapas restritas. Quando o backend mantém o usuário em `NOT_STARTED`, o botão de verificação chama `POST /api/age-assurance/start`; o Android aceita somente uma resposta `PENDING` com `verification_url` HTTPS e abre esse endereço externo apenas após validar a URL. O app não aprova idade, não interpreta o resultado do provedor e não persiste a URL além do estado transitório da tela.

Enquanto o gate estiver `PENDING`, o usuário pode atualizar o estado por `POST /api/age-assurance/refresh`. O retorno do navegador usa o ciclo ActivityResult e `ON_RESUME` como gatilhos de refresh server-side; não existe um app link/deep link de provedor inventado pelo cliente, porque o backend atual não publica esse contrato. `APPROVED`, `REJECTED`, `UNKNOWN`, `AGE_PROVIDER_UNAVAILABLE`, HTTP 401, 403, 404, 409, 429 e 5xx continuam fail-closed. Respostas tardias de uma sessão anterior são descartadas por geração de requisição e token autenticado.

## Fluxo do chat

Após o login, a tela envia `POST /api/chat` com o header `Authorization: Bearer <session_jwt>`, a mensagem atual e o histórico limitado. A chave da OpenAI nunca é enviada para o Android; somente o backend conversa com o provedor.

## Onboarding e perfil

Depois do login, o cliente carrega `GET /api/interests` e `GET /api/profile` com o JWT de sessão. Quando o perfil retorna `404 PROFILE_NOT_FOUND`, a tela entra em modo de onboarding; ela não cria dados localmente nem considera o usuário pronto até o backend confirmar o salvamento.

O botão de continuidade envia `PUT /api/profile` com o contrato abaixo:

```json
{
  "display_name": "Nome",
  "avatar_url": null,
  "language": "pt-BR",
  "region": "BR-SP",
  "interest_ids": ["uuid-do-interesse"]
}
```

O backend continua sendo a fonte da verdade para validação, interesses válidos e estados de idade, bloqueio ou suspensão. A tela mostra esses estados de forma fail-closed quando o backend os reportar; ela não libera matchmaking, consentimento ou vídeo localmente.

## Verificação telefônica

Quando a sessão informa `phone_verified=false`, o app apresenta a etapa de telefone antes do chat. O usuário informa o número em formato internacional E.164 e o Android chama `POST /auth/phone/start` com `{ "phone_e164": "+5511999999999" }`. O backend valida o número e retorna `verification_id` e `expires_at`; esses valores permanecem somente no estado da tela.

Na segunda etapa, o app chama `POST /auth/phone/confirm` com `{ "verification_id": "...", "code": "..." }`. Somente a resposta server-side `{ "ok": true, "phone_verified": true }` atualiza a dica local da sessão e libera a navegação. Erros `INVALID_PHONE`, `INVALID_CODE`, `VERIFICATION_NOT_AVAILABLE`, `TOO_MANY_ATTEMPTS`, `SMS_PROVIDER_UNAVAILABLE` e HTTP 401 são tratados sem expor detalhes internos; 401 encerra a sessão local e retorna ao login.

## Solicitações de conexão

Depois de perfil, Age Assurance aprovado e telefone confirmado, a tela de Chat oferece acesso a solicitações recebidas. A tela chama `GET /api/match-intents/incoming` e responde uma solicitação com `POST /api/match-intents/{id}/respond`, enviando somente `decision: "ACCEPTED"` ou `decision: "DECLINED"`. O `sender_id`, o `receiver_id`, a validade e a elegibilidade são determinados pelo backend; o Android não envia identidade de usuário para decidir em nome da sessão.

O status `AGE_ASSURANCE_REQUIRED`, `PHONE_VERIFICATION_REQUIRED`, HTTP 403, HTTP 401, estados desconhecidos e respostas inválidas permanecem bloqueados ou são tratados com mensagens públicas. Aceitar uma intenção não cria Consent nem sessão de vídeo automaticamente.

## Consentimento mútuo

Depois de aceitar uma MatchIntent, o app pode abrir Consent e chama `POST /api/consents` com `{ "match_intent_id": "..." }`. A resposta contém os estados dos dois participantes e os prazos controlados pelo servidor. Para decidir, o Android chama `POST /api/consents/{id}/decision` com `{ "decision": "ACCEPTED", "request_id": "uuid" }` ou a decisão `DECLINED`; o `request_id` é gerado como UUID por ação.

O Android exibe `PENDING`, `ACCEPTED_BOTH`, `DECLINED`, `EXPIRED`, `CANCELLED` e estados desconhecidos sem inferir autorização. Mesmo em `ACCEPTED_BOTH`, o app não cria sessão de vídeo automaticamente: a etapa de vídeo permanece dependente dos endpoints server-side e de revalidação JIT.

## Video Session, token JIT e LiveKit

Quando o usuário solicita explicitamente a próxima etapa após `ACCEPTED_BOTH`, o Android chama `POST /api/video/sessions` com `{ "consent_id": "..." }`. Se o backend autorizar, a tela oferece a solicitação de credencial por `POST /api/video/sessions/{id}/token`, sem enviar identidade, room ou permissões no corpo. O backend revalida Consent, idade, telefone, bloqueios, revogação, prazo e rate limit; ele também cria a identidade opaca, a sala e o token LiveKit com TTL curto.

A credencial percorre um callback em memória entre `VideoSessionViewModel` e `RtcRoomViewModel`. A UI expõe apenas um indicador de que há uma credencial transitória pronta; o valor bruto não aparece no estado Compose, não é persistido em `SharedPreferences`, `DataStore` ou `SavedStateHandle`, e não é escrito em logs, analytics ou metadados de crash.

A conexão só é tentada depois de uma nova credencial JIT e da ação explícita **Entrar na chamada**. Nesse momento, e somente nesse momento, o Android solicita `CAMERA` e `RECORD_AUDIO` em runtime. Se qualquer permissão for negada, o app não cria a sala nem liga câmera ou microfone; o usuário precisa solicitar uma nova credencial depois de conceder as permissões.

Após a conexão, a tela oferece vídeo local e remoto, estado de participante remoto, ativação/desativação explícita de microfone e câmera, encerramento e acesso imediato a Bloquear/denunciar. O app não publica câmera ou microfone automaticamente ao conectar. Saída, logout, troca de sessão, revogação percebida, falha terminal do LiveKit e bloqueio confirmado encerram a sala local, removem tracks/renderers e descartam qualquer credencial pendente. Falhas de autorização e desconexões exigem nova emissão e nova revalidação server-side; o Android não tenta fabricar ou prolongar tokens.

Os estados `CREATED`, `ACTIVE`, `ENDED` e desconhecidos, além de `VIDEO_NOT_AUTHORIZED`, `PHONE_VERIFICATION_REQUIRED`, `AGE_ASSURANCE_REQUIRED`, `RATE_LIMITED`, HTTP 401 e erros do provedor, são tratados sem liberação local. Sem `LIVEKIT_URL`, o fluxo permanece desconectado e informa configuração ausente, sem substituir o endpoint por um valor embutido.

| Etapa               | Responsabilidade do Android                          | Autoridade do backend                        |
| ------------------- | ---------------------------------------------------- | -------------------------------------------- |
| Criar Video Session | Enviar somente `consent_id` autenticado              | Elegibilidade, vínculo, prazo e revogação    |
| Emitir token        | Solicitar sem identidade ou room                     | Identidade, room, grants, TTL e rate limit   |
| Entrar no RTC       | Pedir permissões em runtime e reagir ao clique       | Aceitar ou rejeitar o token e a conexão      |
| Controlar mídia     | Ligar/desligar câmera e microfone por ação explícita | Provedor LiveKit e estado da sala            |
| Bloquear/denunciar  | Enviar a ação e encerrar o RTC local                 | Participantes, severidade, revisão e punição |

## Proteção da comunidade

As telas de Consent e da chamada oferecem `Bloquear ou denunciar` para o participante oposto. Bloqueios chamam `POST /api/blocks` com `blocked_id`; denúncias chamam `POST /api/reports` com `reported_id`, `session_id` opcional e categorias `HARASSMENT`, `HATE`, `SEXUAL_CONTENT`, `SCAM`, `SPAM` ou `OTHER`.

Após confirmação do bloqueio pelo backend, o callback Android encerra a sala RTC imediatamente. O Android não calcula severidade, não decide punições e não altera o estado de outra conta localmente. O backend valida identidade, participantes, sessão, categoria e encaminhamento operacional. HTTP 401 encerra a sessão, HTTP 429 é apresentado como erro recuperável e estados desconhecidos permanecem sem autorização local.

## UX, lifecycle e acessibilidade

Os estados vazios de MatchIntent, Consent e autorização de vídeo exibem explicação pública e ação de atualização/retry quando a operação pode ser repetida com segurança. Mensagens não expõem detalhes de provedores, tokens ou PII. Ao entrar em background (`ON_STOP`), a Activity encerra a sala RTC e descarta a credencial pendente; o retorno a uma chamada exige nova autorização e ação explícita. Os botões críticos permanecem nomeados por texto, com loading visível e sem liberar recurso por estado otimista local.

O cabeçalho do Chat usa um menu acessível de opções secundárias para evitar overflow em telas estreitas; Perfil, Premium e Solicitações continuam disponíveis por itens nomeados, enquanto Sair permanece visível. A mudança é apenas de navegação local e não altera nenhum contrato de autorização.

## Runner de sessão E2E

`../tools/android-e2e-preflight.sh` verifica ADB, dispositivo autorizado e pacote instalado sem coletar credenciais. Para preparar uma sessão manual em um APK debug já construído, use:

```bash
ADB_BIN=/caminho/para/adb \\
APK_PATH=app/build/outputs/apk/debug/app-debug.apk \\
../tools/android-e2e-session.sh
```

O runner exige exatamente um dispositivo autorizado, confirma a presença de Google Mobile Services e Play Store, instala o APK, inicia o pacote e imprime somente modelo, API, package e SHA-256. `CLEAR_APP_DATA=1` pode ser usado conscientemente antes de um cenário novo; o padrão não apaga dados. Ele não realiza login, não lê OTP, não imprime logs e não registra tokens. A execução funcional deve seguir `docs/ANDROID_E2E_RELEASE_PLAN.md` com contas e ambiente reais. Um AAB não é instalado diretamente por esse script: para Billing real, o release assinado deve ser publicado em Play Internal Testing.

## Validação local

Os gates Android usados nesta etapa são:

```bash
./gradlew test :app:assembleDebug :app:lintDebug --no-daemon
```

Os testes unitários cobrem a entrega transitória de token da Video Session, a ausência do token bruto no estado exposto, a exigência de credencial antes de conectar, consumo único, URL ausente, permissão negada, desconexão, Billing duplicado/stale e o fluxo hosted de Age Assurance. A validação de uma chamada real depende de um backend com LiveKit configurado, credenciais server-side e duas sessões autenticadas; esses valores nunca devem ser colocados no APK ou no repositório. A validação hosted real depende de Didit configurado, webhook autenticado e um dispositivo/navegador compatível; o retorno atual é tratado por ActivityResult/ON_RESUME e não por um deep link Android, pois não há contrato de app link publicado.

## Referências técnicas

[1]: https://docs.livekit.io/transport/sdk-platforms/android/ 'LiveKit Android quickstart'
[2]: https://docs.livekit.io/intro/basics/connect/ 'LiveKit connecting to a room'
[3]: https://github.com/livekit/client-sdk-android 'LiveKit Android SDK'
[4]: https://github.com/livekit/client-sdk-android/blob/main/sample-app-basic/src/main/java/io/livekit/android/sample/basic/MainActivity.kt 'LiveKit Android sample app'
[5]: https://developer.android.com/google/play/billing/integrate 'Google Play Billing integration'
[6]: https://developers.google.com/chromeos/app-development/publish/play-billing-backend 'Google Play Billing backend validation'
