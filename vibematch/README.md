# VibeMatch

Plataforma de descoberta social por interesses com **vídeo liberado somente após
consentimento explícito e mútuo**. Fonte técnica de verdade: **Blueprint V1.2**.

> **Estado:** fundação, schema e primeira camada de autenticação implementados no branch
> de continuidade. O backend também expõe chat autenticado e o primeiro cliente Android
> do chat já está disponível. Ver `docs/ARCHITECTURE.md` e `docs/CHATGPT_INTEGRATION.md`.

## Requisitos

- Node.js 22+
- Docker (para PostgreSQL e Redis locais)

## Setup

```bash
cp .env.example .env      # ajuste as senhas LOCAIS
bash scripts/install.sh   # instala dependências
bash scripts/db-up.sh     # sobe PostgreSQL + Redis
npm run migrate           # aplica o schema completo
bash scripts/db-roles.sh  # habilita LOGIN dos papéis de runtime
```

## Backend e chat

O backend Fastify expõe autenticação Google, logout com sessão revogável e `POST /api/chat`,
que exige um Bearer token de sessão antes de chamar o ChatGPT. A configuração detalhada
está em `docs/CHATGPT_INTEGRATION.md`.

## Cliente Android

A primeira tela Compose está em `android/`. Para apontar o emulador ao backend local, use
`cd android && ./gradlew :app:assembleDebug -PAPI_BASE_URL=http://10.0.2.2:3000`. A tela usa um token de
sessão temporário apenas durante o desenvolvimento, até a integração do login Google no
cliente.

## Testes

```bash
npm run typecheck
npm run lint
npm test                  # suíte completa
npm run test:db           # apenas banco (inclui Gates 42/43/44)
```

## Parar o ambiente

```bash
bash scripts/db-down.sh          # mantém os dados
docker compose down -v           # apaga também os dados
```

## Segurança

- Nenhum segredo real no repositório. `.env` está no `.gitignore`.
- Papéis de runtime **não** são owners de tabela (Blueprint V1.2 §2.5).
- `audit_logs` é **INSERT-only** para runtime e **tamper-evident** (não tamper-proof).
- As invariantes de consentimento vivem no **banco**, não na aplicação.
