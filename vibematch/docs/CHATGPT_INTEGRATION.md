# Integração ChatGPT — Backend e Android

## Visão geral

O cliente Android conversa somente com o backend Fastify. O backend valida o Bearer token de sessão, confirma a sessão ativa no banco e só então encaminha a mensagem para a OpenAI Responses API. A chave `OPENAI_API_KEY` nunca é incluída no APK ou em uma requisição feita pelo telefone.

| Camada     | Responsabilidade                                               | Arquivo principal                             |
| ---------- | -------------------------------------------------------------- | --------------------------------------------- |
| Contrato   | Define mensagens e resposta do fornecedor                      | `backend/src/shared/providers/index.ts`       |
| Fornecedor | Chama `POST /v1/responses`, aplica timeout e valida a resposta | `backend/src/shared/providers/openai.ts`      |
| Domínio    | Controla prompt, histórico e limites                           | `backend/src/chat/service.ts`                 |
| HTTP       | Exige JWT, atualiza a sessão e expõe `POST /api/chat`          | `backend/src/http/app.ts`                     |
| Android    | Renderiza fluxo restrito, conversa, moderação e chamada RTC    | `android/app/src/main/java/com/vibematch/app` |

## Backend e ChatGPT

Adicione ao `.env` local:

```dotenv
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-5.6
OPENAI_TIMEOUT_MS=30000
```

A aplicação deve montar `ChatService` com `createChatService()` e injetá-lo ao chamar `buildApp`. O restante das dependências de autenticação continua sendo fornecido pelo bootstrap do backend.

### `POST /api/chat`

A rota exige uma sessão ativa:

```http
Authorization: Bearer <session_jwt>
Content-Type: application/json
```

Corpo:

```json
{
  "message": "Como funciona o VibeMatch?",
  "history": [
    { "role": "user", "content": "O que é o app?" },
    { "role": "assistant", "content": "É uma plataforma de descoberta social." }
  ]
}
```

Sucesso:

```json
{
  "data": {
    "request_id": "resp_...",
    "model": "gpt-5.6",
    "text": "..."
  }
}
```

A mensagem atual e cada item do histórico podem ter até 4.000 caracteres; o histórico aceita até 20 itens. O corpo HTTP fica limitado a 128 KiB. O backend exige Age Assurance aprovado antes de processar o chat e responde `403 AGE_ASSURANCE_REQUIRED` de forma fail-closed para qualquer outro estado.

| Situação                    | HTTP | Código                       |
| --------------------------- | ---: | ---------------------------- |
| Sem Bearer token            |  401 | `UNAUTHORIZED`               |
| Sessão revogada ou expirada |  401 | `SESSION_REVOKED_OR_EXPIRED` |
| Corpo inválido              |  400 | `INVALID_REQUEST`            |
| Age Assurance não aprovado  |  403 | `AGE_ASSURANCE_REQUIRED`     |
| Chat não configurado        |  503 | `CHAT_NOT_CONFIGURED`        |
| Timeout do fornecedor       |  504 | `CHAT_PROVIDER_TIMEOUT`      |
| Falha do fornecedor         |  502 | `CHAT_PROVIDER_UNAVAILABLE`  |

## Android e autenticação

O módulo `android/` contém telas Compose de login, onboarding/perfil, telefone, MatchIntent, Consent, moderação, Video Session e chamada RTC. Para o emulador, a URL padrão é `http://10.0.2.2:3000`; para um aparelho físico, passe o endereço acessível do backend:

```bash
./gradlew :app:assembleDebug -PAPI_BASE_URL=http://10.0.2.2:3000
```

O cliente obtém o Google ID token com Credential Manager, troca-o em `/auth/google` por um JWT curto do backend e guarda somente a sessão em `EncryptedSharedPreferences`. O logout revoga a sessão, limpa o estado de credencial Google, encerra a sala RTC e apaga o armazenamento local. Depois do login, o onboarding chama `GET /api/interests` e `GET /api/profile`; perfil inexistente entra em onboarding e o salvamento chama `PUT /api/profile`. O Android também consulta `GET /api/age-assurance/status`: só o status `APPROVED` permite sair do perfil e abrir o chat; `NOT_STARTED`, `PENDING`, `REJECTED`, respostas desconhecidas ou indisponibilidade permanecem bloqueados. O app nunca aprova idade localmente.

Quando a sessão informa `phone_verified=false`, o Android chama `POST /auth/phone/start` com `{ "phone_e164": "+5511999999999" }`, guarda o `verification_id` apenas no estado da tela e envia o código em `POST /auth/phone/confirm`. A sessão local é marcada como verificada somente depois de `{ "ok": true, "phone_verified": true }`; o JWT existente não é reemitido pelo cliente. Erros de telefone são exibidos como mensagens públicas e HTTP 401 encerra a sessão.

