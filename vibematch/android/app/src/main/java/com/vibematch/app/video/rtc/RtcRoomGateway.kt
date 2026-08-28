package com.vibematch.app.video.rtc

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import io.livekit.android.LiveKit
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.renderer.SurfaceViewRenderer
import io.livekit.android.room.Room
import io.livekit.android.room.participant.LocalParticipant
import io.livekit.android.room.participant.RemoteParticipant
import io.livekit.android.room.track.LocalVideoTrack
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.VideoTrack
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class RtcRoomStatus {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    RECONNECTING,
    FAILED,
    PERMISSION_DENIED,
    UNKNOWN,
}

data class RtcRoomUiState(
    val status: RtcRoomStatus = RtcRoomStatus.DISCONNECTED,
    val remoteParticipantCount: Int = 0,
    val remoteVideoAvailable: Boolean = false,
    val localVideoEnabled: Boolean = false,
    val microphoneEnabled: Boolean = false,
    val jitTokenReady: Boolean = false,
    val errorMessage: String? = null,
)

interface RtcRoomGateway {
    val state: StateFlow<RtcRoomUiState>

    suspend fun connect(serverUrl: String, token: String)
    suspend fun disconnect()
    suspend fun setMicrophoneEnabled(enabled: Boolean)
    suspend fun setCameraEnabled(enabled: Boolean)
    fun attachLocalRenderer(renderer: SurfaceViewRenderer)
    fun detachLocalRenderer(renderer: SurfaceViewRenderer)
    fun attachRemoteRenderer(renderer: SurfaceViewRenderer)
    fun detachRemoteRenderer(renderer: SurfaceViewRenderer)
    fun disconnectNow()
}

