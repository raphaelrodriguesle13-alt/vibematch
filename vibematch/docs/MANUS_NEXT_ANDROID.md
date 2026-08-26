# VibeMatch — Próximo lote Android (Manus)

Atualizado em 2026-08-26 para coordenação paralela com o backend.

## Regra de coordenação

Trabalhar somente na branch `continuity`. Antes de cada commit importante, atualizar o HEAD e preservar os commits backend existentes. Não usar force-push, não tocar na `main` e não reverter migrations, Auth, Consent, Video ou Moderation.

O ChatGPT está responsável por backend, banco, segurança, autorização, revogação e CI. O Manus deve priorizar Android, UX, ViewModels, gateways e integração com os contratos reais abaixo.

## Estado liberado para este lote

O CI #182 ficou totalmente verde antes do início da integração LiveKit real. O backend agora também possui um signer JIT LiveKit server-only em `backend/src/video/livekit-token-provider.ts`, com identidade e room derivados do estado autorizado no servidor e TTL curto. O Android continua sem autoridade para criar, alterar ou prolongar credenciais RTC.

## Pré-condições server-side

Matchmaking, Consent e Video são fail-closed no servidor. O Android não é autoridade para telefone, idade, bloqueio, consentimento, sessão ou autorização de vídeo.

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

## Lote RTC/LiveKit Android — executar agora

1. Adicionar o SDK LiveKit Android de forma isolada na camada `video/rtc`; não misturar chamadas RTC dentro do gateway HTTP.
2. Criar um `RtcRoomGateway` com operações mínimas `connect(token)`, `disconnect()`, `setMicrophoneEnabled()`, `setCameraEnabled()` e observação de participantes/estado.
3. O `connect` só pode ser chamado depois que `VideoSessionViewModel` receber um token JIT novo do backend. Não persistir token em DataStore, SharedPreferences, SavedStateHandle, logs, analytics ou crash metadata.
4. Solicitar permissões de câmera/microfone apenas na entrada efetiva da experiência de vídeo. Negação de permissão deve manter o fluxo seguro e permitir sair/bloquear/reportar.
5. Desconectar e limpar mídia imediatamente em logout, `401`, `VIDEO_NOT_AUTHORIZED`, revogação, Block, Activity finish ou saída explícita do usuário.
6. Não implementar reconexão que reutilize indefinidamente o mesmo token. Em caso de credencial expirada/rejeitada, pedir novo token ao backend e passar novamente pela revalidação JIT.
7. Não usar display name, telefone, e-mail ou outro PII como identidade/room. O SDK deve consumir apenas o token assinado recebido; identidade e room são claims controladas pelo backend.
8. Tela de chamada deve ter câmera local/remota, mute, câmera on/off, encerrar, Block e Report. Block deve encerrar a experiência local imediatamente após a solicitação e depender do backend para revogação autoritativa.
9. Tratar desconexão inesperada fail-closed: parar tracks locais, limpar surfaces e voltar para estado não conectado; nunca manter UI de chamada ativa sem Room conectado.
10. Adicionar testes Android para: token nunca persistido; `connect` não chamado antes da autorização JIT; logout/revogação chama `disconnect`; erro de autorização não abre câmera; novo token requerido após falha/expiração; Block/Report acessíveis durante a chamada.

## Safety

- `POST /api/blocks`
  - body: `{ "blocked_id": "uuid" }`
  - disponível para usuário autenticado mesmo se telefone/idade não estiverem aprovados
- `POST /api/reports`
  - body: `{ "reported_id": "uuid", "session_id": "uuid|null", "category": "..." }`
  - categorias: `HARASSMENT`, `HATE`, `SEXUAL_CONTENT`, `SCAM`, `SPAM`, `OTHER`
  - NÃO enviar `severity`; ela é derivada pelo servidor

Bloquear alguém revoga imediatamente MatchIntent aberto, Consent ativo e sessão de vídeo entre o par.

## Critério de conclusão deste lote

O lote só é considerado concluído quando o Android compilar/testar no CI, nenhuma credencial RTC for persistida, a câmera não abrir antes do token JIT server-side, logout/Block/revogação encerrarem a room local e o handoff registrar os commits e testes executados.

Depois do lote, registrar commits, testes Gradle, build e qualquer incompatibilidade de contrato em `MANUS_HANDOFF.md`.
