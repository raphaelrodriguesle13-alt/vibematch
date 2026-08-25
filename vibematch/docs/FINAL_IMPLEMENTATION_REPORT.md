# FINAL IMPLEMENTATION REPORT — ETAPAS 0–1

## Aviso preliminar, obrigatório antes de qualquer outra seção

Tentei novamente, de forma exaustiva, encontrar um caminho de execução real nesta rodada
(sondagem de proxy/DNS, conexão TCP direta, cache local, binários de PostgreSQL em todo
o filesystem, node_modules globais). Evidência concreta e reproduzível:

```
$ curl -sv https://registry.npmjs.org/pg
< HTTP/2 403
< x-deny-reason: host_not_allowed

$ which docker psql postgres initdb
(nada encontrado)
```

Isso é `host_not_allowed` — uma política de rede do ambiente, não uma falha
temporária. **ENVIRONMENT BLOCKER**, categoria D da sua própria taxonomia (item 21).
Não fabriquei nenhuma execução. Todo teste abaixo marcado `NOT EXECUTED` é literal.

## A. Corrections Applied

| # | Correção | Arquivo | Status |
|---|---|---|---|
| 1 | `svc_auth` restrito a `phone_verified`; `status`/`age_assurance_status` fora de alcance | `migrations/006` | Já aplicado em rodada anterior; reconfirmado nesta |
| 2 | `svc_profile` criado, dono de `profiles`/`interests`/`user_interests`/`age_assurance_status` | `migrations/006` | Já aplicado; reconfirmado |
| 3 | `svc_moderation`: `UPDATE(status)` em `users`; `UPDATE` de 3 colunas em `consents` | `migrations/006` | Já aplicado; reconfirmado |
| 4 | `svc_matchmaking` sem GRANT nas colunas estruturais de `consents` + trigger `enforce_consent_structural_immutability` | `migrations/003`, `006` | Já aplicado; **bug real encontrado e corrigido nesta rodada** (ver abaixo) |
| 5 | `SET search_path` em todas as 4 funções `SECURITY DEFINER`; `REVOKE ALL ... FROM PUBLIC` em todas as funções privilegiadas | `migrations/003`, `005` | Já aplicado; reconfirmado |
| 6 | `verify_audit_chain`/`verify_consent_decision_chain` validam `prev_hash` e `row_hash` separadamente | `migrations/005` | Já aplicado; reconfirmado |
| 7 | Caller não fornece `row_hash`/`prev_hash`; GRANT de `audit_logs` omite essas colunas | `migrations/006` | Já aplicado; reconfirmado |
| 8 | Sem `ALL SEQUENCES`; nenhum GRANT de sequence concedido (colunas `IDENTITY` não exigem) | `migrations/006` | Já aplicado; reconfirmado |
| 9 | `db-roles.sh` usa `-v newpass="$pass"` + `:'newpass'` (quoting seguro do psql), nunca concatenação | `scripts/db-roles.sh` | Já aplicado; reconfirmado |
| **NOVO** | **Bug real:** código morto duplicado em `enforce_consent_terminal_immutability()` (checagem estrutural repetida, nunca alcançada por causa da ordem alfabética dos triggers) | `migrations/003_consent_and_session.sql` | **Corrigido nesta rodada** — categoria A (bug de implementação), documentado em `docs/DECISIONS.md` D-IMPL-06 |
| **NOVO** | Comentário impreciso sobre `REVOKE ... FROM PUBLIC` e semântica de `EXECUTE` em funções de trigger | `migrations/003` | Corrigido — trigger não exige `EXECUTE` do papel para disparar, só bloqueia chamada direta |
| **NOVO** | `insertAudit()` no teste ainda enviava `row_hash='placeholder'` no INSERT, inconsistente com a correção 7 | `tests/db/hashchain/audit_chain.test.ts` | Corrigido — coluna removida do INSERT |
| **NOVO** | Testes ausentes: H08, coluna-por-coluna (auth/profile/moderation/matchmaking), imutabilidade estrutural, bloqueio de chamada direta a função `SECURITY DEFINER` | `tests/db/hashchain/audit_chain.test.ts`, `tests/db/privileges/column_grants.test.ts` (novo), `tests/db/negative/structural_immutability.test.ts` (novo), `tests/db/privileges/security_definer.test.ts` (novo) | Escritos nesta rodada |
| **NOVO** | CI documenta explicitamente por que `npm ci` vai falhar até existir lockfile | `.github/workflows/ci.yml` | Comentário adicionado |

## B. Repository Tree

