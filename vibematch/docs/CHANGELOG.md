# Changelog

## [Unreleased] — Onboarding e perfil Android integrados

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
- Aceite de MatchIntent sem criação local de Consent, vídeo, token RTC ou entitlement.
- Testes Android de contrato JSON, Age Assurance, telefone, MatchIntent, AuthViewModel e ProfileViewModel.

### Limitações conhecidas

- A validação OAuth Google em dispositivo, renovação de sessão, rate limiting, persistência de conversas e observabilidade ainda estão pendentes.
- A configuração real do Web client ID e a validação OAuth em dispositivo ainda dependem do ambiente Google do projeto.
- O backend ainda não expõe uma rota HTTP pública de Consent; a UX Android de consentimento mútuo permanece bloqueada até esse contrato existir.

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
