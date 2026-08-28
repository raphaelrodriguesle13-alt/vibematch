# VibeMatch — Continuidade de Implementação

Atualizado em 2026-08-28.

## Estado confirmado

- O projeto está disponível em `vibematch/`; Node alvo 22+.
- A branch operacional é `continuity`; `main` permanece fora do fluxo cooperativo até decisão explícita de release.
- O backend é autoridade para Auth, sessão/refresh, Age Assurance, telefone, MatchIntent, Consent, Video Session, LiveKit, moderação, Block, Billing e entitlement.
- Google Auth server-side emite access JWT + refresh opaco rotativo; logout por refresh é idempotente e fail-closed em falha de revogação.
- `/auth/google`, `/auth/refresh`, `/auth/logout/refresh`, telefone e demais entradas críticas possuem rate limiting distribuído conforme os contratos atuais; `/auth/google` é limitado antes da verificação OIDC.
- O Android usa Credential Manager para Google, armazenamento protegido para sessão, refresh single-flight, retry único e limpeza local antes da revogação de logout.
- Perfil, Age Assurance hosted, telefone, MatchIntent, Consent, Video Session/LiveKit JIT, Block/Report e Billing server-authorized estão integrados no cliente conforme os contratos documentados.
- Nenhum vídeo/token é autorizado pelo cliente; Consent `ACCEPTED_BOTH`, elegibilidade e JIT permanecem server-side.
- O CI atual executa PostgreSQL 16, typecheck, lint, Prettier, migrations, validação de runtime roles/objetos de segurança, testes DB/privilégios, unit tests, secret scanning, testes Android e debug build.
- A evidência mais recente antes desta atualização é o VibeMatch CI #462 no HEAD `4d9cafd3a56f9dab44ddf10c25d1a66813b7b832`, com `verify` e `android` concluídos com sucesso.
- O próximo blocker legítimo de release é E2E externo em dispositivo/provedores reais, não falta conhecida de CI/backend.

## Ordem atual de continuidade

1. Preservar CI verde e corrigir regressões cooperativas apenas com mudanças mínimas compatíveis.
2. Executar Google OIDC real em device: login A → emissão de sessão → refresh/rotação → expiração → rejeição de refresh antigo → `/auth/logout/refresh` → troca para conta B.
3. Executar Didit/Age Assurance real: hosted start, `PENDING`, reconcile/webhook, `APPROVED`, `REJECTED` e indisponibilidade fail-closed.
4. Executar SMS/Twilio: start → OTP → confirm → `phone_verified` server-side, sem vazamento de OTP/token.
5. Executar MatchIntent + Consent com contas A/B elegíveis; `ACCEPTED_BOTH` somente após ambas as decisões server-side.
6. Executar LiveKit real com duas partes: JIT, mídia, lifecycle, retorno de background, Block/revogação e rejeição de token stale.
7. Executar Block/Report e confirmar encerramento/revogação server-side sem ressurreição de sessão.
8. Executar Play Billing sandbox/Internal Testing: compra, pending, restore, renovação, grace/account hold, cancelamento/reembolso e RTDN, sempre com entitlement server-authoritative.
9. Somente depois desses E2E: assinatura final, políticas operacionais, privacidade, observabilidade de produção, backup/restauração e decisão de Release Candidate.

A execução externa está rastreada na Issue #2 e em `docs/ANDROID_E2E_RELEASE_PLAN.md`. Casos sem device/credencial real permanecem `BLOCKED`; mocks, unit tests e builds não contam como E2E PASS.

## Invariantes

- Nenhum vídeo/token sem `ACCEPTED_BOTH` válido e revalidação server-side.
- Bloqueio, suspensão, exclusão e moderação impedem/revogam acesso inclusive em condição de corrida.
- Runtime não pode desabilitar triggers críticos.
- `audit_logs` permanece append-only/tamper-evident conforme o desenho vigente.
- Premium só existe quando o backend confirma entitlement.
- Nenhum segredo, OTP, purchase token, LiveKit token, Google ID token ou refresh token deve ser persistido em logs/documentação/repositório.
- Casos críticos de segurança e moderação não podem ser aprovados por estado local do Android.

## Regra de pronto

Não marcar Release Candidate até build, backend, autenticação, matchmaking, consentimento, vídeo, moderação, billing, exclusão, observabilidade, backup/restauração e gates críticos possuírem evidência de execução real. Para integrações externas, `PASS` exige device/provider real; ausência de pré-requisito deve permanecer `BLOCKED` com motivo objetivo.
