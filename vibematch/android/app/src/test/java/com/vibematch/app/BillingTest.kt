package com.vibematch.app

import android.app.Activity
import java.io.IOException
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.Purchase
import com.vibematch.app.billing.BillingApiException
import com.vibematch.app.billing.BillingEntitlement
import com.vibematch.app.billing.BillingOffer
import com.vibematch.app.billing.BillingPurchase
import com.vibematch.app.billing.BillingPurchasesResult
import com.vibematch.app.billing.BillingUiStatus
import com.vibematch.app.billing.BillingUpdate
import com.vibematch.app.billing.BillingValidationGateway
import com.vibematch.app.billing.PlayBillingGateway
import com.vibematch.app.billing.BillingViewModel
import com.vibematch.app.billing.buildBillingValidationRequestBody
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
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
class BillingTest {
    private val dispatcher = UnconfinedTestDispatcher()
    private lateinit var playGateway: FakePlayBillingGateway
    private lateinit var validationGateway: FakeValidationGateway

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        playGateway = FakePlayBillingGateway()
        validationGateway = FakeValidationGateway()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `validation payload carries only purchase token`() {
        val body = Json.parseToJsonElement(
            buildBillingValidationRequestBody(Json, "server-only-token"),
        ).jsonObject

        assertEquals("server-only-token", body.getValue("purchase_token").jsonPrimitive.content)
        assertEquals(1, body.size)
    }

    @Test
    fun `purchase stays without entitlement until server validation`() = runTest {
        val viewModel = newViewModel()
        viewModel.start()
        viewModel.purchase(Activity())

        assertEquals(BillingUiStatus.WAITING_FOR_PURCHASE, viewModel.state.value.status)
        assertFalse(viewModel.state.value.entitlementActive)
        assertEquals(1, playGateway.launchCalls)

        playGateway.emitPurchase(purchase("play-token"))
        advanceUntilIdle()

        assertTrue(viewModel.state.value.entitlementActive)
        assertEquals(BillingUiStatus.SUCCESS, viewModel.state.value.status)
        assertEquals("play-token", validationGateway.lastPurchaseToken)
        assertFalse(viewModel.state.value.toString().contains("play-token"))
        assertEquals(listOf("play-token"), playGateway.acknowledgedTokens)
    }

    @Test
    fun `duplicate purchased callbacks validate and acknowledge only once`() = runTest {
        val viewModel = newViewModel()
        viewModel.start()

        playGateway.emitPurchase(purchase("duplicate-token"))
        playGateway.emitPurchase(purchase("duplicate-token"))
        advanceUntilIdle()

        assertEquals(1, validationGateway.validateCalls)
        assertEquals(listOf("duplicate-token"), playGateway.acknowledgedTokens)
        assertTrue(viewModel.state.value.entitlementActive)
    }

    @Test
    fun `stale callback after reset cannot grant entitlement`() = runTest {
        val viewModel = newViewModel()
        viewModel.start()
        viewModel.reset()

        playGateway.emitPurchase(purchase("stale-token"))
        advanceUntilIdle()

        assertEquals(BillingUiStatus.IDLE, viewModel.state.value.status)
        assertFalse(viewModel.state.value.entitlementActive)
        assertEquals(0, validationGateway.validateCalls)
        assertTrue(playGateway.acknowledgedTokens.isEmpty())
    }

    @Test
    fun `Google Play cancellation is visible and never validates`() = runTest {
        val viewModel = newViewModel()
        viewModel.start()

        playGateway.emitFailure(BillingClient.BillingResponseCode.USER_CANCELED)
        advanceUntilIdle()

        assertEquals(BillingUiStatus.ERROR, viewModel.state.value.status)
        assertFalse(viewModel.state.value.entitlementActive)
        assertEquals(0, validationGateway.validateCalls)
    }

    @Test
    fun `server rejection never grants local premium`() = runTest {
        validationGateway.entitlement = BillingEntitlement(
            active = false,
            plan = "premium",
            state = "REVOKED",
            expiresAt = null,
        )
        val viewModel = newViewModel()
        viewModel.start()
        playGateway.emitPurchase(purchase("rejected-token"))
        advanceUntilIdle()

        assertEquals(BillingUiStatus.ERROR, viewModel.state.value.status)
        assertFalse(viewModel.state.value.entitlementActive)
        assertTrue(playGateway.acknowledgedTokens.isEmpty())
    }

