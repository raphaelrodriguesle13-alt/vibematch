package com.vibematch.app

import com.vibematch.app.matching.MatchIntent
import com.vibematch.app.matching.MatchIntentApiException
import com.vibematch.app.matching.MatchIntentDecision
import com.vibematch.app.matching.MatchIntentGateway
import com.vibematch.app.matching.MatchIntentStatus
import com.vibematch.app.matching.MatchIntentViewModel
import com.vibematch.app.matching.buildMatchIntentCreateRequestBody
import com.vibematch.app.matching.buildMatchIntentRespondRequestBody
import com.vibematch.app.matching.parseMatchIntentStatus
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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class MatchIntentTest {
    private val dispatcher = UnconfinedTestDispatcher()
    private val json = Json { ignoreUnknownKeys = true }
    private lateinit var gateway: FakeMatchIntentGateway

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        gateway = FakeMatchIntentGateway()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `serializes match intent requests with backend field names`() {
        val create = json.parseToJsonElement(
            buildMatchIntentCreateRequestBody(json, "receiver-1"),
        ).jsonObject
        val respond = json.parseToJsonElement(
            buildMatchIntentRespondRequestBody(json, MatchIntentDecision.ACCEPTED),
        ).jsonObject

        assertEquals("receiver-1", create.getValue("receiver_id").jsonPrimitive.content)
        assertEquals("ACCEPTED", respond.getValue("decision").jsonPrimitive.content)
    }

    @Test
    fun `maps known and unknown backend statuses fail closed`() {
        assertEquals(MatchIntentStatus.SENT, parseMatchIntentStatus("SENT"))
        assertEquals(MatchIntentStatus.ACCEPTED, parseMatchIntentStatus("ACCEPTED"))
        assertEquals(MatchIntentStatus.DECLINED, parseMatchIntentStatus("DECLINED"))
        assertEquals(MatchIntentStatus.EXPIRED, parseMatchIntentStatus("EXPIRED"))
        assertEquals(MatchIntentStatus.CANCELLED, parseMatchIntentStatus("CANCELLED"))
        assertEquals(MatchIntentStatus.UNKNOWN, parseMatchIntentStatus("FUTURE_STATUS"))
    }

    @Test
    fun `loads incoming sent intents`() = runTest {
        val viewModel = MatchIntentViewModel(gateway, { "session-jwt" })

        viewModel.load()

        assertEquals(1, viewModel.state.value.incoming.size)
        assertEquals(MatchIntentStatus.SENT, viewModel.state.value.incoming.single().status)
        assertTrue(viewModel.state.value.hasLoaded)
        assertFalse(viewModel.state.value.isLoading)
    }

    @Test
    fun `accepts incoming intent without creating local video authorization`() = runTest {
        val viewModel = MatchIntentViewModel(gateway, { "session-jwt" })
        viewModel.load()

        viewModel.respond("intent-1", MatchIntentDecision.ACCEPTED)

        assertEquals("intent-1", gateway.lastRespondedIntentId)
        assertEquals(MatchIntentDecision.ACCEPTED, gateway.lastDecision)
        assertEquals(MatchIntentStatus.ACCEPTED, viewModel.state.value.incoming.single().status)
        assertTrue(viewModel.state.value.infoMessage?.contains("consentimento mútuo") == true)
    }

    @Test
    fun `fails closed when backend requires age assurance`() = runTest {
        gateway.listError = MatchIntentApiException(403, "AGE_ASSURANCE_REQUIRED", "blocked")
        val viewModel = MatchIntentViewModel(gateway, { "session-jwt" })

        viewModel.load()

        assertTrue(viewModel.state.value.ageBlocked)
        assertEquals(
            "A verificação de idade ainda não permite usar matchmaking.",
            viewModel.state.value.errorMessage,
        )
        assertTrue(viewModel.state.value.incoming.isEmpty())
    }

    @Test
    fun `returns to authentication on unauthorized response`() = runTest {
        var expired = false
        gateway.listError = MatchIntentApiException(401, "UNAUTHORIZED", "expired")
        val viewModel = MatchIntentViewModel(
            gateway = gateway,
            accessTokenProvider = { "session-jwt" },
            onSessionExpired = { expired = true },
        )

        viewModel.load()

        assertTrue(expired)
        assertTrue(viewModel.state.value.sessionExpired)
        assertFalse(viewModel.state.value.isLoading)
    }

    private class FakeMatchIntentGateway : MatchIntentGateway {
        var lastRespondedIntentId: String? = null
        var lastDecision: MatchIntentDecision? = null
        var listError: Exception? = null
        var respondError: Exception? = null

        private val sentIntent = MatchIntent(
            id = "intent-1",
            senderId = "sender-1",
            receiverId = "receiver-1",
            status = MatchIntentStatus.SENT,
            expiresAt = Instant.parse("2026-08-26T10:10:00Z"),
            respondedAt = null,
            closedAt = null,
            createdAt = Instant.parse("2026-08-26T10:00:00Z"),
        )

        override suspend fun create(accessToken: String, receiverId: String): MatchIntent = sentIntent

        override suspend fun listIncoming(accessToken: String): List<MatchIntent> {
            listError?.let { throw it }
            return listOf(sentIntent)
        }

        override suspend fun respond(
            accessToken: String,
            intentId: String,
            decision: MatchIntentDecision,
        ): MatchIntent {
            respondError?.let { throw it }
            lastRespondedIntentId = intentId
            lastDecision = decision
            return sentIntent.copy(
                status = if (decision == MatchIntentDecision.ACCEPTED) {
                    MatchIntentStatus.ACCEPTED
                } else {
                    MatchIntentStatus.DECLINED
                },
                respondedAt = Instant.parse("2026-08-26T10:01:00Z"),
            )
        }
    }
}
