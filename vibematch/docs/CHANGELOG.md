# Changelog

## [Unreleased] — Chat Android conectado ao backend

### Adicionado

- Rota autenticada `POST /api/chat` integrada ao Fastify e ao middleware de sessão existente.
- Adaptador server-side da OpenAI Responses API com timeout e erros públicos estáveis.
- Primeiro módulo Android em Kotlin + Jetpack Compose, com tela de conversa, ViewModel e cliente OkHttp.
- Configuração `API_BASE_URL` para apontar o emulador para o backend local.
- Testes unitários do serviço, do adaptador e do contrato HTTP do chat.

### Limitações conhecidas

- O login Google ainda não está ligado à Activity; o token informado na tela é temporário,
  fica somente em memória e serve apenas para desenvolvimento.
- HTTPS, armazenamento seguro de sessão, rate limiting e persistência de conversas ainda estão pendentes.

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

UI Android, Google OAuth real, SMS, Didit, APIs de Matchmaking/Consent,
LiveKit, Play Billing, FCM, VibeOS, infraestrutura GCP de produção.