    @Test
    fun `restore validates active Play purchase with backend`() = runTest {
        playGateway.activePurchases = listOf(purchase("restore-token", acknowledged = true))
        val viewModel = newViewModel()
        viewModel.start()

        viewModel.restore()
        advanceUntilIdle()

        assertEquals(BillingUiStatus.SUCCESS, viewModel.state.value.status)
        assertTrue(viewModel.state.value.entitlementActive)
        assertEquals("restore-token", validationGateway.lastPurchaseToken)
        assertTrue(playGateway.acknowledgedTokens.isEmpty())
        assertEquals(0, validationGateway.getEntitlementCalls)
    }

    @Test
    fun `restore falls back to server entitlement when Play has no purchase`() = runTest {
        val viewModel = newViewModel()

        viewModel.start()
        viewModel.restore()
        advanceUntilIdle()

        assertEquals(BillingUiStatus.SUCCESS, viewModel.state.value.status)
        assertTrue(viewModel.state.value.entitlementActive)
        assertEquals(1, validationGateway.getEntitlementCalls)
    }

    @Test
    fun `pending Play purchase does not grant entitlement`() = runTest {
        val viewModel = newViewModel()
        viewModel.start()

        playGateway.emitPurchase(
            BillingPurchase(
                productId = PRODUCT_ID,
                purchaseToken = "pending-token",
                purchaseState = Purchase.PurchaseState.PENDING,
                acknowledged = false,
            ),
        )
        advanceUntilIdle()

        assertEquals(BillingUiStatus.READY, viewModel.state.value.status)
        assertFalse(viewModel.state.value.entitlementActive)
        assertNull(validationGateway.lastPurchaseToken)
    }

    @Test
    fun `validation 401 expires the authenticated session`() = runTest {
        var expired = false
        validationGateway.failure = BillingApiException(401, "UNAUTHORIZED", "expired")
        val viewModel = BillingViewModel(
            playGateway = playGateway,
            validationGateway = validationGateway,
            accessTokenProvider = { "session-jwt" },
            productId = PRODUCT_ID,
            onSessionExpired = { expired = true },
        )
        viewModel.start()
        playGateway.emitPurchase(purchase("expired-token"))
        advanceUntilIdle()

        assertTrue(expired)
        assertEquals(BillingUiStatus.ERROR, viewModel.state.value.status)
        assertFalse(viewModel.state.value.entitlementActive)
    }

    @Test
    fun `validation timeout fails closed without entitlement`() = runTest {
        validationGateway.failure = IOException("timeout")
        val viewModel = newViewModel()
        viewModel.start()
        playGateway.emitPurchase(purchase("timeout-token"))
        advanceUntilIdle()

        assertEquals(BillingUiStatus.ERROR, viewModel.state.value.status)
        assertFalse(viewModel.state.value.entitlementActive)
        assertTrue(playGateway.acknowledgedTokens.isEmpty())
    }

    @Test
    fun `restore with revoked server entitlement stays inactive`() = runTest {
        validationGateway.entitlement = BillingEntitlement(
            active = false,
            plan = "premium",
            state = "REVOKED",
            expiresAt = null,
        )
        val viewModel = newViewModel()
        viewModel.start()
        viewModel.restore()
        advanceUntilIdle()

        assertEquals(BillingUiStatus.READY, viewModel.state.value.status)
        assertFalse(viewModel.state.value.entitlementActive)
        assertEquals(1, validationGateway.getEntitlementCalls)
    }

    @Test
    fun `account change resets entitlement and validates with the new session`() = runTest {
        var accessToken: String? = "session-a"
        val viewModel = BillingViewModel(
            playGateway = playGateway,
            validationGateway = validationGateway,
            accessTokenProvider = { accessToken },
            productId = PRODUCT_ID,
        )
        viewModel.start()
        playGateway.emitPurchase(purchase("account-a-token"))
        advanceUntilIdle()
        assertTrue(viewModel.state.value.entitlementActive)

        viewModel.reset()
        accessToken = "session-b"
        viewModel.start()
        playGateway.emitPurchase(purchase("account-b-token"))
        advanceUntilIdle()

        assertTrue(viewModel.state.value.entitlementActive)
        assertEquals("session-b", validationGateway.lastAccessToken)
        assertEquals("account-b-token", validationGateway.lastPurchaseToken)
    }

