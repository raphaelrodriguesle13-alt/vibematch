# Google Play Billing — notas verificadas para o cliente Android

Atualizado em **2026-08-26** para a integração VibeMatch em `continuity`.

## Fontes oficiais

[1]: https://developer.android.com/google/play/billing/integrate — Integrate the Google Play Billing Library into your app.
[2]: https://developer.android.com/google/play/billing/release-notes — Google Play Billing Library release notes.
[3]: https://developers.google.com/chromeos/app-development/publish/play-billing-backend — Play Billing components in your back-end server.

## Decisões aplicadas

A documentação oficial consultada indica a versão `9.1.0` da Play Billing Library como release atual na data desta integração. O fluxo recomendado é mostrar o produto, iniciar a compra, verificar no servidor, conceder o conteúdo somente após a verificação e então fazer o acknowledge/consumo conforme o tipo de produto [1].

O cliente usa uma única conexão `BillingClient`, `PurchasesUpdatedListener`, `enablePendingPurchases(PendingPurchasesParams)` e `enableAutoServiceReconnection()`. A compra é iniciada somente com `ProductDetails` consultado de forma atualizada; objetos de produto não são persistidos como fonte de verdade. Compras `PENDING` ou estados não confirmados não liberam Premium [1] [2].

O purchase token é encaminhado ao backend seguro para validação. A Google Play Developer API deve ser chamada pelo servidor para verificar a legitimidade e o estado da compra; o entitlement é mantido server-side. Para assinaturas, o servidor considera a expiração e deve acompanhar mudanças de estado por RTDN, sem transformar um callback local do Google Play em autorização final [1] [3].

## Contrato VibeMatch usado pelo Android

O cliente chama `POST /api/billing/verify-purchase` com apenas `{ "purchase_token": "..." }` e `GET /api/billing/entitlement` para restauração. O token permanece transitório na memória durante a validação, nunca é salvo no armazenamento Android, estado Compose, logs, analytics ou metadados de crash. O Android exibe Premium somente quando o backend responde `data.entitled=true`.

O transporte de validação exige HTTPS inclusive em debug; com API HTTP local o botão de compra permanece bloqueado. A URL pública do LiveKit continua separada e exige `wss://` em release. Nenhuma chave de serviço Google Play, segredo LiveKit ou segredo de outro provedor deve existir no APK ou no repositório.

## Referências

As referências acima são páginas oficiais consultadas durante a decisão técnica; o conteúdo externo é apenas orientação de integração. A autorização de conta, produto, compra, assinatura, entitlement, cobrança e revogação permanece exclusivamente server-side no VibeMatch.
