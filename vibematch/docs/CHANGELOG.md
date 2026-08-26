# Changelog

## [Unreleased] — MVP Android com RTC LiveKit seguro

### Adicionado

- Rota autenticada `POST /api/chat` integrada ao Fastify e ao middleware de sessão existente.
- Adaptador server-side da OpenAI Responses API com timeout e erros públicos estáveis.
- Primeiro módulo Android em Kotlin + Jetpack Compose, com tela de conversa, ViewModel e cliente OkHttp.
- Configuração `API_BASE_URL` para apontar o emulador para o backend local.
- Login Google via Credential Manager usando o Web client ID como audience do backend.
- Troca do Google ID token por JWT de sessão emitido pelo backend.
- Armazenamento da sessão com AndroidX Security Crypto e limpeza coordenada no logout.
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

### Limitações conhecidas

- A validação OAuth Google em dispositivo, renovação de sessão, rate limiting, persistência de conversas e observabilidade ainda estão pendentes.
- A configuração real do Web client ID e a validação OAuth em dispositivo dependem do ambiente Google do projeto.
- A chamada RTC real depende de um backend com LiveKit configurado, URL pública `wss://`, credenciais server-side e pelo menos dois usuários autenticados; nenhum segredo LiveKit é distribuído no APK.
- Os testes locais exercitam contratos, estados e gates, mas não substituem a validação de mídia com duas contas em um ambiente LiveKit real.
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
