package com.vibematch.app

import com.vibematch.app.video.VideoApiException
import com.vibematch.app.video.VideoSession
import com.vibematch.app.video.VideoSessionGateway
import com.vibematch.app.video.VideoSessionStatus
import com.vibematch.app.video.VideoSessionViewModel
import com.vibematch.app.video.buildVideoSessionCreateRequestBody
import com.vibematch.app.video.parseVideoSessionStatus
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class VideoSessionTest {
    private val dispatcher = UnconfinedTestDispatcher()
    private val json = Json { ignoreUnknownKeys = true }
    private lateinit var gateway: FakeVideoGateway

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        gateway = FakeVideoGateway()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `serializes video session request with consent id`() {
        val body = json.parseToJsonElement(
            buildVideoSessionCreateRequestBody(json, "consent-1"),
        ).jsonObject

        assertEquals("consent-1", body.getValue("consent_id").jsonPrimitive.content)
    }

    @Test
    fun `maps unknown server status fail closed`() {
        assertEquals(VideoSessionStatus.CREATED, parseVideoSessionStatus("CREATED"))
        assertEquals(VideoSessionStatus.ACTIVE, parseVideoSessionStatus("ACTIVE"))
        assertEquals(VideoSessionStatus.ENDED, parseVideoSessionStatus("ENDED"))
        assertEquals(VideoSessionStatus.UNKNOWN, parseVideoSessionStatus("FUTURE"))
    }

    @Test
    fun `creates session and emits token only through transient callback`() = runTest {
        var emittedToken: String? = null
        var emittedSession: VideoSession? = null
        val viewModel = VideoSessionViewModel(
            gateway = gateway,
            accessTokenProvider = { "session-jwt" },
            onTokenIssued = { token, session ->
                emittedToken = token
                emittedSession = session
            },
        )

        viewModel.create("consent-1")
        viewModel.issueToken()

        assertEquals("session-1", viewModel.state.value.session?.id)
        assertEquals("server-token", emittedToken)
        assertEquals("session-1", emittedSession?.id)
        assertTrue(viewModel.state.value.tokenIssued)
        assertFalse(viewModel.state.value.isIssuingToken)
        assertFalse(viewModel.state.value.toString().contains("server-token"))
    }

    @Test
    fun `does not create or issue when session is absent`() = runTest {
        val viewModel = VideoSessionViewModel(gateway, { "session-jwt" })

        viewModel.issueToken()

        assertNull(gateway.lastCreatedConsentId)
        assertNull(gateway.lastIssuedSessionId)
        assertEquals(
            "Crie uma sessão autorizada antes de solicitar o token.",
            viewModel.state.value.errorMessage,
        )
    }

    @Test
    fun `returns to authentication on unauthorized video request`() = runTest {
        var expired = false
        gateway.createError = VideoApiException(401, "UNAUTHORIZED", "expired")
        val viewModel = VideoSessionViewModel(
            gateway = gateway,
            accessTokenProvider = { "session-jwt" },
            onSessionExpired = { expired = true },
        )

        viewModel.create("consent-1")

        assertTrue(expired)
        assertTrue(viewModel.state.value.sessionExpired)
        assertFalse(viewModel.state.value.isCreating)
    }

    @Test
    fun `fails closed on video authorization denial`() = runTest {
        gateway.createError = VideoApiException(403, "VIDEO_NOT_AUTHORIZED", "denied")
        val viewModel = VideoSessionViewModel(gateway, { "session-jwt" })

        viewModel.create("consent-1")

        assertEquals("O backend não autorizou esta sessão de vídeo.", viewModel.state.value.errorMessage)
        assertFalse(viewModel.state.value.tokenIssued)
    }

    private class FakeVideoGateway : VideoSessionGateway {
        var lastCreatedConsentId: String? = null
        var lastIssuedSessionId: String? = null
        var createError: Exception? = null
        var tokenError: Exception? = null

        private val session = VideoSession(
            id = "session-1",
            consentId = "consent-1",
            status = VideoSessionStatus.CREATED,
            revocationPending = false,
            revokedAt = null,
        )

        override suspend fun create(accessToken: String, consentId: String): VideoSession {
            createError?.let { throw it }
            lastCreatedConsentId = consentId
            return session
        }

        override suspend fun issueToken(accessToken: String, sessionId: String): String {
            tokenError?.let { throw it }
            lastIssuedSessionId = sessionId
            return "server-token"
        }
    }
}
