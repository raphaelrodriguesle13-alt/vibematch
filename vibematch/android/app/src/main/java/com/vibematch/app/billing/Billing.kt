package com.vibematch.app.billing

import android.app.Activity
import android.content.Context
import androidx.lifecycle.viewModelScope
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import java.io.IOException
import java.time.Instant
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody


enum class BillingUiStatus {
    IDLE,
    CONNECTING,
    READY,
    PURCHASING,
    WAITING_FOR_PURCHASE,
    RESTORING,
    VALIDATING,
    SUCCESS,
    ERROR,
    SIGNED_OUT,
    NOT_CONFIGURED,
}

data class BillingUiState(
    val status: BillingUiStatus = BillingUiStatus.IDLE,
    val productTitle: String? = null,
    val productDescription: String? = null,
    val formattedPrice: String? = null,
    val entitlementActive: Boolean = false,
    val entitlementPlan: String? = null,
    val entitlementState: String? = null,
    val entitlementExpiresAt: String? = null,
    val errorMessage: String? = null,
    val infoMessage: String? = null,
)

data class BillingOffer(
    val productId: String,
    val title: String,
    val description: String,
    val formattedPrice: String,
)

data class BillingPurchase(
    val productId: String,
    val purchaseToken: String,
    val purchaseState: Int,
    val acknowledged: Boolean,
)

data class BillingPurchasesResult(
    val billingResult: BillingResult,
    val purchases: List<BillingPurchase>,
)

sealed interface BillingUpdate {
    data class PurchaseReceived(val purchase: BillingPurchase) : BillingUpdate
    data class Failed(val billingResult: BillingResult) : BillingUpdate
}

data class BillingEntitlement(
    val active: Boolean,
    val plan: String?,
    val state: String,
    val expiresAt: Instant?,
)

interface PlayBillingGateway {
    val updates: SharedFlow<BillingUpdate>

    suspend fun connect(): BillingResult
    suspend fun queryOffer(productId: String): BillingOffer?
    suspend fun launchPurchase(activity: Activity, productId: String): BillingResult
    suspend fun queryActivePurchases(): BillingPurchasesResult
    suspend fun acknowledge(purchaseToken: String): BillingResult
    fun close()
}

class PlayBillingClientGateway(context: Context) : PlayBillingGateway {
    private val applicationContext = context.applicationContext
    private val updatesMutable = MutableSharedFlow<BillingUpdate>(extraBufferCapacity = 16)
    private val billingClient: BillingClient
    private var closed = false