Após perfil, Age Assurance e telefone confirmados, o Android consome `GET /api/match-intents/incoming` e responde solicitações com `POST /api/match-intents/{id}/respond`, enviando apenas `decision: ACCEPTED|DECLINED`. O backend deriva a identidade autenticada, valida elegibilidade e controla validade; 403 `AGE_ASSURANCE_REQUIRED`, `PHONE_VERIFICATION_REQUIRED`, 401, estados desconhecidos e respostas inválidas permanecem bloqueados. Aceitar uma intenção não cria Consent, sessão de vídeo ou token RTC.

Após uma MatchIntent aceita, o Android pode criar Consent com `POST /api/consents` e decidir com `POST /api/consents/{id}/decision`, enviando `decision` e um `request_id` UUID. O backend é responsável pela identidade, elegibilidade, prazo, `video_deadline` e transição `ACCEPTED_BOTH`; o Android apenas exibe os estados devolvidos. Mesmo em `ACCEPTED_BOTH`, nenhum vídeo é iniciado localmente e qualquer sessão/token depende de autorização JIT server-side.

## Video Session e LiveKit RTC

Quando o usuário solicita explicitamente a etapa seguinte, o Android chama `POST /api/video/sessions` com `consent_id` e, após criação autorizada, `POST /api/video/sessions/{id}/token`. O cliente não envia `user_id`, `room_name`, consentimento, idade, telefone ou estado de bloqueio para obter autorização; esses dados são derivados e revalidados no backend. O backend LiveKit é o único lugar que conhece chave, segredo, identidade e room; o token tem TTL curto e é emitido sob demanda.

A credencial retorna somente para um callback transitório em memória entre `VideoSessionViewModel` e `RtcRoomViewModel`. O estado exposto contém apenas um indicador booleano de prontidão, nunca o token. A credencial é consumida uma vez quando a conexão é iniciada e não é guardada em `SharedPreferences`, `DataStore`, `SavedStateHandle`, logs, analytics ou crash metadata.

A conexão `Room.connect` só acontece depois de uma nova credencial JIT, da presença de `LIVEKIT_URL` e do clique **Entrar na chamada**. A solicitação runtime de `CAMERA` e `RECORD_AUDIO` ocorre apenas nessa transição. Negação de uma das permissões mantém o app desconectado e exige nova emissão JIT; o app não liga câmera ou microfone por efeito de entrar na tela.

O gateway Android usa `io.livekit:livekit-android:2.28.1`, inicializa renderers local/remoto, observa estados `Connected`, `Reconnecting`, `Reconnected`, `FailedToConnect`, `Disconnected`, participantes e tracks, e remove tracks, renderers e sala em cleanup. O usuário controla explicitamente mute, câmera e encerramento. No estado `Reconnecting`, o app não cria uma credencial alternativa nem trata a reconexão como autorização nova; em falha terminal, falha de autorização ou desconexão, a sala é encerrada e a UI volta a exigir uma credencial recém-emitida pelo backend.

`LIVEKIT_URL` é apenas um endpoint público. Em debug pode ficar vazio para testar o fail-closed; em release o Gradle exige `wss://`. Chaves e segredos LiveKit permanecem exclusivamente no backend e não devem aparecer em código, propriedades versionadas, APK, logs ou documentação de ambiente.

## Moderação e revogação local

A tela de Consent e a chamada oferecem proteção da comunidade. O Android chama `POST /api/blocks` com `blocked_id` ou `POST /api/reports` com `reported_id`, `session_id` opcional e categoria pública. O callback `onBlocked` é conectado ao `RtcRoomViewModel.disconnect()`: a sala local termina após confirmação do bloqueio, enquanto a revogação de Consent, MatchIntent e Video Session permanece server-side.

O backend valida participantes, sessão, categoria, severidade, encaminhamento humano e efeitos operacionais. O Android não decide punições nem modifica a conta alvo localmente. HTTP 401 encerra a sessão e HTTP 429 é recuperável.

## Regras de cooperação

Alterações devem ser feitas exclusivamente na branch `continuity`, sempre precedidas por `git fetch origin continuity` e revisão de divergências. Não se deve usar force-push, reset destrutivo ou publicar em `main`. O backend permanece a fonte da verdade para idade, telefone, bloqueio, suspensão, Consent, Video Session, room, identidade, token, rate limit, expiração e revogação.

O manifest debug é a única variante que habilita HTTP local; o manifest release força `android:usesCleartextTraffic=false` e o Gradle rejeita `API_BASE_URL` sem HTTPS ou `LIVEKIT_URL` sem `wss://`. A validação local usa `./gradlew test :app:assembleDebug :app:lintDebug --no-daemon`; a chamada de mídia real ainda requer ambiente LiveKit configurado e duas contas autenticadas.

## Referências oficiais

A integração usa a [visão geral da Responses API](https://developers.openai.com/api/reference/responses/overview), o [guia oficial de início rápido para Node.js](https://developers.openai.com/api/docs/quickstart), o [quickstart Android do LiveKit](https://docs.livekit.io/transport/sdk-platforms/android/), as [instruções de conexão do LiveKit](https://docs.livekit.io/intro/basics/connect/) e o [SDK Android oficial](https://github.com/livekit/client-sdk-android).
