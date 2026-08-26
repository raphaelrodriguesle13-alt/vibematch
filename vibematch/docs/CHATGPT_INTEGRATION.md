# Integração ChatGPT — Backend e Android

## Visão geral

O cliente Android conversa somente com o backend Fastify. O backend valida o Bearer token de sessão, confirma a sessão ativa no banco e só então encaminha a mensagem para a OpenAI Responses API. A chave `OPENAI_API_KEY` nunca é incluída no APK ou em uma requisição feita pelo telefone.

| Camada     | Responsabilidade                                               | Arquivo principal                             |
| ---------- | -------------------------------------------------------------- | --------------------------------------------- |
| Contrato   | Define mensagens e resposta do fornecedor                      | `backend/src/shared/providers/index.ts`       |
| Fornecedor | Chama `POST /v1/responses`, aplica timeout e valida a resposta | `backend/src/shared/providers/openai.ts`      |
| Domínio    | Controla prompt, histórico e limites                           | `backend/src/chat/service.ts`                 |
| HTTP       | Exige JWT, atualiza a sessão e expõe `POST /api/chat`          | `backend/src/http/app.ts`                     |
| Android    | Renderiza perfil, onboarding e conversa com Bearer token       | `android/app/src/main/java/com/vibematch/app` |

## Backend

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

| Timeout do fornecedor | 504 | `CHAT_PROVIDER_TIMEOUT` |
| Falha do fornecedor | 502 | `CHAT_PROVIDER_UNAVAILABLE` |

## Android

O módulo `android/` contém telas Compose de login, onboarding/perfil e chat, uma camada de rede OkHttp, Credential Manager e ViewModels de Auth, Profile e Chat. Para o emulador, a URL padrão é `http://10.0.2.2:3000`; para um aparelho físico, passe o endereço acessível do backend:

```bash
./gradlew :app:assembleDebug -PAPI_BASE_URL=http://10.0.2.2:3000
```

O cliente obtém o Google ID token com Credential Manager, troca-o em `/auth/google` por um JWT curto do backend e guarda somente a sessão em `EncryptedSharedPreferences`. O logout revoga a sessão, limpa o estado de credencial Google e apaga o armazenamento local. Depois do login, o onboarding chama `GET /api/interests` e `GET /api/profile`; perfil inexistente entra em onboarding e o salvamento chama `PUT /api/profile`. O Android também consulta `GET /api/age-assurance/status`: só o status `APPROVED` permite sair do perfil e abrir o chat; `NOT_STARTED`, `PENDING`, `REJECTED`, respostas desconhecidas ou indisponibilidade permanecem bloqueados. O app nunca aprova idade localmente.

Quando a sessão informa `phone_verified=false`, o Android chama `POST /auth/phone/start` com `{ "phone_e164": "+5511999999999" }`, guarda o `verification_id` apenas no estado da tela e envia o código em `POST /auth/phone/confirm`. A sessão local é marcada como verificada somente depois de `{ "ok": true, "phone_verified": true }`; o JWT existente não é reemitido pelo cliente. Erros de telefone são exibidos como mensagens públicas e HTTP 401 encerra a sessão.

Após perfil, Age Assurance e telefone confirmados, o Android consome `GET /api/match-intents/incoming` e responde solicitações com `POST /api/match-intents/{id}/respond`, enviando apenas `decision: ACCEPTED|DECLINED`. O backend deriva a identidade autenticada, valida elegibilidade e controla validade; 403 `AGE_ASSURANCE_REQUIRED`, 401, estados desconhecidos e respostas inválidas permanecem bloqueados. Aceitar uma intenção não cria Consent, sessão de vídeo ou token RTC. Como o branch ainda não expõe rota HTTP pública de Consent, a camada Android não simula esse estado.

O manifest debug é a única variante que habilita HTTP local; o manifest release força `android:usesCleartextTraffic=false` e o Gradle rejeita `API_BASE_URL` sem HTTPS.

## Próxima etapa

A próxima entrega deve validar telefone e MatchIntent em dispositivo com provedores/ambiente reais, definir renovação/expiração de sessão conforme o contrato do backend e aguardar uma rota HTTP pública de Consent antes de implementar consentimento mútuo no Android. Rate limiting, persistência de conversas, observabilidade e moderação ainda precisam ser revisados antes de produção. O cliente não autoriza localmente idade, matchmaking, consentimento ou vídeo.

## Referências oficiais

A integração usa a [visão geral da Responses API](https://developers.openai.com/api/reference/responses/overview) e o [guia oficial de início rápido para Node.js](https://developers.openai.com/api/docs/quickstart).
