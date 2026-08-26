package com.vibematch.app

import com.vibematch.app.auth.PhoneVerificationApiException
import com.vibematch.app.auth.PhoneVerificationGateway
import com.vibematch.app.auth.PhoneVerificationStart
import com.vibematch.app.auth.PhoneVerificationStep
import com.vibematch.app.auth.PhoneVerificationViewModel
import com.vibematch.app.auth.buildPhoneConfirmRequestBody
import com.vibematch.app.auth.buildPhoneStartRequestBody
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
class PhoneVerificationTest {
    private val dispatcher = UnconfinedTestDispatcher()
    private lateinit var gateway: FakePhoneVerificationGateway
    private val json = Json { ignoreUnknownKeys = true }

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        gateway = FakePhoneVerificationGateway()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `serializes phone requests with backend field names`() {
        val start = json.parseToJsonElement(
            buildPhoneStartRequestBody(json, "+5511999999999"),
        ).jsonObject
        val confirm = json.parseToJsonElement(
            buildPhoneConfirmRequestBody(json, "verification-1", "123456"),
        ).jsonObject

        assertEquals("+5511999999999", start.getValue("phone_e164").jsonPrimitive.content)
        assertEquals("verification-1", confirm.getValue("verification_id").jsonPrimitive.content)
        assertEquals("123456", confirm.getValue("code").jsonPrimitive.content)
    }

    @Test
    fun `starts verification and moves to code step`() = runTest {
        val viewModel = PhoneVerificationViewModel(gateway, { "session-jwt" })

        viewModel.updatePhone(" +5511999999999 ")
        viewModel.start()

        assertEquals("+5511999999999", gateway.lastPhone)
        assertEquals(PhoneVerificationStep.CODE_INPUT, viewModel.state.value.step)
        assertEquals("verification-1", viewModel.state.value.verificationId)
        assertFalse(viewModel.state.value.isLoading)
    }

    @Test
    fun `confirms code and notifies authenticated flow`() = runTest {
        var verified = false
        val viewModel = PhoneVerificationViewModel(
            gateway = gateway,
            accessTokenProvider = { "session-jwt" },
            onPhoneVerified = { verified = true },
        )
        viewModel.updatePhone("+5511999999999")
        viewModel.start()
        viewModel.updateCode("123456")

        viewModel.confirm()

        assertEquals("verification-1", gateway.lastVerificationId)
        assertEquals("123456", gateway.lastCode)
        assertTrue(viewModel.state.value.completed)
        assertTrue(verified)
    }

    @Test
    fun `keeps code step and presents backend invalid code`() = runTest {
        gateway.confirmError = PhoneVerificationApiException(400, "INVALID_CODE", "invalid")
        val viewModel = PhoneVerificationViewModel(gateway, { "session-jwt" })
        viewModel.updatePhone("+5511999999999")
        viewModel.start()
        viewModel.updateCode("000000")

        viewModel.confirm()

        assertEquals(PhoneVerificationStep.CODE_INPUT, viewModel.state.value.step)
        assertEquals("O código informado é inválido. Tente novamente.", viewModel.state.value.errorMessage)
        assertFalse(viewModel.state.value.completed)
    }

    @Test
    fun `returns to authentication when session is missing`() = runTest {
        var expired = false
        val viewModel = PhoneVerificationViewModel(
            gateway = gateway,
            accessTokenProvider = { null },
            onSessionExpired = { expired = true },
        )

        viewModel.updatePhone("+5511999999999")
        viewModel.start()

        assertTrue(expired)
        assertTrue(viewModel.state.value.sessionExpired)
        assertFalse(viewModel.state.value.isLoading)
    }

    private class FakePhoneVerificationGateway : PhoneVerificationGateway {
        var lastPhone: String? = null
        var lastVerificationId: String? = null
        var lastCode: String? = null
        var startError: Exception? = null
        var confirmError: Exception? = null

        override suspend fun start(
            accessToken: String,
            phoneE164: String,
        ): PhoneVerificationStart {
            startError?.let { throw it }
            lastPhone = phoneE164
            return PhoneVerificationStart("verification-1", 1_800_000_000_000L)
        }

        override suspend fun confirm(
            accessToken: String,
            verificationId: String,
            code: String,
        ): Boolean {
            confirmError?.let { throw it }
            lastVerificationId = verificationId
            lastCode = code
            return true
        }
    }
}
