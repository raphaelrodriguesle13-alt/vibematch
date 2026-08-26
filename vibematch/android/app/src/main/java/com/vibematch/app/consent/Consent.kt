package com.vibematch.app.consent

import java.io.IOException
import java.time.Instant
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

enum class ConsentDecision(val wireValue: String) {
    ACCEPTED("ACCEPTED"),
    DECLINED("DECLINED"),
}

enum class ConsentParticipantStatus {
    PENDING,
    ACCEPTED,
    DECLINED,
    UNKNOWN,
}

enum class ConsentStatus {
    PENDING,
    ACCEPTED_BOTH,
    DECLINED,
    EXPIRED,
    CANCELLED,
    UNKNOWN,
}

data class Consent(
    val id: String,
    val matchIntentId: String,
    val userAId: String,
    val userBId: String,
    val userAStatus: ConsentParticipantStatus,
    val userBStatus: ConsentParticipantStatus,
    val status: ConsentStatus,
    val expiresAt: Instant,
    val videoDeadline: Instant?,
    val acceptedBothAt: Instant?,
)

interface ConsentGateway {
    suspend fun create(accessToken: String, matchIntentId: String): Consent
    suspend fun decide(
        accessToken: String,
        consentId: String,
        decision: ConsentDecision,
        requestId: String,
    ): Consent
}

class ConsentApiException(
    val statusCode: Int,
    val errorCode: String?,
    message: String,
) : IOException(message)

class ConsentApiClient(
    baseUrl: String,
    private val httpClient: OkHttpClient = defaultHttpClient(),
) : ConsentGateway {
    private val baseUrl = baseUrl.trimEnd('/')
    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun create(accessToken: String, matchIntentId: String): Consent {
        val body = buildConsentCreateRequestBody(json, matchIntentId)
            .toRequestBody("application/json; charset=utf-8".toMediaType())
        val response = execute(
            Request.Builder()
                .url("$baseUrl/api/consents")
                .header("Authorization", "Bearer $accessToken")
                .header("Accept", "application/json")
                .post(body)
                .build(),
        )
        return response.use { parseConsentResponse(it) }
    }

    override suspend fun decide(
        accessToken: String,
        consentId: String,
        decision: ConsentDecision,
        requestId: String,
    ): Consent {
        val body = buildConsentDecisionRequestBody(json, decision, requestId)
            .toRequestBody("application/json; charset=utf-8".toMediaType())
        val response = execute(
            Request.Builder()
                .url("$baseUrl/api/consents/${consentId.encodeForPath()}/decision")
                .header("Authorization", "Bearer $accessToken")
                .header("Accept", "application/json")
                .post(body)
                .build(),
        )
        return response.use { parseConsentResponse(it) }
    }

    private suspend fun execute(request: Request) = withContext(Dispatchers.IO) {
        httpClient.newCall(request).execute()
    }

    private fun parseConsentResponse(response: okhttp3.Response): Consent {
        val body = response.body?.string().orEmpty()
        ensureSuccess(response.code, response.isSuccessful, body)
        return try {
            toModel(json.decodeFromString<ConsentResponse>(body).data)
        } catch (_: Exception) {
            throw invalidResponse(response.code)
        }
    }

    private fun ensureSuccess(statusCode: Int, successful: Boolean, body: String) {
        if (successful) return
        val errorCode = runCatching {
            json.parseToJsonElement(body).jsonObject["error"]?.jsonPrimitive?.content
        }.getOrNull()
        throw ConsentApiException(statusCode, errorCode, publicError(statusCode, errorCode))
    }

    private fun toModel(body: ConsentBody): Consent = try {
        Consent(
            id = body.id,
            matchIntentId = body.matchIntentId,
            userAId = body.userAId,
            userBId = body.userBId,
            userAStatus = parseConsentParticipantStatus(body.userAStatus),
            userBStatus = parseConsentParticipantStatus(body.userBStatus),
            status = parseConsentStatus(body.status),
            expiresAt = Instant.parse(body.expiresAt),
            videoDeadline = body.videoDeadline?.let(Instant::parse),
            acceptedBothAt = body.acceptedBothAt?.let(Instant::parse),
        )
    } catch (_: Exception) {
        throw invalidResponse(200)
    }

    private fun invalidResponse(statusCode: Int) = ConsentApiException(
        statusCode,
        "INVALID_RESPONSE",
        "A resposta de consentimento era inválida.",
    )

    private fun publicError(statusCode: Int, errorCode: String?): String = when {
        statusCode == 401 -> "Sua sessão expirou. Entre novamente para continuar."
        errorCode == "AGE_ASSURANCE_REQUIRED" ->
            "A verificação de idade ainda não permite usar consentimento."
        errorCode == "PHONE_VERIFICATION_REQUIRED" ->
            "Confirme seu telefone novamente para usar consentimento."
        errorCode == "INVALID_CONSENT" -> "Os dados de consentimento são inválidos."
        errorCode == "CONSENT_NOT_ELIGIBLE" ->
            "Este consentimento não está disponível para criação."
        errorCode == "CONSENT_NOT_AVAILABLE" ->
            "Este consentimento expirou ou não está mais disponível."
        errorCode == "CONSENT_NOT_CONFIGURED" || statusCode >= 500 ->
            "O consentimento está temporariamente indisponível."
        else -> "Não foi possível atualizar o consentimento agora."
    }

    private companion object {
        fun defaultHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .build()

        fun String.encodeForPath(): String = java.net.URLEncoder.encode(this, Charsets.UTF_8.name())
    }
}

@Serializable
private data class ConsentResponse(
    val data: ConsentBody,
)

@Serializable
private data class ConsentBody(
    val id: String,
    @SerialName("match_intent_id") val matchIntentId: String,
    @SerialName("user_a_id") val userAId: String,
    @SerialName("user_b_id") val userBId: String,
    @SerialName("user_a_status") val userAStatus: String,
    @SerialName("user_b_status") val userBStatus: String,
    val status: String,
    @SerialName("expires_at") val expiresAt: String,
    @SerialName("video_deadline") val videoDeadline: String? = null,
    @SerialName("accepted_both_at") val acceptedBothAt: String? = null,
)

@Serializable
private data class ConsentCreateRequest(
    @SerialName("match_intent_id") val matchIntentId: String,
)

@Serializable
private data class ConsentDecisionRequest(
    val decision: String,
    @SerialName("request_id") val requestId: String,
)

internal fun parseConsentParticipantStatus(value: String): ConsentParticipantStatus = when (value) {
    "PENDING" -> ConsentParticipantStatus.PENDING
    "ACCEPTED" -> ConsentParticipantStatus.ACCEPTED
    "DECLINED" -> ConsentParticipantStatus.DECLINED
    else -> ConsentParticipantStatus.UNKNOWN
}

internal fun parseConsentStatus(value: String): ConsentStatus = when (value) {
    "PENDING" -> ConsentStatus.PENDING
    "ACCEPTED_BOTH" -> ConsentStatus.ACCEPTED_BOTH
    "DECLINED" -> ConsentStatus.DECLINED
    "EXPIRED" -> ConsentStatus.EXPIRED
    "CANCELLED" -> ConsentStatus.CANCELLED
    else -> ConsentStatus.UNKNOWN
}

internal fun buildConsentCreateRequestBody(json: Json, matchIntentId: String): String =
    json.encodeToString(ConsentCreateRequest(matchIntentId))

internal fun buildConsentDecisionRequestBody(
    json: Json,
    decision: ConsentDecision,
    requestId: String = UUID.randomUUID().toString(),
): String = json.encodeToString(ConsentDecisionRequest(decision.wireValue, requestId))
