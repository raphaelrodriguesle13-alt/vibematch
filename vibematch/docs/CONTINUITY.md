# VibeMatch — Continuidade de Implementação

Atualizado em 2026-08-26.

## Estado confirmado

- O pacote original foi descompactado com sucesso no GitHub.
- O projeto está disponível em `vibematch/`.
- Node alvo: 22+.
- Etapas 0–1 contêm configuração, migrations, scripts de banco, CI e testes.
- O branch de continuidade já contém autenticação Google server-side, sessões revogáveis e verificação telefônica.
- O backend possui chat autenticado e o módulo Android consome `POST /api/chat`.
- O Android agora obtém o Google ID token via Credential Manager, troca-o por sessão backend e guarda a sessão com AndroidX Security Crypto.
- Logout Android revoga a sessão no backend, limpa o estado de credencial Google e remove a sessão local.
- O Android agora possui onboarding e edição de perfil, carregando interesses e salvando o perfil pelas rotas autenticadas do backend.
- O backend também expõe Age Assurance e MatchIntent; chat e MatchIntent falham fechado quando o status de idade não é `APPROVED`.
- O Android consulta `GET /api/age-assurance/status` e mantém o usuário no cartão de bloqueio para qualquer status não aprovado ou desconhecido.
- O Android agora possui onboarding telefônico em duas etapas, com `POST /auth/phone/start` e `POST /auth/phone/confirm`, antes de exibir o chat.
- A confirmação server-side atualiza apenas a dica local `phone_verified`; o JWT existente não é renovado pelo cliente.
- O Android agora possui uma inbox de MatchIntent para `GET /api/match-intents/incoming` e respostas `ACCEPTED`/`DECLINED`, sempre depois de perfil, Age Assurance e telefone confirmados.
- O backend reforçou os gates de telefone para MatchIntent, Consent e Video e revoga estados restritos quando a verificação é perdida.
- A próxima barreira legítima é validar SMS/OAuth/MatchIntent em dispositivo, renovar/expirar sessões e obter evidência verde de CI/migrations/testes.

## Ordem de continuidade

1. Validar CI e migrations Up/Down/Up.
2. Corrigir qualquer falha das etapas 0–1.
3. Validar telefone e MatchIntent com provedores/ambiente reais e tratar expiração/renovação de sessão.
4. Consolidar o chat Android: HTTPS, rate limiting, persistência e observabilidade.
5. Adicionar rota HTTP pública de Consent antes de implementar consentimento mútuo no Android.
6. Etapa 6: Consent mútuo.
7. Etapa 7: Video Session/LiveKit com revalidação JIT.
8. Etapa 8: denúncia, bloqueio e moderação.
9. Só depois: billing, exclusão, notificações, VibeOS, auditoria e hardening.

## Invariantes

- Nenhum vídeo/token sem `ACCEPTED_BOTH` válido.
- Bloqueio, suspensão, exclusão e moderação devem impedir/revogar acesso em condição de corrida.
- Runtime não pode desabilitar triggers críticos.
- `audit_logs` permanece append-only.
- Casos críticos de segurança exigem humano.
- Nenhum segredo no repositório.

## Regra de pronto

Não marcar Release Candidate até build, backend, autenticação, matchmaking, consentimento, vídeo, moderação, billing, exclusão, observabilidade, backup/restauração e gates críticos possuírem evidência de execução real.
