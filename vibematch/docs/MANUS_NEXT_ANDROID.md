# VibeMatch — Próximo lote Android (Manus)

Atualizado em **2026-08-26** para coordenação com o backend na branch exclusiva `continuity`.

## Regra de coordenação

Trabalhar somente na branch `continuity`. Antes de cada commit importante, executar `git fetch origin continuity`, revisar divergências e preservar os commits backend existentes. Não usar force-push, não tocar na `main` e não reverter migrations, Auth, Consent, Video ou Moderation.

O ChatGPT permanece responsável por backend, banco, segurança, autorização, revogação e CI. O Manus prioriza Android, UX, ViewModels, gateways e a integração com os contratos reais abaixo.

## Estado server-side

Matchmaking, Consent e Video são fail-closed no servidor. O Android não é autoridade para telefone, idade, bloqueio, suspensão, consentimento, sessão, entitlement, room, identidade ou autorização de vídeo. Mesmo que um JWT antigo contenha `phoneVerified=false`, as rotas restritas consultam o estado atual do usuário no servidor.

O backend possui signer JIT LiveKit server-only em `backend/src/video/livekit-token-provider.ts`, com identidade e room derivados do estado autorizado no servidor e TTL curto. Chave e segredo LiveKit continuam exclusivamente no backend; o Android recebe apenas a credencial JIT retornada pelo endpoint autorizado.

## Contratos HTTP preservados

| Fluxo | Endpoint | Corpo Android | Regra server-side |
|---|---|---|---|
| MatchIntent | `GET /api/match-intents/incoming` | Nenhum | Participantes, validade e elegibilidade vêm do backend |
| MatchIntent | `POST /api/match-intents/:id/respond` | `decision` | Somente `ACCEPTED` ou `DECLINED` |
| Consent | `POST /api/consents` | `match_intent_id` | Identidade autenticada é derivada da sessão |
| Consent | `POST /api/consents/:id/decision` | `decision`, `request_id` UUID | Prazo, idempotência e transição são server-controlled |
| Video Session | `POST /api/video/sessions` | `consent_id` | Revalida Consent, idade, telefone e elegibilidade |
| Token RTC | `POST /api/video/sessions/:id/token` | Nenhum | Deriva room/identity, grants, TTL e rate limit |
| Block | `POST /api/blocks` | `blocked_id` | Revoga relações e sessões no backend |
| Report | `POST /api/reports` | `reported_id`, `session_id`, `category` | Severidade e encaminhamento são server-controlled |

A emissão do token revalida imediatamente antes de assinar sessão, revogação, consentimento mútuo, janela de vídeo, contas ativas, telefone, idade e bloqueios. O Android jamais gera token RTC, decide room authorization ou envia `user_id`, `room_name`, `severity` ou estado de elegibilidade para obter autorização.

## Lote RTC/LiveKit concluído

O SDK `io.livekit:livekit-android:2.28.1` foi adicionado isoladamente em `video/rtc`, com JitPack no `dependencyResolutionManagement`. O `LiveKitRtcRoomGateway` encapsula `LiveKit.create`, `Room.connect`, `disconnect/release`, eventos de conexão, participantes, tracks e renderers local/remoto. O gateway não liga câmera ou microfone ao conectar.

O `RtcRoomViewModel` recebe a credencial somente por callback transitório do `VideoSessionViewModel`. O token bruto fica em memória até o consumo único, não entra no estado Compose e não é persistido em `SharedPreferences`, `DataStore`, `SavedStateHandle`, logs, analytics ou crash metadata. Falha de conexão, falha de autorização e desconexão terminal limpam sala, tracks e renderers; a UI volta a exigir nova emissão server-side.

A tela de chamada só pede `CAMERA` e `RECORD_AUDIO` na ação explícita **Entrar na chamada**, depois de token JIT novo. Qualquer negação mantém o fluxo desconectado e sem publicação de mídia. A chamada oferece vídeo local/remoto, participante remoto, mute, câmera on/off, encerrar e Bloquear/denunciar. O callback de bloqueio confirmado chama `RtcRoomViewModel.disconnect()`.

O endpoint público `LIVEKIT_URL` é fornecido por BuildConfig. Em debug pode ficar vazio para demonstrar o fail-closed; em release o Gradle exige `wss://`. Nenhum endpoint é embutido como fallback e nenhuma chave/segredo LiveKit é aceito no Android.

## Testes adicionados

A suíte `RtcRoomGatewayTest` usa um gateway falso para confirmar que não há conexão sem token pendente, que o token é consumido uma única vez, que URL ausente falha fechada, que permissão negada não conecta e que `disconnect()` limpa o handoff pendente. `VideoSessionTest` também verifica que o token aparece apenas no callback transitório e não no estado exposto.

Os testes de Moderação já demonstravam que `onBlocked` só ocorre depois da confirmação server-side; nesta etapa esse callback foi conectado à desconexão RTC. A combinação de teste unitário do callback e wiring da factory preserva a regra de que o Android não decide punição nem revogação.

## Critério de conclusão do lote

O lote Android RTC é considerado implementado quando o código e os testes estiverem publicados em `continuity`, os gates Gradle passarem, nenhuma credencial RTC for persistida, a câmera não abrir antes do token JIT e das permissões, logout/saída/Block/falha terminal encerrarem a sala local e o handoff final registrar commits e resultados.

## Próximo trabalho

A próxima cooperação deve executar validação ponta a ponta com backend LiveKit configurado, URL pública `wss://`, Web client ID Google real e pelo menos duas contas autenticadas. Também permanecem a renovação de sessão, observabilidade, persistência de conversas, moderação operacional, execução DB com PostgreSQL e revisão de avisos de depreciação do armazenamento seguro antes da release.

## Fontes técnicas

[1]: https://docs.livekit.io/transport/sdk-platforms/android/ "LiveKit Android quickstart"
[2]: https://docs.livekit.io/intro/basics/connect/ "LiveKit connecting to a room"
[3]: https://github.com/livekit/client-sdk-android "LiveKit Android SDK"
