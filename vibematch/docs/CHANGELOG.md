# Changelog

## [Unreleased] — Primeira camada de ChatGPT

### Adicionado
- Contrato `ChatGptProvider` e adaptador server-side para a OpenAI Responses API.
- Serviço `ChatService` com prompt de desenvolvedor controlado pelo backend,
  validação de mensagem e histórico limitado.
- Endpoint `GET /health` e `POST /api/chat`, com limite de payload e erros públicos estáveis.
- Variáveis de ambiente, documentação do contrato HTTP e testes unitários sem dependência
  de PostgreSQL ou de uma chave real.

### Limitações conhecidas
- Autenticação, autorização, rate limiting, persistência de conversas e app Android ainda
  não foram implementados.
- A execução completa do typecheck, lint e testes depende da instalação das dependências;
  `node_modules` e `package-lock.json` ainda não estão presentes no ambiente de autoria.

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
