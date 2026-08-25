# VibeMatch

Plataforma de descoberta social por interesses com **vídeo liberado somente após
consentimento explícito e mútuo**. Fonte técnica de verdade: **Blueprint V1.2**.

> **Estado:** Etapas 0–1 (fundação + schema) concluídas no código; a primeira camada
> backend de ChatGPT está implementada, mas autenticação, app Android e fornecedores de
> vídeo ainda não estão prontos. Ver `docs/ARCHITECTURE.md` e `docs/CHATGPT_INTEGRATION.md`.

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

## Backend de ChatGPT

O backend expõe `POST /api/chat` e mantém a chave da OpenAI exclusivamente no servidor.
Consulte `docs/CHATGPT_INTEGRATION.md` para o contrato HTTP, a configuração e as
limitações atuais.

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
