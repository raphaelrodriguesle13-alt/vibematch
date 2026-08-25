# VibeMatch — Continuidade de Implementação

Atualizado em 2026-08-25.

## Estado confirmado

- O pacote original foi descompactado com sucesso no GitHub.
- O projeto está disponível em `vibematch/`.
- Node alvo: 22+.
- Etapas 0–1 contêm configuração, migrations, scripts de banco, CI e testes.
- O branch de continuidade já contém autenticação Google server-side, sessões revogáveis e verificação telefônica.
- O backend possui chat autenticado e o módulo Android inicial consome `POST /api/chat`.
- A próxima barreira legítima é obter evidência verde de CI/migrations/testes e ligar o login Google ao Android.

## Ordem de continuidade

1. Validar CI e migrations Up/Down/Up.
2. Corrigir qualquer falha das etapas 0–1.
3. Conectar o login Google e logout ao cliente Android com armazenamento seguro de sessão.
4. Consolidar o chat Android: HTTPS, rate limiting, persistência e observabilidade.
5. Etapa 3: Profile/Interests.
6. Etapa 4: Age Assurance, fail-closed.
7. Etapa 5: MatchIntent.
8. Etapa 6: Consent mútuo.
9. Etapa 7: Video Session/LiveKit com revalidação JIT.
10. Etapa 8: denúncia, bloqueio e moderação.
11. Só depois: billing, exclusão, notificações, VibeOS, auditoria e hardening.

## Invariantes

- Nenhum vídeo/token sem `ACCEPTED_BOTH` válido.
- Bloqueio, suspensão, exclusão e moderação devem impedir/revogar acesso em condição de corrida.
- Runtime não pode desabilitar triggers críticos.
- `audit_logs` permanece append-only.
- Casos críticos de segurança exigem humano.
- Nenhum segredo no repositório.

## Regra de pronto

Não marcar Release Candidate até build, backend, autenticação, matchmaking, consentimento, vídeo, moderação, billing, exclusão, observabilidade, backup/restauração e gates críticos possuírem evidência de execução real.
