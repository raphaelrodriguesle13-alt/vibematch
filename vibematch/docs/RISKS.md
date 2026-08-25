# Riscos — Estado da Implementação

Riscos de produto/arquitetura estão no Blueprint V1.2 §16. Este arquivo cobre
apenas riscos introduzidos ou observados durante a implementação.

| ID | Risco | Severidade | Situação |
|---|---|---|---|
| RI-01 | Funções de hash chain são `SECURITY DEFINER` (superfície privilegiada) | MÉDIO | Aceito, documentado em D-IMPL-01 |
| RI-02 | Advisory lock serializa appends de auditoria | BAIXO | Aceito no volume do MVP (D-IMPL-02) |
| RI-03 | Cadeia de hash é tamper-EVIDENT, não tamper-proof; owner ainda pode reescrevê-la | RESIDUAL DECLARADO | Já reconhecido na V1.2 §12 |
| RI-04 | Suíte de banco não pôde ser executada no ambiente de autoria (sem PostgreSQL/rede) | ALTO até execução | Bloqueia PASS dos Gates 42/43/44 |
| RI-05 | package-lock.json não pode ser gerado neste ambiente (registry npm bloqueado por política de rede: `x-deny-reason: host_not_allowed`) | ALTO até geração | Bloqueia `npm ci` no CI até o proprietário rodar `npm install` uma vez com rede real e commitar o lockfile |
| RI-06 | Nenhuma migration/teste foi executada contra PostgreSQL real em nenhuma rodada até agora | ALTO até execução | Ambiente de autoria não tem Docker/PostgreSQL/rede em nenhuma das tentativas (confirmado 2x com evidência de `x-deny-reason`) |
