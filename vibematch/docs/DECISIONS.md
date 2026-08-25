# Decision Log — Implementação

Decisões de arquitetura estão no Blueprint V1.2 e NÃO são alteradas aqui.
Este arquivo registra apenas decisões de *implementação* tomadas dentro dos limites da V1.2.

## D-IMPL-01 — Funções de hash chain como SECURITY DEFINER
**Contexto:** V1.2 §12 exige que o papel de runtime tenha `INSERT` e nada mais em `audit_logs`.
O encadeamento precisa ler o `row_hash` da linha anterior, o que exigiria `SELECT`.
**Decisão:** as funções `audit_logs_hash_chain()` e `consent_decisions_hash_chain()` são
`SECURITY DEFINER`, de propriedade do owner. O runtime continua sem `SELECT`.
**Consequência:** a lógica de encadeamento passa a ser superfície privilegiada e deve ser
revisada em qualquer alteração. Não altera nenhuma decisão arquitetural da V1.2.

## D-IMPL-02 — `pg_advisory_xact_lock` no append da cadeia
**Contexto:** inserts concorrentes poderiam produzir cadeia não determinística.
**Decisão:** serializar o append por advisory lock transacional.
**Trade-off:** appends de auditoria serializam entre si. Aceitável no volume do MVP;
reavaliar se a auditoria virar gargalo (não é decisão arquitetural, é ajuste local).

## D-IMPL-03 — Migrations em SQL puro com node-pg-migrate
**Contexto:** o schema depende de triggers, funções plpgsql, roles e GRANTs.
**Decisão:** migrations `.sql` versionadas, sem ORM gerando DDL.
**Motivo:** ORMs de alto nível não representam triggers/roles fielmente; a V1.2 exige que
as invariantes vivam no banco, não na aplicação.

## D-IMPL-04 — `chain_seq` em `consent_decisions`
**Contexto:** a tabela usa PK UUID, que não dá ordem determinística para a cadeia.
**Decisão:** coluna `chain_seq BIGINT GENERATED ALWAYS AS IDENTITY` para ordenação.
**Motivo:** cadeia de hash exige ordem total determinística.

## D-IMPL-05 — `svc_auth` adicionado aos papéis de runtime
**Contexto:** a V1.2 §2.5 lista matchmaking, video, moderation, billing. O Auth Service da
§1.2 também precisa de acesso a `users`/`devices`/`profiles`.
**Decisão:** criar `svc_auth` com privilégios mínimos, seguindo o mesmo princípio da §2.5.
**Classificação:** extensão consistente com a V1.2, não desvio. Registrado para revisão.

## D-IMPL-06 — Correção de bug real: código morto duplicado (migration 003)
**Contexto:** revisão encontrou `enforce_consent_terminal_immutability()` com uma cópia
duplicada das checagens estruturais já feitas por `enforce_consent_structural_immutability()`.
**Decisão:** removida a duplicação. A ordem alfabética dos nomes dos triggers
(`trg_enforce_consent_structural_immutability` roda antes de
`trg_enforce_consent_terminal_immutability`) garante que a checagem estrutural sempre
executa primeiro — a duplicação era código morto, nunca alcançado.
**Classificação:** BUG DE IMPLEMENTAÇÃO real, não achado de arquitetura. Corrigido sem
alterar nenhuma decisão do Blueprint V1.2.

## D-IMPL-07 — Correção de bug real: Down de 003 não removia enforce_consent_structural_immutability()
**Contexto:** revisão de simetria Up/Down em todas as 6 migrations encontrou que
`enforce_consent_structural_immutability()` era criada no Up de 003 mas nunca
explicitamente removida no Down (as outras 3 funções do arquivo eram; esta ficou de fora).
**Decisão:** adicionado `DROP FUNCTION IF EXISTS enforce_consent_structural_immutability();`
ao Down, antes do DROP de `enforce_consent_terminal_immutability` (ordem sem importância
aqui, pois não há dependência entre as duas).
**Verificação de simetria completa (001-006):** todas as tabelas, funções e roles criadas
em cada Up têm contrapartida explícita no Down, ou são removidas implicitamente por um
DROP TABLE de uma tabela da qual dependem (triggers de 003 removidos com suas tabelas).
Ordem de DROP TABLE respeita dependências de FK em 002 e 004 (dependente antes do
referenciado). Nenhum outro problema de simetria encontrado.
**Classificação:** BUG DE IMPLEMENTAÇÃO real (vazamento de objeto órfão em rollback),
não achado de arquitetura. Não altera nenhuma decisão do Blueprint V1.2.
