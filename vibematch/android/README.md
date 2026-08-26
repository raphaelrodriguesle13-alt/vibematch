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
