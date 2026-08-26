# VibeMatch Android

O módulo Android usa **Kotlin + Jetpack Compose** e entrega a primeira tela de conversa com o backend autenticado do VibeMatch.

## Requisitos

É necessário Android Studio com Android SDK 35 e Java 17 ou superior. O repositório não versiona credenciais nem tokens de sessão.

## Executar contra o backend local

Inicie o backend na porta 3000 e, dentro deste diretório, execute:

```bash
./gradlew test
./gradlew :app:assembleDebug \
  -PAPI_BASE_URL=http://10.0.2.2:3000 \
  -PGOOGLE_SERVER_CLIENT_ID=seu-web-client-id.apps.googleusercontent.com
```

`10.0.2.2` aponta do emulador Android para o `localhost` da máquina hospedeira. Para um dispositivo físico, substitua a URL pelo endereço acessível da máquina na rede local.

A aplicação usa HTTP claro somente no debug local: `src/debug/AndroidManifest.xml` habilita essa exceção e `src/release/AndroidManifest.xml` força `android:usesCleartextTraffic="false"`. O build release também exige uma `API_BASE_URL` com HTTPS.

## Estado de autenticação

O cliente usa Credential Manager para obter um Google ID token e o envia por HTTPS ao endpoint `/auth/google`. O valor de `GOOGLE_SERVER_CLIENT_ID` é um identificador público de OAuth, não um segredo; ele deve ser o mesmo audience aceito pelo `GoogleOidcProvider` do backend. O ID token do Google é descartado depois da troca por um JWT curto de sessão emitido pelo backend.

O JWT de sessão é guardado em `EncryptedSharedPreferences`, protegido por uma `MasterKey` do Android Keystore. O logout revoga a sessão no backend, limpa o estado de credencial Google e remove o conteúdo local.

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

O status `AGE_ASSURANCE_REQUIRED`, `PHONE_VERIFICATION_REQUIRED`, HTTP 403, HTTP 401, estados desconhecidos e respostas inválidas permanecem bloqueados ou são tratados com mensagens públicas. Aceitar uma intenção não cria consentimento nem sessão de vídeo automaticamente.

## Consentimento mútuo

Depois de aceitar uma MatchIntent, o app pode abrir Consent e chama `POST /api/consents` com `{ "match_intent_id": "..." }`. A resposta contém os estados dos dois participantes e os prazos controlados pelo servidor. Para decidir, o Android chama `POST /api/consents/{id}/decision` com `{ "decision": "ACCEPTED", "request_id": "uuid" }` ou a decisão `DECLINED`; o `request_id` é gerado como UUID por ação.

O Android exibe `PENDING`, `ACCEPTED_BOTH`, `DECLINED`, `EXPIRED`, `CANCELLED` e estados desconhecidos sem inferir autorização. Mesmo em `ACCEPTED_BOTH`, o app não cria sessão de vídeo automaticamente: a etapa de vídeo permanece dependente dos endpoints server-side e de revalidação JIT.

## Video Session e token JIT

Quando o usuário solicita explicitamente a próxima etapa após `ACCEPTED_BOTH`, o Android chama `POST /api/video/sessions` com `{ "consent_id": "..." }`. Se o backend autorizar, a tela oferece a solicitação de token por `POST /api/video/sessions/{id}/token`. A credencial recebida é mantida apenas em memória transitória durante o callback da operação; não é gravada em `SharedPreferences`, logs ou arquivos.

Os estados `CREATED`, `ACTIVE`, `ENDED` e desconhecidos, além de `VIDEO_NOT_AUTHORIZED`, `PHONE_VERIFICATION_REQUIRED`, `AGE_ASSURANCE_REQUIRED`, `RATE_LIMITED`, HTTP 401 e erros do provedor, são tratados sem liberação local. Nesta etapa não há câmera, WebRTC, LiveKit, publicação de mídia ou reconexão automática; a integração de mídia deve ser feita somente depois de revisar o fornecedor RTC e o contrato JIT.

## Proteção da comunidade

A tela de Consent oferece `Bloquear ou denunciar` para o participante oposto. Bloqueios chamam `POST /api/blocks` com `blocked_id`; denúncias chamam `POST /api/reports` com `reported_id`, `session_id` opcional e categorias `HARASSMENT`, `HATE`, `SEXUAL_CONTENT`, `SCAM`, `SPAM` ou `OTHER`.

O Android não calcula severidade, não decide punições e não altera o estado de outra conta localmente. O backend valida identidade, participantes, sessão, categoria e encaminhamento operacional. HTTP 401 encerra a sessão, HTTP 429 é apresentado como erro recuperável e estados desconhecidos permanecem sem autorização local.
