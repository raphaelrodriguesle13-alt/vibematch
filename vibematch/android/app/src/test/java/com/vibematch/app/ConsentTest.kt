package com.vibematch.app

import com.vibematch.app.consent.Consent
import com.vibematch.app.consent.ConsentApiException
import com.vibematch.app.consent.ConsentDecision
import com.vibematch.app.consent.ConsentGateway
import com.vibematch.app.consent.ConsentParticipantStatus
import com.vibematch.app.consent.ConsentStatus
import com.vibematch.app.consent.ConsentViewModel
import com.vibematch.app.consent.buildConsentCreateRequestBody
import com.vibematch.app.consent.buildConsentDecisionRequestBody
import com.vibematch.app.consent.parseConsentParticipantStatus
import com.vibematch.app.consent.parseConsentStatus
import java.time.Instant
import java.util.UUID
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
class ConsentTest {
    private val dispatcher = UnconfinedTestDispatcher()
    private val json = Json { ignoreUnknownKeys = true }
    private lateinit var gateway: FakeConsentGateway

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        gateway = FakeConsentGateway()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `serializes consent requests with backend field names`() {
        val create = json.parseToJsonElement(
            buildConsentCreateRequestBody(json, "intent-1"),
        ).jsonObject
        val requestId = "11111111-1111-4111-8111-111111111111"
        val decision = json.parseToJsonElement(
            buildConsentDecisionRequestBody(json, ConsentDecision.ACCEPTED, requestId),
        ).jsonObject

        assertEquals("intent-1", create.getValue("match_intent_id").jsonPrimitive.content)
        assertEquals("ACCEPTED", decision.getValue("decision").jsonPrimitive.content)
        assertEquals(requestId, decision.getValue("request_id").jsonPrimitive.content)
    }

    @Test
    fun `maps known and unknown consent statuses fail closed`() {
        assertEquals(ConsentParticipantStatus.PENDING, parseConsentParticipantStatus("PENDING"))
        assertEquals(ConsentParticipantStatus.ACCEPTED, parseConsentParticipantStatus("ACCEPTED"))
        assertEquals(ConsentParticipantStatus.DECLINED, parseConsentParticipantStatus("DECLINED"))
        assertEquals(ConsentParticipantStatus.UNKNOWN, parseConsentParticipantStatus("FUTURE"))
        assertEquals(ConsentStatus.PENDING, parseConsentStatus("PENDING"))
        assertEquals(ConsentStatus.ACCEPTED_BOTH, parseConsentStatus("ACCEPTED_BOTH"))
        assertEquals(ConsentStatus.DECLINED, parseConsentStatus("DECLINED"))
        assertEquals(ConsentStatus.EXPIRED, parseConsentStatus("EXPIRED"))
        assertEquals(ConsentStatus.CANCELLED, parseConsentStatus("CANCELLED"))
        assertEquals(ConsentStatus.UNKNOWN, parseConsentStatus("FUTURE"))
    }

    @Test
    fun `creates pending consent from accepted match intent`() = runTest {
        val viewModel = ConsentViewModel(gateway, { "session-jwt" }, { "user-a" })

        viewModel.create("intent-1")

        assertEquals("intent-1", gateway.lastCreatedMatchIntentId)
        assertEquals(ConsentStatus.PENDING, viewModel.state.value.consent?.status)
        assertFalse(viewModel.state.value.isLoading)
    }

    @Test
    fun `decides consent with generated request id and preserves server outcome`() = runTest {
        val viewModel = ConsentViewModel(gateway, { "session-jwt" }, { "user-a" })
        viewModel.create("intent-1")

        viewModel.decide(ConsentDecision.ACCEPTED)

        assertEquals("consent-1", gateway.lastConsentId)
        assertEquals(ConsentDecision.ACCEPTED, gateway.lastDecision)
        assertTrue(gateway.lastRequestId?.let { runCatching { UUID.fromString(it) }.isSuccess } == true)
        assertEquals(ConsentStatus.ACCEPTED_BOTH, viewModel.state.value.consent?.status)
        assertTrue(viewModel.state.value.infoMessage?.contains("sessão autorizada") == true)
    }

    @Test
    fun `returns to authentication when consent endpoint is unauthorized`() = runTest {
        var expired = false
        gateway.createError = ConsentApiException(401, "UNAUTHORIZED", "expired")
        val viewModel = ConsentViewModel(
            gateway = gateway,
            accessTokenProvider = { "session-jwt" },
            currentUserIdProvider = { "user-a" },
            onSessionExpired = { expired = true },
        )

        viewModel.create("intent-1")

        assertTrue(expired)
        assertTrue(viewModel.state.value.sessionExpired)
        assertFalse(viewModel.state.value.isLoading)
    }

    @Test
    fun `fails closed and notifies age gate callback`() = runTest {
        var ageRequired = false
        gateway.createError = ConsentApiException(403, "AGE_ASSURANCE_REQUIRED", "blocked")
        val viewModel = ConsentViewModel(
            gateway = gateway,
            accessTokenProvider = { "session-jwt" },
            currentUserIdProvider = { "user-a" },
            onAgeAssuranceRequired = { ageRequired = true },
        )

        viewModel.create("intent-1")

        assertTrue(ageRequired)
        assertTrue(viewModel.state.value.ageBlocked)
        assertEquals(
            "A verificação de idade ainda não permite usar consentimento.",
            viewModel.state.value.errorMessage,
        )
    }

    private class FakeConsentGateway : ConsentGateway {
        var lastCreatedMatchIntentId: String? = null
        var lastConsentId: String? = null
        var lastDecision: ConsentDecision? = null
        var lastRequestId: String? = null
        var createError: Exception? = null
        var decideError: Exception? = null

        private val pending = Consent(
            id = "consent-1",
            matchIntentId = "intent-1",
            userAId = "user-a",
            userBId = "user-b",
            userAStatus = ConsentParticipantStatus.PENDING,
            userBStatus = ConsentParticipantStatus.PENDING,
            status = ConsentStatus.PENDING,
            expiresAt = Instant.parse("2026-08-26T10:10:00Z"),
            videoDeadline = null,
            acceptedBothAt = null,
        )

        override suspend fun create(accessToken: String, matchIntentId: String): Consent {
            createError?.let { throw it }
            lastCreatedMatchIntentId = matchIntentId
            return pending
        }

        override suspend fun decide(
            accessToken: String,
            consentId: String,
            decision: ConsentDecision,
            requestId: String,
        ): Consent {
            decideError?.let { throw it }
            lastConsentId = consentId
            lastDecision = decision
            lastRequestId = requestId
            return pending.copy(
                userAStatus = ConsentParticipantStatus.ACCEPTED,
                userBStatus = ConsentParticipantStatus.ACCEPTED,
                status = ConsentStatus.ACCEPTED_BOTH,
                acceptedBothAt = Instant.parse("2026-08-26T10:01:00Z"),
                videoDeadline = Instant.parse("2026-08-26T10:06:00Z"),
            )
        }
    }
}