    @Test
    fun `new ViewModel restores only server entitlement after app restart`() = runTest {
        val first = newViewModel()
        first.start()
        first.reset()

        val second = newViewModel()
        second.start()
        second.restore()
        advanceUntilIdle()

        assertEquals(BillingUiStatus.SUCCESS, second.state.value.status)
        assertTrue(second.state.value.entitlementActive)
        assertEquals(1, validationGateway.getEntitlementCalls)
    }

    @Test
    fun `insecure validation endpoint blocks Play purchase`() = runTest {
        validationGateway.canValidate = false
        val viewModel = newViewModel()

        viewModel.start()
        viewModel.purchase(Activity())
        advanceUntilIdle()

        assertEquals(BillingUiStatus.ERROR, viewModel.state.value.status)
        assertFalse(viewModel.state.value.entitlementActive)
        assertEquals(0, playGateway.launchCalls)
    }

    @Test
    fun `missing product configuration fails closed`() = runTest {
        val viewModel = BillingViewModel(
            playGateway = playGateway,
            validationGateway = validationGateway,
            accessTokenProvider = { "session-jwt" },
            productId = "",
        )

        viewModel.start()

        assertEquals(BillingUiStatus.NOT_CONFIGURED, viewModel.state.value.status)
        assertFalse(viewModel.state.value.entitlementActive)
        assertEquals(0, playGateway.connectCalls)
    }

    private fun newViewModel() = BillingViewModel(
        playGateway = playGateway,
        validationGateway = validationGateway,
        accessTokenProvider = { "session-jwt" },
        productId = PRODUCT_ID,
    )

    private fun purchase(token: String, acknowledged: Boolean = false) = BillingPurchase(
        productId = PRODUCT_ID,
        purchaseToken = token,
        purchaseState = Purchase.PurchaseState.PURCHASED,
        acknowledged = acknowledged,
    )

    private class FakePlayBillingGateway : PlayBillingGateway {
        private val updatesMutable = MutableSharedFlow<BillingUpdate>(extraBufferCapacity = 16)
        override val updates: SharedFlow<BillingUpdate> = updatesMutable
        var connectCalls = 0
        var launchCalls = 0
        var activePurchases: List<BillingPurchase> = emptyList()
        val acknowledgedTokens = mutableListOf<String>()

        override suspend fun connect(): BillingResult {
            connectCalls += 1
            return okResult()
        }

        override suspend fun queryOffer(productId: String): BillingOffer = BillingOffer(
            productId = productId,
            title = "VibeMatch Premium",
            description = "Recursos Premium",
            formattedPrice = "R$ 9,90",
        )

        override suspend fun launchPurchase(activity: Activity, productId: String): BillingResult {
            launchCalls += 1
            return okResult()
        }

        override suspend fun queryActivePurchases(): BillingPurchasesResult =
            BillingPurchasesResult(okResult(), activePurchases)

        override suspend fun acknowledge(purchaseToken: String): BillingResult {
            acknowledgedTokens += purchaseToken
            return okResult()
        }

        override fun close() = Unit

        fun emitPurchase(purchase: BillingPurchase) {
            updatesMutable.tryEmit(BillingUpdate.PurchaseReceived(purchase))
        }

        fun emitFailure(responseCode: Int) {
            updatesMutable.tryEmit(
                BillingUpdate.Failed(
                    BillingResult.newBuilder()
                        .setResponseCode(responseCode)
                        .build(),
                ),
            )
        }
    }

    private class FakeValidationGateway : BillingValidationGateway {
        override var canValidate: Boolean = true
        var entitlement = BillingEntitlement(
            active = true,
            plan = "premium",
            state = "ACTIVE",
            expiresAt = Instant.parse("2027-01-01T00:00:00Z"),
        )
        var failure: Throwable? = null
        var validateCalls = 0
        var lastAccessToken: String? = null
        var lastPurchaseToken: String? = null

        override suspend fun validate(
            accessToken: String,
            purchaseToken: String,
        ): BillingEntitlement {
            validateCalls += 1
            lastAccessToken = accessToken
            lastPurchaseToken = purchaseToken
            failure?.let { throw it }
            return entitlement
        }

        var getEntitlementCalls = 0

        override suspend fun getEntitlement(accessToken: String): BillingEntitlement {
            getEntitlementCalls += 1
            return entitlement
        }
    }

    private companion object {
        const val PRODUCT_ID = "premium_monthly"

        fun okResult() = BillingResult.newBuilder()
            .setResponseCode(BillingClient.BillingResponseCode.OK)
            .build()
    }
}
