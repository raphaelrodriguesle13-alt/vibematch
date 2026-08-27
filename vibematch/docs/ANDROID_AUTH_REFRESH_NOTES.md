# Android Auth Refresh

## Objetivo

Esta camada renova a sessão somente por meio do contrato server-side publicado em `origin/continuity`. O Android não verifica assinatura, validade, identidade, rotação ou revogação por conta própria. Ele transporta credenciais emitidas pelo backend, mantém o estado fail-closed e expõe à UI somente a sessão de acesso sem o refresh token.

## Contrato HTTP

O login Google em `POST /auth/google` retorna `session_jwt`, `user_id`, `is_new_user`, `phone_verified`, `expires_at`, `refresh_token` e `refresh_expires_at`. O backend falha com `503 SESSION_ISSUANCE_FAILED` se não conseguir emitir o par de credenciais.

A renovação usa `POST /auth/refresh` com o corpo mínimo abaixo e sem header `Authorization`:

```json
{
  "refresh_token": "<credencial emitida pelo backend>"
}
```

A resposta bem-sucedida retorna o mesmo contrato de sessão com um novo `session_jwt`, um novo `refresh_token` e expirações absolutas ISO-8601. O servidor grava somente o hash do refresh token e faz rotação atômica. Refresh inválido, expirado ou reutilizado retorna `401 INVALID_REFRESH_TOKEN`; falhas de emissão retornam erro 5xx e permanecem fail-closed.

## Armazenamento protegido

`SecureSessionStore` usa `EncryptedSharedPreferences` com `MasterKey` AES-256-GCM do Android Keystore. O access JWT e o refresh token são gravados juntos por `saveWithRefresh`, evitando uma atualização parcial do par. O refresh token e sua expiração são acessíveis somente pela abstração `SessionStore`; não fazem parte de `AuthUiState`, Compose, `SavedStateHandle`, logs, analytics ou crash metadata.

A leitura de uma sessão cujo access JWT expirou é mantida enquanto o refresh token não expirou, permitindo renovação após reinício do app. Quando o refresh expira ou não está disponível, a tentativa de renovação limpa o par e termina em logout fail-closed. A implementação preserva a API legada de sessões sem refresh até que uma migração futura possa ser validada de forma segura.

## Concorrência e retry

Todos os ApiClients autenticados compartilham um `OkHttpClient` com `SessionAuthenticator`. O `AuthApiClient` usa seu cliente próprio, sem o Authenticator, para impedir loop no endpoint de refresh.

Para várias respostas 401 do mesmo access token, `SessionRefreshCoordinator` serializa a rotação. Apenas uma chamada ao backend ocorre; as demais reutilizam a rotação observada pelo próprio coordenador. A resposta só é aceita se mantiver o mesmo `user_id`, trouxer access e refresh tokens novos, tiver expirações futuras e ainda corresponder ao par que estava no `SessionStore` antes da chamada.

O `SessionAuthenticator` repete a requisição original no máximo uma vez. Se a nova requisição também retornar 401, nenhum segundo refresh é tentado. Um callback 401 de outra conta não pode usar o token da conta atual; somente um mapeamento de rotação recém-observado para o access token stale pode ser reutilizado por uma duplicata sequencial.

## Logout e troca de conta

Quando a renovação falha, o coordenador limpa o armazenamento protegido antes de acionar o logout fail-closed na Activity. O callback é roteado para a UI principal somente enquanto a Activity não está finalizando ou destruída. Logout, expiração e revogação também encerram RTC e descartam qualquer credencial JIT pendente.

O backend agora publica `POST /auth/logout/refresh` com o corpo mínimo `{ "refresh_token": "..." }`, sem `Authorization`. O endpoint retorna `200 {"ok":true}` para revogação idempotente/indistinguível e `503 {"error":"REVOCATION_UNAVAILABLE"}` quando a infraestrutura de revogação não pode confirmar o efeito. O serviço server-side calcula hash do refresh apresentado e revoga a sessão correspondente; não expõe validade do token. O Android usa um cliente HTTP sem `SessionAuthenticator` para evitar recursão.

O `AuthViewModel` captura uma única vez o snapshot access/refresh do `SecureSessionStore`, limpa o armazenamento e a UI antes de qualquer chamada de rede e mantém as credenciais apenas na coroutine transitória. Quando há refresh válido, somente `/auth/logout/refresh` é chamado, inclusive com access JWT expirado; o logout Bearer legado é usado apenas se não houver refresh. Clique duplicado é ignorado enquanto a operação está em andamento. Falhas de rede/5xx da revogação deixam a UI local encerrada e exibem confirmação não comprovada, sem inventar sucesso ou revogação local.

Se logout, reset ou troca de conta ocorrer enquanto o backend processa a revogação ou rotação, a resposta tardia não pode salvar credenciais, limpar a nova conta ou ressuscitar a sessão anterior. A geração da sessão A não executa limpeza do Google nem altera a UI da conta B. O snapshot protegido é atômico no `SecureSessionStore`; a implementação futura deve preservar essa propriedade.

## Cobertura local

Os testes Android cobrem parse de login/refresh, contrato de `/auth/logout/refresh`, ausência de Authorization, 503 de revogação, access expirado com refresh válido, captura/limpeza local anterior à rede, clique duplicado, troca de conta durante revogação, resposta tardia, deduplicação concorrente e sequencial, token stale de outra conta, limpeza fail-closed e retry único do Authenticator. A suíte local aprovada deve ser complementada por teste real em dispositivo ou device lab com backend configurado para expiração curta, rotação, reutilização do token antigo, revogação, reinício do app e troca de conta.

A ausência de dispositivo, Google OIDC real e ambiente de produção não permite classificar esses cenários como E2E real nesta sessão. Nenhum teste de provider, Play sandbox, SMS ou RTC foi convertido em PASS por mock.