    init {
        val purchasesUpdatedListener = PurchasesUpdatedListener { billingResult, purchases ->
            if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                val received = purchases.orEmpty()
                if (received.isEmpty()) {
                    updatesMutable.tryEmit(BillingUpdate.Failed(billingResult))
                } else {
                    received.forEach { purchase ->
                        publishPurchase(purchase)
                    }
                }
            } else {
                updatesMutable.tryEmit(BillingUpdate.Failed(billingResult))
            }
        }
        billingClient = BillingClient.newBuilder(applicationContext)
            .setListener(purchasesUpdatedListener)
            .enablePendingPurchases(
                PendingPurchasesParams.newBuilder()
                    .enableOneTimeProducts()
                    .build(),
            )
            .enableAutoServiceReconnection()
            .build()
    }

    override val updates: SharedFlow<BillingUpdate> = updatesMutable.asSharedFlow()

    override suspend fun connect(): BillingResult {
        if (closed) return errorResult("O serviço de pagamentos foi encerrado.")
        if (billingClient.isReady) return okResult()
        return suspendCancellableCoroutine { continuation ->
            billingClient.startConnection(object : BillingClientStateListener {
                override fun onBillingSetupFinished(billingResult: BillingResult) {
                    if (continuation.isActive) continuation.resume(billingResult)
                }

                override fun onBillingServiceDisconnected() {
                    if (continuation.isActive) {
                        continuation.resume(
                            errorResult(
                                "O Google Play não está disponível neste momento.",
                                BillingClient.BillingResponseCode.SERVICE_DISCONNECTED,
                            ),
                        )
                    }
                }
            })
            continuation.invokeOnCancellation { }
        }
    }

    override suspend fun queryOffer(productId: String): BillingOffer? {
        if (connect().responseCode != BillingClient.BillingResponseCode.OK) return null
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(
                listOf(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(productId)
                        .setProductType(BillingClient.ProductType.SUBS)
                        .build(),
                ),
            )
            .build()
        return suspendCancellableCoroutine { continuation ->
            billingClient.queryProductDetailsAsync(params) { result, queryResult ->
                if (!continuation.isActive) return@queryProductDetailsAsync
                val details = queryResult.productDetailsList.firstOrNull()
                if (result.responseCode != BillingClient.BillingResponseCode.OK || details == null) {
                    continuation.resume(null)
                } else {
                    continuation.resume(details.toOffer())
                }
            }
        }
    }

    override suspend fun launchPurchase(activity: Activity, productId: String): BillingResult {
        val details = queryProductDetails(productId)
            ?: return errorResult(
                "Este produto não está disponível para compra.",
                BillingClient.BillingResponseCode.ITEM_UNAVAILABLE,
            )
        val offerToken = details.subscriptionOfferDetails
            ?.firstOrNull()
            ?.offerToken
            .orEmpty()
        if (offerToken.isBlank()) {
            return errorResult(
                "A oferta de assinatura não está disponível.",
                BillingClient.BillingResponseCode.ITEM_UNAVAILABLE,
            )
        }
        val productParams = BillingFlowParams.ProductDetailsParams.newBuilder()
            .setProductDetails(details)
            .setOfferToken(offerToken)
            .build()
        return billingClient.launchBillingFlow(
            activity,
            BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(listOf(productParams))
                .build(),
        )
    }

    override suspend fun queryActivePurchases(): BillingPurchasesResult {
        val connection = connect()
        if (connection.responseCode != BillingClient.BillingResponseCode.OK) {
            return BillingPurchasesResult(connection, emptyList())
        }
        val params = QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.SUBS)
            .build()
        return suspendCancellableCoroutine { continuation ->
            billingClient.queryPurchasesAsync(params) { result, purchases ->
                if (!continuation.isActive) return@queryPurchasesAsync
                val mapped = if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    purchases.map(::toBillingPurchase)
                } else {
                    emptyList()
                }
                continuation.resume(BillingPurchasesResult(result, mapped))
            }
        }
    }

    override suspend fun acknowledge(purchaseToken: String): BillingResult =
        suspendCancellableCoroutine { continuation ->
            billingClient.acknowledgePurchase(
                AcknowledgePurchaseParams.newBuilder()
                    .setPurchaseToken(purchaseToken)
                    .build(),
            ) { result ->
                if (continuation.isActive) continuation.resume(result)
            }
        }

    override fun close() {
        if (closed) return
        closed = true
        billingClient.endConnection()
    }

    private suspend fun queryProductDetails(productId: String): ProductDetails? {
        if (connect().responseCode != BillingClient.BillingResponseCode.OK) return null
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(
                listOf(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(productId)
                        .setProductType(BillingClient.ProductType.SUBS)
                        .build(),
                ),
            )
            .build()
        return suspendCancellableCoroutine { continuation ->
            billingClient.queryProductDetailsAsync(params) { result, queryResult ->
                if (!continuation.isActive) return@queryProductDetailsAsync
                continuation.resume(
                    queryResult.productDetailsList.firstOrNull()
                        ?.takeIf { result.responseCode == BillingClient.BillingResponseCode.OK },
                )
            }
        }
    }

    private fun publishPurchase(purchase: Purchase) {
        val productId = purchase.products.firstOrNull() ?: return
        updatesMutable.tryEmit(
            BillingUpdate.PurchaseReceived(
                BillingPurchase(
                    productId = productId,
                    purchaseToken = purchase.purchaseToken,
                    purchaseState = purchase.purchaseState,
                    acknowledged = purchase.isAcknowledged,
                ),
            ),
        )
    }

    private fun toBillingPurchase(purchase: Purchase): BillingPurchase = BillingPurchase(
        productId = purchase.products.firstOrNull().orEmpty(),
        purchaseToken = purchase.purchaseToken,
        purchaseState = purchase.purchaseState,
        acknowledged = purchase.isAcknowledged,
    )

    private fun ProductDetails.toOffer(): BillingOffer {
        val price = subscriptionOfferDetails
            ?.firstOrNull()
            ?.pricingPhases
            ?.pricingPhaseList
            ?.lastOrNull()
            ?.formattedPrice
            .orEmpty()
        return BillingOffer(
            productId = productId,
            title = title,
            description = description,
            formattedPrice = price,
        )
    }

    private companion object {
        fun okResult() = BillingResult.newBuilder()
            .setResponseCode(BillingClient.BillingResponseCode.OK)
            .build()

        fun errorResult(
            message: String,
            code: Int = BillingClient.BillingResponseCode.ERROR,
        ) = BillingResult.newBuilder()
            .setResponseCode(code)
            .setDebugMessage(message)
            .build()
    }
}