```
vibematch/
├── .github/workflows/ci.yml
├── .env.example  .eslintrc.json  .gitignore  .prettierrc
├── README.md  docker-compose.yml  jest.config.js  package.json  tsconfig.json
├── android/README.md          infra/README.md
├── backend/src/config/env.ts
├── backend/src/shared/providers/index.ts
├── docs/{ARCHITECTURE,CHANGELOG,DECISIONS,ENV_VARS,RISKS}.md
├── migrations/001_extensions.sql … 006_roles_and_grants.sql
├── scripts/{install,db-up,db-down,db-roles,test}.sh
└── tests/
    ├── helpers/db.ts
    └── db/
        ├── negative/{invariants,structural_immutability}.test.ts
        ├── privileges/{roles,column_grants,security_definer}.test.ts
        └── hashchain/audit_chain.test.ts
```

## C. package-lock.json

**NÃO EXISTE.** Não pôde ser gerado — geração real exige `npm install` contra o registry,
que está bloqueado (`host_not_allowed`). Não criei um lockfile manualmente porque isso
seria fabricar exatamente o tipo de evidência falsa que você proibiu no item 22. Fica
como bloqueador real e explícito (RI-05 em `docs/RISKS.md`), não escondido.

## D. Migration Execution

| Migration | Executed | Result |
|---|---|---|
| 001–006 | **NOT EXECUTED** | Sem PostgreSQL disponível neste ambiente |

## E. Tests

Nenhum teste rodou. Tabela por arquivo, com a contagem real de casos que **existem no
código e estão prontos para rodar**, não uma simulação de resultado:

| Arquivo | Casos escritos | Status |
|---|---|---|
| `negative/invariants.test.ts` | 25 (N01–N16, S01–S09) | NOT EXECUTED |
| `negative/structural_immutability.test.ts` | 9 (SI01–SI06, CM01–CM03) | NOT EXECUTED |
| `privileges/roles.test.ts` | 11 diretos + 4 `test.each` × 4 papéis = 27 | NOT EXECUTED |
| `privileges/column_grants.test.ts` | 21 (auth/profile/moderation/matchmaking) | NOT EXECUTED |
| `privileges/security_definer.test.ts` | 1 + 3 `test.each` × 6 papéis = 19 | NOT EXECUTED |
| `hashchain/audit_chain.test.ts` | 8 (H01–H08) | NOT EXECUTED |
| **Total** | **~110 casos** | **NOT EXECUTED** |

Todos indicam `Expected`/`Actual` no próprio código-fonte (assertions Jest), mas nenhum
"Actual" real existe até rodar contra um PostgreSQL de verdade.

## F. Least Privilege Matrix

| Role | Allowed | Explicitly Denied (testado no código, não executado) |
|---|---|---|
| `svc_auth` | `SELECT` campos de auth em `users`; `INSERT(google_subject_id)`; `UPDATE(phone_verified)`; CRUD em `devices` | `UPDATE(status)`, `UPDATE(age_assurance_status)`, qualquer escrita em `profiles` |
| `svc_profile` | CRUD `profiles`; `SELECT` interests; `UPDATE(age_assurance_status)` | `UPDATE(status)`, qualquer escrita em `consents`/`sessions` |
| `svc_matchmaking` | `INSERT`/`UPDATE` restrito em `match_intents`/`consents` (colunas de transição) | `UPDATE` de `id`, `match_intent_id`, `user_a_id`, `user_b_id`, `created_at` |
| `svc_video` | `SELECT` em `consents`/`users`/`blocks`; CRUD em `sessions` | Qualquer `INSERT`/`UPDATE`/`DELETE` em `consents` |
| `svc_moderation` | `UPDATE(status)` em `users`; `UPDATE` de 3 colunas em `consents`; CRUD `reports`/`blocks`/`moderation_cases` | `UPDATE(google_subject_id)`; `UPDATE` de colunas estruturais de `consents` |
| `svc_billing` | CRUD `subscriptions`/`billing_events` | Qualquer escrita em `sessions`/`users` além de `SELECT(id,status)` |
| todos | `INSERT` em `audit_logs` (colunas de evento, nunca hash) | `UPDATE`/`DELETE` em `audit_logs`; `ALTER`/`DROP`/`DISABLE TRIGGER` em qualquer tabela |

## G. SECURITY DEFINER Review

