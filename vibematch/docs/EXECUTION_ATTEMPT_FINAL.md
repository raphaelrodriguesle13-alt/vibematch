# EXECUTION ATTEMPT REPORT — Etapas 0–1 (rodada final)

## Correção aplicada antes da tentativa de execução

**Bug real encontrado:** `migrations/003_consent_and_session.sql` criava
`enforce_consent_structural_immutability()` no Up mas não a removia no Down —
objeto órfão em caso de rollback. Corrigido: `DROP FUNCTION IF EXISTS
enforce_consent_structural_immutability();` adicionado ao Down.

**Verificação de simetria Up/Down em 001–006:** extraí programaticamente (não por
leitura visual) todas as tabelas/funções/roles criadas em cada Up e comparei contra
o Down correspondente. Único problema real foi o acima, já corrigido. Ordem de
`DROP TABLE` respeita dependências de FK em 002 e 004 (tabela dependente sempre
dropada antes da referenciada). Documentado em `docs/DECISIONS.md` D-IMPL-07.

Nenhuma outra alteração de código nesta rodada — nenhum novo teste, nenhuma
reescrita, conforme instruído.

## Tentativa de execução real (evidência)

```
$ curl -sv https://registry.npmjs.org/pg     → 403, x-deny-reason: host_not_allowed
$ curl -sv https://registry.npmmirror.com/pg → 403, x-deny-reason: host_not_allowed
$ which docker docker-compose                → not found
$ which postgres psql initdb pg_ctl           → nada encontrado
$ curl -sv http://archive.ubuntu.com/ubuntu/  → 403, x-deny-reason: host_not_allowed
```

Três hosts de rede diferentes testados (registry npm principal, mirror alternativo,
apt), mais checagem de Docker e de qualquer binário PostgreSQL nativo no filesystem.
Todos os caminhos de rede retornam a mesma negação de política, não uma falha
transitória. Nenhum binário de banco existe neste container.

## ENVIRONMENT BLOCKER — confirmado

Não é possível gerar `package-lock.json` (exige `npm install` real), executar
`npm ci`, subir PostgreSQL, rodar migrations, Up/Down/Up, typecheck, lint, ou
qualquer um dos ~110 testes. Isso não é um problema do projeto VibeMatch — é uma
restrição do ambiente onde estou rodando, fora do meu controle.

Todos os arquivos estão preservados e corrigidos. O pacote `.tar.gz` desta rodada
contém exatamente o repositório da rodada anterior + a correção do Down de 003.

## O que o proprietário precisa rodar, literalmente, para obter evidência real

```bash
tar -xzf vibematch-etapa-0-1-final.tar.gz && cd vibematch
cp .env.example .env                 # ajustar senhas locais
bash scripts/install.sh              # gera package-lock.json real + npm ci
bash scripts/db-up.sh                # PostgreSQL 16 + Redis via Docker
npm run migrate                      # 001-006 em banco vazio
npm run migrate:down && npm run migrate   # Up/Down/Up
bash scripts/db-roles.sh
npm run typecheck && npm run lint
npm test                             # suíte completa, ~110 casos
```

Não há atalho — isto exige uma máquina com Node 22, Docker e acesso real à internet, nenhum dos quais existe neste ambiente de autoria.
