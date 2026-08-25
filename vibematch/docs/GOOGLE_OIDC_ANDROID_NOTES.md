# Google OIDC Android — notas de implementação

## Fontes oficiais consultadas em 2026-08-25

- Sign in with Google no Android com Credential Manager: https://developer.android.com/identity/sign-in/credential-manager-siwg
- Guia de implementação Credential Manager + Google ID: https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation
- AndroidX Credentials release notes: https://developer.android.com/jetpack/androidx/releases/credentials
- Autenticação de backend por ID token: https://developer.android.com/identity/legacy/one-tap/idtoken-auth
- Google Identity Credential Manager releases: https://developers.google.com/identity/android-credential-manager/releases

## Decisões aplicadas

O Android deve usar Credential Manager para obter um Google ID token e enviá-lo ao backend por HTTPS. O backend deve validar a assinatura, o issuer, a audiência e a validade do token; o cliente não pode tratar o conteúdo do token como autoridade de autorização.

O request Google usa o **Web client ID** do servidor em `setServerClientId`, não um segredo. O mesmo valor deve ser aceito como audience pelo `GoogleOidcProvider` server-side. A versão estável escolhida para o módulo Android é `androidx.credentials:credentials:1.6.0` com `credentials-play-services-auth:1.6.0`; o metadata do Google Maven mostrou `com.google.android.libraries.identity.googleid:googleid:1.2.0` como release atual na consulta.

O guia oficial recomenda Credential Manager em vez do One Tap legado, que está deprecated. O logout do app deve chamar `clearCredentialState()` e também revogar a sessão no backend.

O backend atual ainda não recebe nem valida nonce no endpoint `/auth/google`. Por isso, o cliente desta etapa não adiciona um nonce não verificado; a adoção de nonce deve ser um incremento coordenado no contrato server-side, com validação do valor esperado.

O JWT curto emitido pelo backend é guardado localmente com AndroidX Security Crypto e não o ID token do Google. A chave OpenAI continua exclusivamente server-side.
