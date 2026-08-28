package com.vibematch.app

import com.vibematch.app.video.VideoSession
import com.vibematch.app.video.VideoSessionGateway
import com.vibematch.app.video.VideoSessionStatus
import com.vibematch.app.video.VideoSessionViewModel
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class VideoSessionRevocationRaceTest {
    private val dispatcher = UnconfinedTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `reset prevents late JIT token callback from restoring realtime authority`() = runTest {
        val releaseToken = CompletableDeferred<String>()
        val gateway = DeferredVideoGateway(releaseToken)
        var emittedToken: String? = null
        val viewModel = VideoSessionViewModel(
            gateway = gateway,
            accessTokenProvider = { "session-jwt" },
            onTokenIssued = { token, _ -> emittedToken = token },
        )

        viewModel.create("consent-1")
        viewModel.issueToken()
        viewModel.reset()
        releaseToken.complete("stale-jit-token")
        advanceUntilIdle()

        assertNull(emittedToken)
        assertNull(viewModel.state.value.session)
        assertFalse(viewModel.state.value.tokenIssued)
        assertFalse(viewModel.state.value.isIssuingToken)
    }

    private class DeferredVideoGateway(
        private val releaseToken: CompletableDeferred<String>,
    ) : VideoSessionGateway {
        override suspend fun create(accessToken: String, consentId: String): VideoSession =
            VideoSession(
                id = "session-1",
                consentId = consentId,
                status = VideoSessionStatus.CREATED,
                revocationPending = false,
                revokedAt = null,
            )

        override suspend fun issueToken(accessToken: String, sessionId: String): String =
            releaseToken.await()
    }
}