class LiveKitRtcRoomGateway(
    context: Context,
    private val dispatcher: CoroutineDispatcher = Dispatchers.Main.immediate,
) : RtcRoomGateway {
    private val applicationContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + dispatcher)
    private val mutableState = MutableStateFlow(RtcRoomUiState())
    private var room: Room? = null
    private var eventsJob: Job? = null
    private var localRenderer: SurfaceViewRenderer? = null
    private var remoteRenderer: SurfaceViewRenderer? = null
    private var remoteVideoTrack: VideoTrack? = null
    private var localVideoTrack: LocalVideoTrack? = null
    private val disconnecting = AtomicBoolean(false)

    override val state: StateFlow<RtcRoomUiState> = mutableState.asStateFlow()

    override suspend fun connect(serverUrl: String, token: String) {
        if (serverUrl.isBlank() || token.isBlank()) {
            RtcDiagnostics.error("CONFIG_REJECTED")
            mutableState.value = RtcRoomUiState(
                status = RtcRoomStatus.FAILED,
                errorMessage = "A configuração de vídeo ou a credencial JIT está ausente.",
            )
            return
        }
        RtcDiagnostics.event("CONNECT_REQUESTED")
        disconnect()
        mutableState.value = RtcRoomUiState(status = RtcRoomStatus.CONNECTING)
        val newRoom = LiveKit.create(applicationContext)
        RtcDiagnostics.event("ROOM_CREATED")
        room = newRoom
        localRenderer?.let(newRoom::initVideoRenderer)
        remoteRenderer?.let(newRoom::initVideoRenderer)
        eventsJob = scope.launch {
            newRoom.events.collect { event -> handleEvent(event) }
        }
        try {
            RtcDiagnostics.event("SDK_CONNECT_START")
            newRoom.connect(serverUrl, token)
            RtcDiagnostics.event("SDK_CONNECT_SUCCESS", newRoom.remoteParticipants.size)
            mutableState.value = mutableState.value.copy(
                status = RtcRoomStatus.CONNECTED,
                errorMessage = null,
                remoteParticipantCount = newRoom.remoteParticipants.size,
            )
            attachExistingRemoteVideo(newRoom)
        } catch (error: Exception) {
            RtcDiagnostics.error("CONNECT_EXCEPTION", error)
            disconnectNow()
            mutableState.value = RtcRoomUiState(
                status = RtcRoomStatus.FAILED,
                errorMessage = "Não foi possível conectar à sala de vídeo.",
            )
        }
    }

    override suspend fun disconnect() {
        disconnectNow()
    }

    override suspend fun setMicrophoneEnabled(enabled: Boolean) {
        val currentRoom = room ?: return fail("A sala de vídeo não está conectada.")
        try {
            currentRoom.localParticipant.setMicrophoneEnabled(enabled)
            RtcDiagnostics.event(if (enabled) "MICROPHONE_ENABLED" else "MICROPHONE_DISABLED")
            mutableState.value = mutableState.value.copy(
                microphoneEnabled = enabled,
                errorMessage = null,
            )
        } catch (error: Exception) {
            RtcDiagnostics.error("MICROPHONE_FAILURE", error)
            fail("Não foi possível alterar o microfone.")
        }
    }

    override suspend fun setCameraEnabled(enabled: Boolean) {
        val currentRoom = room ?: return fail("A sala de vídeo não está conectada.")
        try {
            currentRoom.localParticipant.setCameraEnabled(enabled)
            val track = currentRoom.localParticipant
                .getTrackPublication(Track.Source.CAMERA)
                ?.track as? LocalVideoTrack
            localRenderer?.let { renderer -> localVideoTrack?.removeRenderer(renderer) }
            localVideoTrack = if (enabled) track else null
            if (enabled && track != null) {
                localRenderer?.let(track::addRenderer)
            }
            RtcDiagnostics.event(if (enabled) "CAMERA_ENABLED" else "CAMERA_DISABLED")
            mutableState.value = mutableState.value.copy(
                localVideoEnabled = enabled,
                errorMessage = null,
            )
        } catch (error: Exception) {
            RtcDiagnostics.error("CAMERA_FAILURE", error)
            fail("Não foi possível alterar a câmera.")
        }
    }

    override fun attachLocalRenderer(renderer: SurfaceViewRenderer) {
        if (localRenderer !== renderer) {
            localRenderer?.let(::detachLocalRenderer)
            localRenderer = renderer
            room?.initVideoRenderer(renderer)
        }
        localVideoTrack?.addRenderer(renderer)
    }

    override fun detachLocalRenderer(renderer: SurfaceViewRenderer) {
        if (localRenderer !== renderer) return
        localVideoTrack?.removeRenderer(renderer)
        localRenderer = null
        renderer.release()
    }

    override fun attachRemoteRenderer(renderer: SurfaceViewRenderer) {
        if (remoteRenderer !== renderer) {
            remoteRenderer?.let(::detachRemoteRenderer)
            remoteRenderer = renderer
            room?.initVideoRenderer(renderer)
        }
        remoteVideoTrack?.addRenderer(renderer)
    }

    override fun detachRemoteRenderer(renderer: SurfaceViewRenderer) {
        if (remoteRenderer !== renderer) return
        remoteVideoTrack?.removeRenderer(renderer)
        remoteRenderer = null
        renderer.release()
    }

    override fun disconnectNow() {
        if (!disconnecting.compareAndSet(false, true)) return
        RtcDiagnostics.event("LOCAL_DISCONNECT_START")
        try {
            eventsJob?.cancel()
            eventsJob = null
            remoteRenderer?.let(::detachRemoteRenderer)
            localRenderer?.let(::detachLocalRenderer)
            remoteVideoTrack = null
            localVideoTrack = null
            room?.disconnect()
            room?.release()
            room = null
            mutableState.value = RtcRoomUiState(status = RtcRoomStatus.DISCONNECTED)
            RtcDiagnostics.event("LOCAL_DISCONNECT_DONE")
        } finally {
            disconnecting.set(false)
        }
    }

    private fun handleEvent(event: RoomEvent) {
        when (event) {
            is RoomEvent.Connected -> {
                RtcDiagnostics.event("CONNECTED", event.room.remoteParticipants.size)
                mutableState.value = mutableState.value.copy(
                    status = RtcRoomStatus.CONNECTED,
                    errorMessage = null,
                )
            }
            is RoomEvent.Reconnecting -> {
                RtcDiagnostics.warning("RECONNECTING")
                mutableState.value = mutableState.value.copy(
                    status = RtcRoomStatus.RECONNECTING,
                    errorMessage = "A conexão de vídeo está sendo restabelecida.",
                )
            }
            is RoomEvent.Reconnected -> {
                RtcDiagnostics.event("RECONNECTED", event.room.remoteParticipants.size)
                mutableState.value = mutableState.value.copy(
                    status = RtcRoomStatus.CONNECTED,
                    errorMessage = null,
                )
                updateParticipantCount(event.room)
            }
            is RoomEvent.FailedToConnect -> {
                RtcDiagnostics.error("FAILED_TO_CONNECT", event.error)
                disconnectNow()
                mutableState.value = RtcRoomUiState(
                    status = RtcRoomStatus.FAILED,
                    errorMessage = "Não foi possível conectar à sala de vídeo.",
                )
            }
            is RoomEvent.ParticipantConnected -> {
                updateParticipantCount(event.room)
                RtcDiagnostics.event("PARTICIPANT_CONNECTED", event.room.remoteParticipants.size)
            }
            is RoomEvent.ParticipantDisconnected -> {
                remoteRenderer?.let { renderer -> remoteVideoTrack?.removeRenderer(renderer) }
                remoteVideoTrack = null
                updateParticipantCount(event.room)
                RtcDiagnostics.event("PARTICIPANT_DISCONNECTED", event.room.remoteParticipants.size)
            }
            is RoomEvent.TrackSubscribed -> {
                val track = event.track as? VideoTrack ?: return
                remoteVideoTrack = track
                remoteRenderer?.let(track::addRenderer)
                updateParticipantCount(event.room)
                RtcDiagnostics.event("REMOTE_VIDEO_SUBSCRIBED", event.room.remoteParticipants.size)
            }
            is RoomEvent.TrackUnsubscribed -> {
                val track = event.track as? VideoTrack ?: return
                remoteRenderer?.let(track::removeRenderer)
                if (remoteVideoTrack === track) remoteVideoTrack = null
                mutableState.value = mutableState.value.copy(remoteVideoAvailable = false)
                RtcDiagnostics.event("REMOTE_VIDEO_UNSUBSCRIBED", event.room.remoteParticipants.size)
            }
            is RoomEvent.Disconnected -> {
                if (disconnecting.get()) return
                RtcDiagnostics.warning("SERVER_DISCONNECTED")
                disconnectNow()
                mutableState.value = RtcRoomUiState(
                    status = RtcRoomStatus.DISCONNECTED,
                    errorMessage = "A conexão de vídeo foi encerrada pelo servidor.",
                )
            }
            else -> Unit
        }
    }

    private fun attachExistingRemoteVideo(currentRoom: Room) {
        currentRoom.remoteParticipants.values
            .asSequence()
            .mapNotNull { participant -> participant.cameraTrack() }
            .firstOrNull()
            ?.let { track ->
                remoteVideoTrack = track
                remoteRenderer?.let(track::addRenderer)
                mutableState.value = mutableState.value.copy(remoteVideoAvailable = true)
                RtcDiagnostics.event("REMOTE_VIDEO_EXISTING", currentRoom.remoteParticipants.size)
            }
    }

    private fun updateParticipantCount(currentRoom: Room) {
        mutableState.value = mutableState.value.copy(
            remoteParticipantCount = currentRoom.remoteParticipants.size,
            remoteVideoAvailable = remoteVideoTrack != null,
        )
    }

    private fun fail(message: String) {
        mutableState.value = mutableState.value.copy(
            status = RtcRoomStatus.FAILED,
            errorMessage = message,
        )
    }

    private fun RemoteParticipant.cameraTrack(): VideoTrack? =
        getTrackPublication(Track.Source.CAMERA)?.track as? VideoTrack
}

