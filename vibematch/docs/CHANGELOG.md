# Changelog

## [Unreleased] — MVP Android com RTC LiveKit e Billing server-authorized

### Adicionado

- Rota autenticada `POST /api/chat` integrada ao Fastify e ao middleware de sessão existente.
- Adaptador server-side da OpenAI Responses API com timeout e erros públicos estáveis.
- Primeiro módulo Android em Kotlin + Jetpack Compose, com tela de conversa, ViewModel e cliente OkHttp.
- Configuração `API_BASE_URL` para apontar o emulador para o backend local.
- Login Google via Credential Manager usando o Web client ID como audience do backend.
- Troca do Google ID token por credenciais de sessão emitidas pelo backend, incluindo access JWT e refresh token rotativo.
- Armazenamento do par de sessão/refresh com AndroidX Security Crypto e limpeza coordenada no logout.
- Contrato Android de `POST /auth/refresh` com payload mínimo `refresh_token`, refresh single-flight, uma única repetição após 401 e logout fail-closed em rotação inválida, expirada ou reutilizada.
- Proteção contra resposta stale durante logout/troca de conta e cobertura de reinício, rotação, revogação, concorrência e retry único.
- Testes unitários do serviço, do adaptador e do contrato HTTP do chat.
- Testes Android do AuthViewModel e da serialização do request Google.
- Cliente Android autenticado para `GET /api/profile`, `GET /api/interests` e `PUT /api/profile`.
- Tela Compose de onboarding com nome, idioma, região, avatar opcional e seleção de até 10 interesses.
- Tela de perfil acessível a partir do chat, com confirmação de salvamento e estados de erro/sessão.
- Estados fail-closed para idade pendente/rejeitada e conta bloqueada ou suspensa.
- Consulta autenticada de `GET /api/age-assurance/status`; somente `APPROVED` permite sair do perfil e abrir o chat.
- Status desconhecido, indisponibilidade do endpoint e `AGE_ASSURANCE_REQUIRED` não liberam recursos restritos localmente.
- Onboarding Android de telefone em duas etapas, consumindo `POST /auth/phone/start` e `POST /auth/phone/confirm`.
- Atualização local de `phone_verified` somente após confirmação positiva do backend, com retorno ao login em HTTP 401.
- Cliente e ViewModel Android de MatchIntent para listar solicitações recebidas e responder `ACCEPTED` ou `DECLINED`.
- Tela Compose de solicitações acessível pelo Chat somente após perfil, Age Assurance e telefone confirmados.
- Cliente e ViewModel Android de Consent para criar consentimento após MatchIntent aceita e decidir com `request_id` UUID.
- Tela Compose de Consent com estados dos dois participantes e status server-controlled.
- `ACCEPTED_BOTH` não cria localmente sessão de vídeo, token RTC ou entitlement; a autorização permanece JIT no backend.
- Cliente e ViewModel Android de Video Session para criar sessão e solicitar token somente após ação explícita do usuário.
- Callback transitório entre Video Session e RTC: o token bruto não entra no estado Compose, não é persistido e é consumido uma única vez para iniciar a conexão.
- Dependência fixa `io.livekit:livekit-android:2.28.1`, configuração pública `LIVEKIT_URL` e validação de `wss://` em builds release.
- Gateway LiveKit Android com eventos de conexão, participantes, tracks de vídeo, renderers local/remoto, desconexão e cleanup de sala.
- Tela de chamada com entrada após permissões runtime, controles explícitos de microfone/câmera, encerramento e acesso a Bloquear/denunciar.
- Falhas de conexão, desconexões inesperadas, logout, saída, troca de sessão e bloqueio confirmado encerram a sala local e exigem nova credencial JIT.
- Tela Android de proteção da comunidade para bloquear e denunciar o participante oposto, usando apenas as rotas server-side de Moderação.
- O Android não decide severidade, punição ou estado de outra conta; HTTP 401 encerra a sessão e HTTP 429 é recuperável.
- Testes Android de contrato JSON, Age Assurance, telefone, MatchIntent, Consent, Video Session, Moderação, AuthViewModel, ProfileViewModel e RtcRoomViewModel.
- Play Billing Library `9.1.0` com tela Premium, consulta de produto, compra, restauração e estados explícitos de loading, sucesso e erro.
- Validação client-side por `POST /api/billing/verify-purchase` com somente `purchase_token` e restauração por `GET /api/billing/entitlement`; Premium só aparece após `entitled=true` server-side.
- Purchase token mantido transitório, sem persistência ou exposição em estado Compose, logs, analytics ou crash metadata; acknowledgment somente após confirmação do backend.
- Endpoint Billing bloqueado em transporte não HTTPS, `BILLING_PRODUCT_ID` obrigatório em release, versionamento Android `0.2.0` e comando de preparação para AAB.
- Fluxo Android hosted de Age Assurance com `POST /api/age-assurance/start`, `POST /api/age-assurance/refresh` e URL de verificação aceita somente em HTTPS; o backend continua sendo a única autoridade do status.
- Retorno do navegador tratado por ActivityResult e `ON_RESUME` com refresh server-side; não foi inventado app link/deep link porque o backend atual não publica esse contrato.
- Proteção do ProfileViewModel contra respostas tardias após reset/troca de sessão e cobertura de estados `PENDING`, `APPROVED`, `REJECTED`, `UNKNOWN` e indisponibilidade do provider sem desbloqueio local.
- Deduplicação de purchase callbacks por token transitório, proteção de geração contra callbacks stale e cobertura de cancelamento, timeout, entitlement revogado, troca de conta e acknowledgement falho.
- Retrys acessíveis para estados vazios de MatchIntent, Consent e Video, além de desconexão RTC no `ON_STOP` da Activity e descarte de credencial JIT pendente.
- Preflight E2E sanitizado em `tools/android-e2e-preflight.sh`, com detecção de ADB/device e instalação opcional de APK sem coletar credenciais, tokens ou PII.
- Runner manual `tools/android-e2e-session.sh` para verificar Play Services/Play Store, instalar APK, iniciar a sessão e emitir somente metadados sanitizados.
- `SecureSessionStoreInstrumentedTest` e `tools/android-e2e-auth-refresh.sh` para provar o armazenamento protegido e a substituição condicional em device, sem coletar credenciais; sem device, o runner permanece `BLOCKED`.
- Cabeçalho do Chat com menu acessível para evitar overflow em telas estreitas, mantendo Perfil, Premium, Solicitações e Sair disponíveis sem alterar a autoridade server-side.
- Contrato cooperativo `POST /auth/logout/refresh` integrado ao Android: payload mínimo `refresh_token`, sem Authorization, resposta idempotente `200 {ok:true}` e falha pública `503 REVOCATION_UNAVAILABLE`.
- Logout Android captura o snapshot access/refresh atomically, limpa o armazenamento antes da rede, usa refresh para revogação quando disponível, mantém fallback Bearer somente sem refresh, bloqueia clique duplicado e descarta resposta tardia após troca de conta.
- `SecureSessionStoreInstrumentedTest` também cobre captura do par após recriação do store; a execução física continua condicionada a device ADB autorizado.