interface BillingValidationGateway {
    val canValidate: Boolean
        get() = true

    suspend fun validate(accessToken: String, purchaseToken: String): BillingEntitlement
    suspend fun getEntitlement(accessToken: String): BillingEntitlement
}

class BillingApiException(
    val statusCode: Int,
    val errorCode: String?,
    message: String,
) : IOException(message)

class BillingApiClient(
    baseUrl: String,
    validationPath: String,
    private val httpClient: OkHttpClient = defaultHttpClient(),
) : BillingValidationGateway {
    private val baseUrl = baseUrl.trimEnd('/')
    private val validationPath = validationPath.trim().let {
        if (it.startsWith('/')) it else "/$it"
    }
    private val json = Json { ignoreUnknownKeys = true }

    override val canValidate: Boolean = baseUrl.trimEnd('/').startsWith("https://")

    override suspend fun validate(
        accessToken: String,
        purchaseToken: String,
    ): BillingEntitlement {
        if (!canValidate) {
            throw BillingApiException(
                0,
                "INSECURE_ENDPOINT",
                "A validação de pagamentos exige uma API HTTPS.",
            )
        }
        val requestBody = buildBillingValidationRequestBody(json, purchaseToken)
            .toRequestBody("application/json; charset=utf-8".toMediaType())
        val response = withContext(kotlinx.coroutines.Dispatchers.IO) {
            httpClient.newCall(
                Request.Builder()
                    .url("$baseUrl$validationPath")
                    .header("Authorization", "Bearer $accessToken")
                    .header("Accept", "application/json")
                    .post(requestBody)
                    .build(),
            ).execute()
        }
        response.use {
            val body = it.body?.string().orEmpty()
            ensureSuccess(it.code, it.isSuccessful, body)
            return parseEntitlement(it.code, body)
        }
    }

    override suspend fun getEntitlement(accessToken: String): BillingEntitlement {
        val response = withContext(kotlinx.coroutines.Dispatchers.IO) {
            httpClient.newCall(
                Request.Builder()
                    .url("$baseUrl/api/billing/entitlement")
                    .header("Authorization", "Bearer $accessToken")
                    .header("Accept", "application/json")
                    .get()
                    .build(),
            ).execute()
        }
        response.use {
            val body = it.body?.string().orEmpty()
            ensureSuccess(it.code, it.isSuccessful, body)
            return parseEntitlement(it.code, body)
        }
    }

    private fun parseEntitlement(statusCode: Int, body: String): BillingEntitlement = try {
        val data = json.decodeFromString<BillingValidationResponse>(body).data
        BillingEntitlement(
            active = data.entitled ?: data.active ?: data.valid ?: false,
            plan = data.plan,
            state = data.status ?: data.state ?: "UNKNOWN",
            expiresAt = (data.currentPeriodEnd ?: data.expiryAt ?: data.expiryTime)
                ?.let(Instant::parse),
        )
    } catch (error: BillingApiException) {
        throw error
    } catch (_: Exception) {
        throw BillingApiException(statusCode, "INVALID_RESPONSE", "A resposta de assinatura era inválida.")
    }

    private fun ensureSuccess(statusCode: Int, successful: Boolean, body: String) {
        if (successful) return
        val errorCode = runCatching {
            json.parseToJsonElement(body).jsonObject["error"]?.jsonPrimitive?.contentOrNull
        }.getOrNull()
        throw BillingApiException(statusCode, errorCode, publicError(statusCode, errorCode))
    }

    private fun publicError(statusCode: Int, errorCode: String?): String = when {
        statusCode == 401 -> "Sua sessão expirou. Entre novamente para continuar."
        statusCode == 403 || errorCode == "BILLING_NOT_AUTHORIZED" ->
            "Esta conta não está autorizada a concluir a assinatura."
        statusCode == 409 || errorCode == "PURCHASE_NOT_CONFIRMED" ->
            "A compra ainda não foi confirmada pelo servidor. Tente restaurar depois."
        statusCode == 429 -> "Muitas tentativas de compra. Aguarde antes de tentar novamente."
        statusCode >= 500 || errorCode == "BILLING_PROVIDER_UNAVAILABLE" ->
            "O serviço de pagamentos está temporariamente indisponível."
        else -> "Não foi possível validar a compra com segurança."
    }

    private companion object {
        fun defaultHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .build()
    }
}

