# Riscos — Estado da Implementação

Atualizado em 2026-08-28.

Riscos de produto/arquitetura estão no Blueprint V1.2 §16. Este arquivo cobre
apenas riscos introduzidos ou observados durante a implementação.

| ID    | Risco                                                                            | Severidade                  | Situação atual                                                                                                                                        |
| ----- | -------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| RI-01 | Funções de hash chain são `SECURITY DEFINER` (superfície privilegiada)           | MÉDIO                       | Aceito, documentado em D-IMPL-01; CI valida objetos de segurança e privilégios.                                                                       |
| RI-02 | Advisory lock serializa appends de auditoria                                     | BAIXO                       | Aceito no volume do MVP (D-IMPL-02).                                                                                                                  |
| RI-03 | Cadeia de hash é tamper-EVIDENT, não tamper-proof; owner ainda pode reescrevê-la | RESIDUAL DECLARADO          | Já reconhecido na V1.2 §12.                                                                                                                           |
| RI-04 | Validação real em dispositivo/provedores externos ainda não foi executada        | ALTO até E2E                | `BLOCKED` por device autorizado e configuração real de Google OIDC, Didit, SMS/Twilio, LiveKit e Play Billing/RTDN. Não é falha comprovada de código. |
| RI-05 | AAB de release ainda depende de assinatura/Play Internal Testing reais           | ALTO até publicação interna | Exige upload key/Play App Signing, app/produto configurados e conta tester; segredos não devem entrar no repositório.                                 |
| RI-06 | RTC/revogação de duas partes ainda carece de evidência real                      | ALTO até E2E                | Exige duas contas/dispositivos e LiveKit real; contratos locais/JIT continuam fail-closed.                                                            |
| RI-07 | Documentação histórica pode conter estados antigos de blockers já resolvidos     | BAIXO                       | `CONTINUITY.md`, este arquivo e `MANUS_HANDOFF.md` são as referências atuais; relatórios históricos não substituem evidência do HEAD/CI.              |

## Bloqueios históricos resolvidos

Os itens abaixo deixaram de bloquear a branch `continuity` e não devem ser reabertos sem nova evidência:

- `package-lock.json` existe e o CI instala dependências com sucesso.
- O GitHub Actions sobe PostgreSQL 16 real para migrations/testes.
- Typecheck, lint, Prettier, migrations, runtime roles, objetos de segurança, testes DB/privilégios, unit tests e secret scanning executam no job `verify`.
- Testes Android e debug build executam no job `android`.
- O hardening de `/auth/google` aplica rate limit distribuído antes da verificação OIDC e falha fechado quando o limiter está indisponível.

A evidência mais recente antes desta atualização é o workflow VibeMatch CI #462 no HEAD `4d9cafd3a56f9dab44ddf10c25d1a66813b7b832`, com `verify` e `android` concluídos com sucesso.

## Próximo risco a reduzir

Executar `docs/ANDROID_E2E_RELEASE_PLAN.md` em dispositivo autorizado, na ordem Google OIDC/sessão → Didit → SMS → MatchIntent/Consent → LiveKit → Block/Report → Billing. Cada caso deve permanecer `BLOCKED` até existir evidência real ou virar `PASS`/`FAIL` com evidência sanitizada.
