# LiveKit Android — notas de integração

Atualizado em 2026-08-26 durante a implementação RTC do VibeMatch.

## Fontes oficiais consultadas

- Android quickstart: https://docs.livekit.io/transport/sdk-platforms/android/
- Connecting to LiveKit: https://docs.livekit.io/intro/basics/connect/
- SDK Android no GitHub: https://github.com/livekit/client-sdk-android
- Exemplo oficial básico: https://github.com/livekit/client-sdk-android/blob/main/sample-app-basic/src/main/java/io/livekit/android/sample/basic/MainActivity.kt

## Decisões preservadas no Android

A documentação oficial indica a dependência Maven `io.livekit:livekit-android` e recomenda incluir JitPack no `dependencyResolutionManagement`. O repositório oficial consultado mostra a versão estável `2.28.1`; o VibeMatch fixa essa versão, sem usar `2.+`.

A conexão Android usa `LiveKit.create(applicationContext)`, `Room.connect(serverUrl, token)` e `Room.disconnect()`. O SDK disponibiliza `RoomEvent.Connected`, `Reconnecting`, `Reconnected`, `FailedToConnect`, `Disconnected`, `ParticipantConnected`, `ParticipantDisconnected`, `TrackSubscribed` e `TrackUnsubscribed`, além de `LocalParticipant.setMicrophoneEnabled` e `setCameraEnabled`.

A URL pública LiveKit deve ser `wss://` em release. O token é assinado somente pelo backend; o Android recebe a credencial JIT pela API VibeMatch e não deriva identidade, room, participantes, permissões, prazo ou segredo. O backend LiveKit usa identidade UUID opaca, sala gerada pelo servidor e TTL curto.

A documentação também exige declarar `CAMERA` e `RECORD_AUDIO` e solicitar essas permissões em runtime. No VibeMatch, a declaração fica no Manifest, mas a solicitação ocorre somente quando o usuário entra na etapa efetiva de chamada, depois de obter token JIT novo. Negação de permissão mantém o estado desconectado/fail-closed.

O token não é persistido em `DataStore`, `SharedPreferences`, `SavedStateHandle`, logs, analytics ou crash metadata. Logout, saída explícita, revogação, falha de conexão e bloqueio devem limpar a conexão local e o token pendente. Reconexão automática do SDK não deve reutilizar indefinidamente uma credencial expirada; uma falha de autorização exige novo token e nova revalidação server-side.