class BillingViewModel(
    private val playGateway: PlayBillingGateway,
    private val validationGateway: BillingValidationGateway,
    private val accessTokenProvider: () -> String?,
    private val productId: String,
    private val onSessionExpired: () -> Unit = {},
) : androidx.lifecycle.ViewModel() {
    private val mutableState = androidx.compose.runtime.mutableStateOf(BillingUiState())
    val state: androidx.compose.runtime.State<BillingUiState> = mutableState
    private var operationJob: Job? = null
    private var flowActive = false

    init {
        viewModelScope.launch {
            playGateway.updates.collect { update ->
                when (update) {
                    is BillingUpdate.PurchaseReceived -> handlePurchase(update.purchase)
                    is BillingUpdate.Failed -> showBillingError(update.billingResult)
                }
            }
        }
    }

    fun start() {
        if (mutableState.value.status == BillingUiStatus.CONNECTING ||
            mutableState.value.status == BillingUiStatus.VALIDATING ||
            mutableState.value.status == BillingUiStatus.PURCHASING
        ) return
        if (productId.isBlank()) {
            flowActive = false
            mutableState.value = BillingUiState(
                status = BillingUiStatus.NOT_CONFIGURED,
                errorMessage = "O produto Premium ainda não foi configurado para este ambiente.",
            )
            return
        }
        flowActive = true
        runOperation {
            mutableState.value = mutableState.value.copy(
                status = BillingUiStatus.CONNECTING,
                errorMessage = null,
                infoMessage = null,
            )
            val result = playGateway.connect()
            if (!isOk(result)) {
                showBillingError(result)
                return@runOperation
            }
            if (!validationGateway.canValidate) {
                mutableState.value = mutableState.value.copy(
                    status = BillingUiStatus.ERROR,
                    errorMessage = "Compras Premium exigem um endpoint de validação HTTPS.",
                    infoMessage = null,
                )
                return@runOperation
            }
            val offer = playGateway.queryOffer(productId)
            if (offer == null) {
                mutableState.value = mutableState.value.copy(
                    status = BillingUiStatus.ERROR,
                    errorMessage = "O produto Premium não está disponível no Google Play.",
                )
            } else {
                mutableState.value = mutableState.value.copy(
                    status = BillingUiStatus.READY,
                    productTitle = offer.title,
                    productDescription = offer.description,
                    formattedPrice = offer.formattedPrice,
                    errorMessage = null,
                    infoMessage = "A confirmação da compra será feita pelo servidor.",
                )
            }
        }
    }

    fun purchase(activity: Activity) {
        if (operationJob?.isActive == true || productId.isBlank()) return
        if (!validationGateway.canValidate) {
            mutableState.value = mutableState.value.copy(
                status = BillingUiStatus.ERROR,
                entitlementActive = false,
                errorMessage = "Compras Premium exigem um endpoint de validação HTTPS.",
                infoMessage = null,
            )
            return
        }
        val accessToken = accessTokenProvider()?.trim()
        if (accessToken.isNullOrEmpty()) {
            mutableState.value = BillingUiState(
                status = BillingUiStatus.SIGNED_OUT,
                errorMessage = "Entre novamente para iniciar uma compra.",
            )
            onSessionExpired()
            return
        }
        operationJob = viewModelScope.launch {
            mutableState.value = mutableState.value.copy(
                status = BillingUiStatus.PURCHASING,
                errorMessage = null,
                infoMessage = "Abrindo o Google Play para concluir a compra...",
            )
            val result = playGateway.launchPurchase(activity, productId)
            if (isOk(result)) {
                mutableState.value = mutableState.value.copy(
                    status = BillingUiStatus.WAITING_FOR_PURCHASE,
                    infoMessage = "Conclua a compra no Google Play. O acesso só será liberado após validação server-side.",
                )
            } else {
                showBillingError(result)
            }
        }
    }

    fun restore() {
        if (operationJob?.isActive == true || productId.isBlank()) return
        if (!validationGateway.canValidate) {
            mutableState.value = mutableState.value.copy(
                status = BillingUiStatus.ERROR,
                entitlementActive = false,
                errorMessage = "Compras Premium exigem um endpoint de validação HTTPS.",
                infoMessage = null,
            )
            return
        }
        val accessToken = accessTokenProvider()?.trim()
        if (accessToken.isNullOrEmpty()) {
            mutableState.value = BillingUiState(
                status = BillingUiStatus.SIGNED_OUT,
                errorMessage = "Entre novamente para restaurar compras.",
            )
            onSessionExpired()
            return
        }
        operationJob = viewModelScope.launch {
            mutableState.value = mutableState.value.copy(
                status = BillingUiStatus.RESTORING,
                errorMessage = null,
                infoMessage = "Consultando compras do Google Play...",
            )
            val result = playGateway.queryActivePurchases()
            if (!isOk(result.billingResult)) {
                showBillingError(result.billingResult)
                return@launch
            }
            val matchingPurchases = result.purchases.filter { it.productId == productId }
            if (matchingPurchases.isEmpty()) {
                try {
                    applyServerEntitlement(validationGateway.getEntitlement(accessToken))
                } catch (error: BillingApiException) {
                    if (error.statusCode == 401) onSessionExpired()
                    mutableState.value = mutableState.value.copy(
                        status = BillingUiStatus.ERROR,
                        entitlementActive = false,
                        errorMessage = error.message ?: "Não foi possível restaurar a assinatura com segurança.",
                        infoMessage = null,
                    )
                } catch (_: Exception) {
                    mutableState.value = mutableState.value.copy(
                        status = BillingUiStatus.ERROR,
                        entitlementActive = false,
                        errorMessage = "Não foi possível restaurar a assinatura com segurança.",
                        infoMessage = null,
                    )
                }
                return@launch
            }
            matchingPurchases.forEach { handlePurchase(it) }
        }
    }

    fun clearMessages() {
        mutableState.value = mutableState.value.copy(errorMessage = null, infoMessage = null)
    }

    fun reset() {
        flowActive = false
        operationJob?.cancel()
        operationJob = null
        mutableState.value = BillingUiState()
    }

    private suspend fun handlePurchase(purchase: BillingPurchase) {
        if (!flowActive || purchase.productId != productId) return
        if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED) {
            mutableState.value = mutableState.value.copy(
                status = BillingUiStatus.READY,
                entitlementActive = false,
                infoMessage = "A compra está pendente no Google Play e ainda não libera Premium.",
            )
            return
        }
        val accessToken = accessTokenProvider()?.trim()
        if (accessToken.isNullOrEmpty()) {
            mutableState.value = BillingUiState(
                status = BillingUiStatus.SIGNED_OUT,
                errorMessage = "Entre novamente para validar a compra.",
            )
            onSessionExpired()
            return
        }
        mutableState.value = mutableState.value.copy(
            status = BillingUiStatus.VALIDATING,
            entitlementActive = false,
            errorMessage = null,
            infoMessage = "Validando a compra com o servidor...",
        )
        try {
            val entitlement = validationGateway.validate(
                accessToken = accessToken,
                purchaseToken = purchase.purchaseToken,
            )
            if (!entitlement.active) {
                mutableState.value = mutableState.value.copy(
                    status = BillingUiStatus.ERROR,
                    entitlementActive = false,
                    errorMessage = "O servidor não confirmou um entitlement Premium ativo.",
                    infoMessage = null,
                )
                return
            }
            if (!purchase.acknowledged) {
                val acknowledgement = playGateway.acknowledge(purchase.purchaseToken)
                if (!isOk(acknowledgement)) {
                    mutableState.value = mutableState.value.copy(
                        status = BillingUiStatus.ERROR,
                        entitlementActive = false,
                        errorMessage = "A compra foi validada, mas não pôde ser confirmada no Google Play.",
                        infoMessage = null,
                    )
                    return
                }
            }
            applyServerEntitlement(entitlement)
        } catch (error: BillingApiException) {
            if (error.statusCode == 401) onSessionExpired()
            mutableState.value = mutableState.value.copy(
                status = BillingUiStatus.ERROR,
                entitlementActive = false,
                errorMessage = error.message ?: "Não foi possível validar a compra com segurança.",
                infoMessage = null,
            )
        } catch (_: CancellationException) {
            throw CancellationException()
        } catch (_: Exception) {
            mutableState.value = mutableState.value.copy(
                status = BillingUiStatus.ERROR,
                entitlementActive = false,
                errorMessage = "Não foi possível validar a compra com segurança.",
                infoMessage = null,
            )
        }
    }

    private fun applyServerEntitlement(entitlement: BillingEntitlement) {
        if (!entitlement.active) {
            mutableState.value = mutableState.value.copy(
                status = BillingUiStatus.READY,
                entitlementActive = false,
                entitlementPlan = entitlement.plan,
                entitlementState = entitlement.state,
                entitlementExpiresAt = entitlement.expiresAt?.toString(),
                errorMessage = null,
                infoMessage = "O servidor não confirmou um entitlement Premium ativo.",
            )
            return
        }
        mutableState.value = mutableState.value.copy(
            status = BillingUiStatus.SUCCESS,
            entitlementActive = true,
            entitlementPlan = entitlement.plan,
            entitlementState = entitlement.state,
            entitlementExpiresAt = entitlement.expiresAt?.toString(),
            errorMessage = null,
            infoMessage = "Premium confirmado pelo servidor.",
        )
    }

    private fun runOperation(block: suspend () -> Unit) {
        operationJob?.cancel()
        operationJob = viewModelScope.launch { block() }
    }

    private fun showBillingError(result: BillingResult) {
        val message = when (result.responseCode) {
            BillingClient.BillingResponseCode.USER_CANCELED -> "Compra cancelada. Nenhum Premium foi concedido."
            BillingClient.BillingResponseCode.ITEM_UNAVAILABLE -> "O produto Premium não está disponível nesta conta ou região."
            BillingClient.BillingResponseCode.SERVICE_DISCONNECTED,
            BillingClient.BillingResponseCode.BILLING_UNAVAILABLE,
            -> "O Google Play não está disponível neste momento. Tente novamente."
            else -> "Não foi possível iniciar o Google Play Billing com segurança."
        }
        mutableState.value = mutableState.value.copy(
            status = BillingUiStatus.ERROR,
            entitlementActive = false,
            errorMessage = message,
            infoMessage = null,
        )
    }

    private fun isOk(result: BillingResult): Boolean =
        result.responseCode == BillingClient.BillingResponseCode.OK

    override fun onCleared() {
        flowActive = false
        operationJob?.cancel()
        playGateway.close()
        super.onCleared()
    }
}

