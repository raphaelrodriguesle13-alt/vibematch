# VibeMatch — Continuidade de Implementação

Atualizado em 2026-08-25.

## Estado confirmado

- O pacote original foi descompactado com sucesso no GitHub.
- O projeto está disponível em `vibematch/`.
- Node alvo: 22+.
- Etapas 0–1 contêm configuração, migrations, scripts de banco, CI e testes.
- A próxima barreira legítima é obter evidência verde de CI/migrations/testes antes de avançar para Auth.

## Ordem de continuidade

1. Validar CI e migrations Up/Down/Up.
2. Corrigir qualquer falha das etapas 0–1.
3. Implementar Etapa 2: Auth (Google OAuth, telefone, JWT/refresh).
4. Etapa 3: Profile/Interests.
5. Etapa 4: Age Assurance, fail-closed.
6. Etapa 5: MatchIntent.
7. Etapa 6: Consent mútuo.
8. Etapa 7: Video Session/LiveKit com revalidação JIT.
9. Etapa 8: denúncia, bloqueio e moderação.
10. Só depois: billing, exclusão, notificações, VibeOS, auditoria, observabilidade e hardening.

## Invariantes

- Nenhum vídeo/token sem `ACCEPTED_BOTH` válido.
- Bloqueio, suspensão, exclusão e moderação devem impedir/revogar acesso em condição de corrida.
- Runtime não pode desabilitar triggers críticos.
- `audit_logs` permanece append-only.
- Casos críticos de segurança exigem humano.
- Nenhum segredo no repositório.

## Regra de pronto

Não marcar Release Candidate até build, backend, autenticação, matchmaking, consentimento, vídeo, moderação, billing, exclusão, observabilidade, backup/restauração e gates críticos possuírem evidência de execução real.