class RtcRoomViewModel(
    private val gateway: RtcRoomGateway,
) : ViewModel() {
    private val mutableState = MutableStateFlow(gateway.state.value)
    val state: StateFlow<RtcRoomUiState> = mutableState.asStateFlow()
    private var stateJob: Job? = null
    private var pendingJitToken: String? = null

    init {
        stateJob = viewModelScope.launch {
            gateway.state.collect {
                mutableState.value = it.copy(jitTokenReady = pendingJitToken != null)
            }
        }
    }

    private fun connect(serverUrl: String, token: String) {
        if (mutableState.value.status == RtcRoomStatus.CONNECTING) return
        viewModelScope.launch {
            gateway.connect(serverUrl, token)
        }
    }

    fun setPendingJitToken(token: String) {
        pendingJitToken = token.takeIf { it.isNotBlank() }
        mutableState.value = mutableState.value.copy(jitTokenReady = pendingJitToken != null)
        if (pendingJitToken != null) {
            RtcDiagnostics.event("JIT_TOKEN_READY")
        } else {
            RtcDiagnostics.warning("JIT_TOKEN_EMPTY")
        }
    }

    fun connectWithPendingJitToken(serverUrl: String): Boolean {
        val token = pendingJitToken
        pendingJitToken = null
        mutableState.value = mutableState.value.copy(jitTokenReady = false)
        if (serverUrl.isBlank() || token.isNullOrBlank()) {
            RtcDiagnostics.error("JIT_OR_URL_MISSING")
            mutableState.value = RtcRoomUiState(
                status = RtcRoomStatus.FAILED,
                errorMessage = "A credencial JIT ou a URL pública do vídeo está ausente.",
            )
            return false
        }
        RtcDiagnostics.event("JIT_TOKEN_CONSUMED")
        connect(serverUrl, token)
        return true
    }

    fun discardPendingJitToken() {
        val hadToken = pendingJitToken != null
        pendingJitToken = null
        mutableState.value = mutableState.value.copy(jitTokenReady = false)
        if (hadToken) RtcDiagnostics.event("JIT_TOKEN_DISCARDED")
    }

    fun disconnect() {
        val hadToken = pendingJitToken != null
        pendingJitToken = null
        mutableState.value = mutableState.value.copy(jitTokenReady = false)
        if (hadToken) RtcDiagnostics.event("JIT_TOKEN_DISCARDED")
        RtcDiagnostics.event("VIEWMODEL_DISCONNECT")
        viewModelScope.launch { gateway.disconnect() }
    }

    fun markPermissionDenied() {
        pendingJitToken = null
        RtcDiagnostics.warning("PERMISSION_DENIED")
        mutableState.value = RtcRoomUiState(
            status = RtcRoomStatus.PERMISSION_DENIED,
            errorMessage = "A câmera e o microfone são necessários para entrar na chamada. Solicite uma nova credencial JIT após permitir o acesso.",
        )
    }

    fun setMicrophoneEnabled(enabled: Boolean) {
        if (mutableState.value.status != RtcRoomStatus.CONNECTED) return
        viewModelScope.launch { gateway.setMicrophoneEnabled(enabled) }
    }

    fun setCameraEnabled(enabled: Boolean) {
        if (mutableState.value.status != RtcRoomStatus.CONNECTED) return
        viewModelScope.launch { gateway.setCameraEnabled(enabled) }
    }

    fun attachLocalRenderer(renderer: SurfaceViewRenderer) {
        gateway.attachLocalRenderer(renderer)
    }

    fun detachLocalRenderer(renderer: SurfaceViewRenderer) {
        gateway.detachLocalRenderer(renderer)
    }

    fun attachRemoteRenderer(renderer: SurfaceViewRenderer) {
        gateway.attachRemoteRenderer(renderer)
    }

    fun detachRemoteRenderer(renderer: SurfaceViewRenderer) {
        gateway.detachRemoteRenderer(renderer)
    }

    override fun onCleared() {
        stateJob?.cancel()
        pendingJitToken = null
        RtcDiagnostics.event("VIEWMODEL_CLEARED")
        gateway.disconnectNow()
        super.onCleared()
    }
}

class RtcRoomViewModelFactory(
    private val gateway: RtcRoomGateway,
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(RtcRoomViewModel::class.java)) {
            return RtcRoomViewModel(gateway) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}