class BillingViewModelFactory(
    private val playGateway: PlayBillingGateway,
    private val validationGateway: BillingValidationGateway,
    private val accessTokenProvider: () -> String?,
    private val productId: String,
    private val onSessionExpired: () -> Unit = {},
) : androidx.lifecycle.ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : androidx.lifecycle.ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(BillingViewModel::class.java)) {
            return BillingViewModel(
                playGateway = playGateway,
                validationGateway = validationGateway,
                accessTokenProvider = accessTokenProvider,
                productId = productId,
                onSessionExpired = onSessionExpired,
            ) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}

@Serializable
private data class BillingValidationRequest(
    @SerialName("purchase_token") val purchaseToken: String,
)

@Serializable
private data class BillingValidationResponse(
    val data: BillingEntitlementBody,
)

@Serializable
private data class BillingEntitlementBody(
    val entitled: Boolean? = null,
    val active: Boolean? = null,
    val valid: Boolean? = null,
    val plan: String? = null,
    val status: String? = null,
    val state: String? = null,
    @SerialName("current_period_end") val currentPeriodEnd: String? = null,
    @SerialName("expiry_at") val expiryAt: String? = null,
    @SerialName("expiry_time") val expiryTime: String? = null,
)

internal fun buildBillingValidationRequestBody(json: Json, purchaseToken: String): String =
    json.encodeToString(BillingValidationRequest(purchaseToken = purchaseToken))
