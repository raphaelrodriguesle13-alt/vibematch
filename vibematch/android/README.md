# VibeMatch Android

O módulo Android usa **Kotlin + Jetpack Compose** e entrega a primeira tela de conversa com o backend autenticado do VibeMatch.

## Requisitos

É necessário Android Studio com Android SDK 35 e Java 17 ou superior. O repositório não versiona credenciais nem tokens de sessão.

## Executar contra o backend local

Inicie o backend na porta 3000 e, dentro deste diretório, execute:

```bash
./gradlew test
./gradlew :app:assembleDebug -PAPI_BASE_URL=http://10.0.2.2:3000
```

`10.0.2.2` aponta do emulador Android para o `localhost` da máquina hospedeira. Para um dispositivo físico, substitua a URL pelo endereço acessível da máquina na rede local.

A aplicação usa HTTP claro somente no debug local: `src/debug/AndroidManifest.xml` habilita essa exceção e `src/release/AndroidManifest.xml` força `android:usesCleartextTraffic="false"`. O build release também exige uma `API_BASE_URL` com HTTPS.

## Estado de autenticação

Enquanto o login Google ainda não foi conectado ao cliente, a tela debug possui um campo temporário para um JWT de sessão emitido pelo backend. O token fica apenas em memória durante a execução da Activity e não é persistido. O campo não é compilado no release e não substitui a tela de login da próxima etapa.

## Fluxo do chat

A tela envia `POST /api/chat` com o header `Authorization: Bearer <session_jwt>`, a mensagem atual e o histórico limitado. A chave da OpenAI nunca é enviada para o Android; somente o backend conversa com o provedor.
