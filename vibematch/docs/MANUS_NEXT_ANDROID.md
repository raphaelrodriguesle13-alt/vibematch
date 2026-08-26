# VibeMatch — Próximo lote Android (Manus)

Atualizado em 2026-08-26 para coordenação paralela com o backend.

## Regra de coordenação

Trabalhar somente na branch `continuity`. Antes de cada commit importante, atualizar o HEAD e preservar os commits backend existentes. Não usar force-push, não tocar na `main` e não reverter migrations, Auth, Consent, Video ou Moderation.

O ChatGPT está responsável por backend, banco, segurança, autorização, revogação e CI. O Manus deve priorizar Android, UX, ViewModels, gateways e integração com os contratos reais abaixo.

## Pré-condições server-side

Matchmaking, Consent e Video agora são fail-closed no servidor. O Android não é autoridade para telefone, idade, bloqueio, consentimento, sessão ou autorização de vídeo.

Mesmo que o JWT antigo ainda contenha `phoneVerified=false`, as rotas restritas consultam o estado atual do usuário no servidor. Não force logout/login depois de confirmar o telefone apenas para atualizar esse claim.

## Contratos HTTP para integrar

### Match Intent

- `POST /api/match-intents`
  - body: `{ "receiver_id": "uuid" }`
  - `201` com `{ data: MatchIntent }`
- `GET /api/match-intents/incoming`
  - `200` com `{ data: MatchIntent[] }`
- `POST /api/match-intents/:id/respond`
  - body: `{ "decision": "ACCEPTED" | "DECLINED" }`
  - `200` com `{ data: MatchIntent }`

### Consent

- `POST /api/consents`
  - body: `{ "match_intent_id": "uuid" }`
  - `201` com `{ data: Consent }`
- `POST /api/consents/:id/decision`
  - body: `{ "decision": "ACCEPTED" | "DECLINED", "request_id": "uuid" }`
  - `200` com `{ data: Consent }`

O `acting_user_id` e o `auth_session_ref` são derivados exclusivamente da sessão autenticada. O Android não deve enviar nem tentar controlar esses campos. `request_id` deve ser um UUID novo por decisão para idempotência/auditoria.

### Video

- `POST /api/video/sessions`
  - body: `{ "consent_id": "uuid" }`
  - `201` com metadata da sessão autorizada
- `POST /api/video/sessions/:id/token`
  - sem identidade, room ou consent no body
  - `200` com `{ data: { "session_id": "uuid", "token": "..." } }`

A emissão do token revalida no banco imediatamente antes de assinar: sessão, revogação, consentimento mútuo, janela de vídeo, contas ativas, telefone, idade e bloqueios. O Android jamais deve gerar token RTC ou decidir room authorization localmente.

### Safety

- `POST /api/blocks`
  - body: `{ "blocked_id": "uuid" }`
  - disponível para usuário autenticado mesmo se telefone/idade não estiverem aprovados
- `POST /api/reports`
  - body: `{ "reported_id": "uuid", "session_id": "uuid|null", "category": "..." }`
  - categorias: `HARASSMENT`, `HATE`, `SEXUAL_CONTENT`, `SCAM`, `SPAM`, `OTHER`
  - NÃO enviar `severity`; ela é derivada pelo servidor

Bloquear alguém revoga imediatamente MatchIntent aberto, Consent ativo e sessão de vídeo entre o par.

## UX Android pedida neste lote

1. Tela/lista de MatchIntents recebidos com aceitar/recusar.
2. Ação de criar MatchIntent a partir de um perfil/candidato já fornecido pelo backend; não inventar discovery local.
3. Estado de Consent explícito para cada participante, com aceitar/recusar e request UUID por decisão.
4. Fluxo de Video que solicita sessão e depois token JIT; nunca entra na sala antes do token server-side.
5. Botões Block e Report acessíveis inclusive em estados de erro/restrição.
6. Tratamento consistente de `401` como sessão expirada/revogada; `403` de telefone/idade volta ao gate correspondente; `409` indica estado não elegível/conflito e deve recarregar dados do servidor.
7. Testes Android de ViewModel/gateway para identidade não controlável pelo cliente, erros 401/403/409 e estados fail-closed.

## Pendência externa

O adapter LiveKit real do backend ainda pode estar pendente. O Android pode integrar o contrato HTTP e preparar a conexão com o SDK, mas não deve marcar vídeo ponta-a-ponta como concluído até receber um token LiveKit real de um backend configurado.

Depois do lote, registrar commits, testes Gradle, build e qualquer incompatibilidade de contrato neste handoff ou em `MANUS_HANDOFF.md`.