### Limitações conhecidas

- A validação OAuth Google em dispositivo, rate limiting, persistência de conversas e observabilidade ainda estão pendentes.
- A revogação por refresh está implementada no contrato cooperativo e coberta por testes locais, mas o E2E físico ainda depende de device, duas contas e backend/DB reais; falhas `503 REVOCATION_UNAVAILABLE` permanecem fail-closed e não são convertidas em sucesso local.
- A configuração real do Web client ID e a validação OAuth em dispositivo dependem do ambiente Google do projeto.
- A chamada RTC real depende de um backend com LiveKit configurado, URL pública `wss://`, credenciais server-side e pelo menos dois usuários autenticados; nenhum segredo LiveKit é distribuído no APK.
- Os testes locais exercitam contratos, estados e gates, mas não substituem a validação de mídia com duas contas em um ambiente LiveKit real.
- Compra e restauração reais dependem de produto configurado no Google Play Console, credenciais de produção/teste, backend Billing/RTDN configurado e conta licenciada; a assinatura server-side não é simulada pelo Android.
- O AAB de release ainda depende de configuração de assinatura do aplicativo e dos gates externos do Play Console.
- Age Assurance hosted real depende de Didit, webhook autenticado, URL de verificação HTTPS e dispositivo/navegador; os testes locais não provam provider E2E nem aprovação real.
- Testes de banco continuam dependentes das variáveis PostgreSQL do ambiente de CI ou de execução local.

## [0.1.0] — Etapa 0 + Etapa 1 (implementação de schema e fundação)

### Adicionado

- Estrutura de repositório conforme Blueprint V1.2 §14.
- Stack backend declarada: TypeScript 5.7 / Node 22 / pg / node-pg-migrate / Jest / ESLint / Prettier.
- Configuração por ambiente com abstração de segredos (`SecretResolver`).
- Migrations 001–006: extensões, tabelas core, consent/session com triggers,
  moderação/billing/suporte, audit log com hash chaining, papéis e GRANTs.
- Interfaces de fornecedor (contratos apenas): AgeAssurance, RTC, Payments, Notifications, Ads.
- Suíte adversarial de banco: invariantes, elegibilidade de sessão, privilégios, cadeia de hash.
- CI com PostgreSQL real, typecheck, lint, migrations, testes de banco e secret scanning.

### Não incluído (etapas posteriores)

UI social completa, SMS, Didit, APIs de Matchmaking/Consent,
LiveKit, Play Billing, FCM, VibeOS, infraestrutura GCP de produção.
