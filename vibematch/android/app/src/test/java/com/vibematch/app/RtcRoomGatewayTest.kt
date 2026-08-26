package com.vibematch.app

import com.vibematch.app.video.rtc.RtcRoomGateway
import com.vibematch.app.video.rtc.RtcRoomStatus
import com.vibematch.app.video.rtc.RtcRoomUiState
import com.vibematch.app.video.rtc.RtcRoomViewModel
import io.livekit.android.renderer.SurfaceViewRenderer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class RtcRoomGatewayTest {
    private val dispatcher = UnconfinedTestDispatcher()
    private lateinit var gateway: FakeRtcRoomGateway

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        gateway = FakeRtcRoomGateway()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `connect cannot happen before a fresh JIT token handoff`() = runTest {
        val viewModel = RtcRoomViewModel(gateway)

        assertFalse(viewModel.connectWithPendingJitToken("wss://livekit.example"))
        assertEquals(0, gateway.connectCalls)

        viewModel.setPendingJitToken("short-lived-token")
        assertTrue(viewModel.state.value.jitTokenReady)
        assertFalse(viewModel.state.value.toString().contains("short-lived-token"))
        assertTrue(viewModel.connectWithPendingJitToken("wss://livekit.example"))
        assertEquals(1, gateway.connectCalls)
        assertEquals("wss://livekit.example", gateway.lastServerUrl)
        assertEquals("short-lived-token", gateway.lastToken)

        assertFalse(viewModel.connectWithPendingJitToken("wss://livekit.example"))
        assertEquals(1, gateway.connectCalls)
    }

    @Test
    fun `media controls do nothing before authorized connection`() = runTest {
        val viewModel = RtcRoomViewModel(gateway)

        viewModel.setCameraEnabled(true)
        viewModel.setMicrophoneEnabled(true)
        assertEquals(0, gateway.cameraCalls)
        assertEquals(0, gateway.microphoneCalls)

        viewModel.setPendingJitToken("short-lived-token")
        assertTrue(viewModel.connectWithPendingJitToken("wss://livekit.example"))
        viewModel.setCameraEnabled(true)
        viewModel.setMicrophoneEnabled(true)

        assertEquals(1, gateway.cameraCalls)
        assertEquals(1, gateway.microphoneCalls)
    }

    @Test
    fun `blank public LiveKit URL fails closed without connecting`() = runTest {
        val viewModel = RtcRoomViewModel(gateway)
        viewModel.setPendingJitToken("short-lived-token")

        assertFalse(viewModel.connectWithPendingJitToken(""))
        assertEquals(0, gateway.connectCalls)
        assertEquals(RtcRoomStatus.FAILED, viewModel.state.value.status)
    }

    @Test
    fun `connection failure requires a new JIT token`() = runTest {
        val viewModel = RtcRoomViewModel(gateway)
        viewModel.setPendingJitToken("first-token")

        assertTrue(viewModel.connectWithPendingJitToken("wss://livekit.example"))
        gateway.emitState(RtcRoomUiState(status = RtcRoomStatus.FAILED, errorMessage = "connection failed"))

        assertEquals(RtcRoomStatus.FAILED, viewModel.state.value.status)
        assertFalse(viewModel.state.value.jitTokenReady)
        assertFalse(viewModel.connectWithPendingJitToken("wss://livekit.example"))
        assertEquals(1, gateway.connectCalls)

        gateway.emitState(RtcRoomUiState(status = RtcRoomStatus.DISCONNECTED))
        viewModel.setPendingJitToken("second-token")
        assertTrue(viewModel.connectWithPendingJitToken("wss://livekit.example"))
        assertEquals(2, gateway.connectCalls)
    }

    @Test
    fun `permission denial never opens a room`() = runTest {
        val viewModel = RtcRoomViewModel(gateway)

        viewModel.markPermissionDenied()

        assertEquals(RtcRoomStatus.PERMISSION_DENIED, viewModel.state.value.status)
        assertEquals(0, gateway.connectCalls)
    }

    @Test
    fun `disconnect clears gateway and pending credential`() = runTest {
        val viewModel = RtcRoomViewModel(gateway)
        viewModel.setPendingJitToken("short-lived-token")

        viewModel.disconnect()

        assertEquals(1, gateway.disconnectCalls)
        assertFalse(viewModel.connectWithPendingJitToken("wss://livekit.example"))
    }

    private class FakeRtcRoomGateway : RtcRoomGateway {
        private val mutableState = MutableStateFlow(RtcRoomUiState())
        override val state = mutableState
        var connectCalls = 0
        var disconnectCalls = 0
        var cameraCalls = 0
        var microphoneCalls = 0
        var lastServerUrl: String? = null
        var lastToken: String? = null

        override suspend fun connect(serverUrl: String, token: String) {
            connectCalls += 1
            lastServerUrl = serverUrl
            lastToken = token
            mutableState.value = RtcRoomUiState(status = RtcRoomStatus.CONNECTED)
        }

        override suspend fun disconnect() {
            disconnectCalls += 1
            mutableState.value = RtcRoomUiState(status = RtcRoomStatus.DISCONNECTED)
        }

        override suspend fun setMicrophoneEnabled(enabled: Boolean) {
            microphoneCalls += 1
        }

        override suspend fun setCameraEnabled(enabled: Boolean) {
            cameraCalls += 1
        }

        fun emitState(value: RtcRoomUiState) {
            mutableState.value = value
        }

        override fun attachLocalRenderer(renderer: SurfaceViewRenderer) = Unit

        override fun detachLocalRenderer(renderer: SurfaceViewRenderer) = Unit

        override fun attachRemoteRenderer(renderer: SurfaceViewRenderer) = Unit

        override fun detachRemoteRenderer(renderer: SurfaceViewRenderer) = Unit

        override fun disconnectNow() {
            disconnectCalls += 1
            mutableState.value = RtcRoomUiState(status = RtcRoomStatus.DISCONNECTED)
        }
    }
}