| Função | Owner | SECURITY DEFINER | search_path | PUBLIC EXECUTE | Roles com EXECUTE |
|---|---|---|---|---|---|
| `audit_logs_hash_chain()` | migration/owner role | Sim | `pg_catalog, public` | Revogado | Nenhum runtime — só dispara via trigger |
| `verify_audit_chain()` | migration/owner role | Sim | `pg_catalog, public` | Revogado | Nenhum — ferramenta administrativa |
| `consent_decisions_hash_chain()` | migration/owner role | Sim | `pg_catalog, public` | Revogado | Nenhum runtime — só dispara via trigger |
| `verify_consent_decision_chain()` | migration/owner role | Sim | `pg_catalog, public` | Revogado | Nenhum — ferramenta administrativa |
| `audit_link_hash()`, `audit_canonical_payload()`, `consent_decision_canonical_payload()` | migration/owner role | Não (`IMMUTABLE SQL`) | `pg_catalog, public` | Revogado | Chamadas internamente pelas funções acima |
| `enforce_consent_matches_intent()`, `enforce_consent_terminal_immutability()`, `enforce_consent_structural_immutability()`, `enforce_session_eligibility()` | migration/owner role | Não (funções de trigger comuns) | 3 de 4 têm `SET search_path`; `enforce_consent_terminal_immutability` não declara (não é `SECURITY DEFINER`, então não é exigido pela correção 5, mas é inconsistência menor não corrigida) | Revogado | Nenhum runtime — disparam automaticamente via trigger, sem exigir EXECUTE do papel |

**Nota honesta:** `enforce_consent_terminal_immutability()` não tem `SET search_path` explícito. A correção 5 exigia isso para funções `SECURITY DEFINER` — esta não é uma delas, então tecnicamente não viola o pedido. Ainda assim, por consistência com as outras três funções de trigger do mesmo arquivo, seria mais limpo adicionar. **Não apliquei essa mudança cosmética agora** para não me desviar do escopo pedido; registrado aqui em vez de escondido.

## H. Release Gates

**GATE 42: NOT EXECUTED**
**GATE 43: NOT EXECUTED**
**GATE 44: NOT EXECUTED**

Nenhuma evidência real existe. O código que os testaria está pronto (`roles.test.ts`, `column_grants.test.ts`, `security_definer.test.ts`).

## I. Hash-chain Evidence

H08 está escrito em `tests/db/hashchain/audit_chain.test.ts`: cria 3 eventos, corrompe **somente** `prev_hash` da linha do meio (deixando `row_hash` intacto), executa `verify_audit_chain()` e exige `failure = 'PREV_HASH_LINK_MISMATCH'` no `broken_at` correto. **NOT EXECUTED** — sem PostgreSQL, não há saída real do verificador para reportar.

## J. Commands Actually Executed

```bash
curl -sv https://registry.npmjs.org/pg          # 403 host_not_allowed
which docker psql postgres initdb                # nada encontrado
python3 <script de validação estática de SQL>     # executado com sucesso, ver K
grep/sed/view em todo o repositório               # executado, usado nas seções A/F/G
```

Nenhum `npm ci`, `npm run migrate`, `npm test`, `docker compose up` foi executado — não existe onde executá-los.

## K. Raw Evidence

```
$ curl -sv https://registry.npmjs.org/pg 2>&1 | grep -iE "x-deny-reason|< HTTP"
< HTTP/2 403
< x-deny-reason: host_not_allowed

$ which docker psql postgres initdb
(sem saída — nenhum encontrado)

$ python3 <validação de balanceamento de parênteses e blocos $$ nas 6 migrations>
001_extensions.sql                         parens=+0 $$=0 -> OK
002_core_tables.sql                        parens=+0 $$=0 -> OK
003_consent_and_session.sql                parens=+0 $$=8 -> OK
004_moderation_billing_support.sql         parens=+0 $$=0 -> OK
005_audit_and_hash_chain.sql               parens=+0 $$=14 -> OK
006_roles_and_grants.sql                   parens=+0 $$=4 -> OK
resultado: 0 (todos consistentes)
```

`npm ci`, `npm run typecheck`, `npm run lint`, `npm test`: **NOT EXECUTED** — sem registry/Node modules instaláveis, sem PostgreSQL.

## L. Remaining Problems

1. **Nada foi executado contra PostgreSQL real, em nenhuma rodada até agora.** Este é o problema central e não está resolvido — só o proprietário, rodando localmente, resolve isso.
2. **`package-lock.json` ausente** — bloqueia `npm ci` no CI até a primeira instalação real.
3. **Inconsistência cosmética** em `enforce_consent_terminal_immutability()` sem `search_path` (não é bug de segurança, é falta de padronização — ver seção G).
4. Todas as pendências de produto já conhecidas (A1–A6, preço, CNPJ, LiveKit, etc.) continuam fora do escopo desta etapa, sem mudança.

---

ETAPA 0 STATUS: BLOCKED

ETAPA 1 STATUS: BLOCKED

READY FOR ETAPA 2: NO
