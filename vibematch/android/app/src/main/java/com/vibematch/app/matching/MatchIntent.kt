package com.vibematch.app.matching

import java.io.IOException
import java.time.Instant
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

enum class MatchIntentStatus {
    SENT,
    ACCEPTED,
    DECLINED,
    EXPIRED,
    CANCELLED,
    UNKNOWN,
}

enum class MatchIntentDecision(val wireValue: String) {
    ACCEPTED("ACCEPTED"),
    DECLINED("DECLINED"),
}

data class MatchIntent(
    val id: String,
    val senderId: String,
    val receiverId: String,
    val status: MatchIntentStatus,
    val expiresAt: Instant,
    val respondedAt: Instant?,
    val closedAt: Instant?,
    val createdAt: Instant,
)

interface MatchIntentGateway {
    suspend fun create(accessToken: String, receiverId: String): MatchIntent
    suspend fun listIncoming(accessToken: String): List<MatchIntent>
    suspend fun respond(
        accessToken: String,
        intentId: String,
        decision: MatchIntentDecision,
    ): MatchIntent
}

class MatchIntentApiException(
    val statusCode: Int,
    val errorCode: String?,
    message: String,
) : IOException(message)

class MatchIntentApiClient(
    baseUrl: String,
    private val httpClient: OkHttpClient = defaultHttpClient(),
) : MatchIntentGateway {
    private val baseUrl = baseUrl.trimEnd('/')
    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun create(accessToken: String, receiverId: String): MatchIntent {
        val body = buildMatchIntentCreateRequestBody(json, receiverId)
            .toRequestBody("application/json; charset=utf-8".toMediaType())
        val response = execute(
            Request.Builder()
                .url("$baseUrl/api/match-intents")
                .header("Authorization", "Bearer $accessToken")
                .header("Accept", "application/json")
                .post(body)
                .build(),
        )
        return response.use { parseIntentResponse(it) }
    }

    override suspend fun listIncoming(accessToken: String): List<MatchIntent> {
        val response = execute(
            Request.Builder()
                .url("$baseUrl/api/match-intents/incoming")
                .header("Authorization", "Bearer $accessToken")
                .header("Accept", "application/json")
                .get()
                .build(),
        )
        response.use {
            val body = it.body?.string().orEmpty()
            ensureSuccess(it.code, it.isSuccessful, body)
            return try {
                json.decodeFromString<MatchIntentListResponse>(body).data.map(::toModel)
            } catch (_: Exception) {
                throw invalidResponse(it.code)
            }
        }
    }

    override suspend fun respond(
        accessToken: String,
        intentId: String,
        decision: MatchIntentDecision,
    ): MatchIntent {
        val body = buildMatchIntentRespondRequestBody(json, decision)
            .toRequestBody("application/json; charset=utf-8".toMediaType())
        val response = execute(
            Request.Builder()
                .url("$baseUrl/api/match-intents/${intentId.encodeForPath()}/respond")
                .header("Authorization", "Bearer $accessToken")
                .header("Accept", "application/json")
                .post(body)
                .build(),
        )
        return response.use { parseIntentResponse(it) }
    }

    private suspend fun execute(request: Request) = withContext(Dispatchers.IO) {
        httpClient.newCall(request).execute()
    }

    private fun parseIntentResponse(response: okhttp3.Response): MatchIntent {
        val body = response.body?.string().orEmpty()
        ensureSuccess(response.code, response.isSuccessful, body)
        return try {
            toModel(json.decodeFromString<MatchIntentResponse>(body).data)
        } catch (_: Exception) {
            throw invalidResponse(response.code)
        }
    }

    private fun ensureSuccess(statusCode: Int, successful: Boolean, body: String) {
        if (successful) return
        val errorCode = runCatching {
            json.parseToJsonElement(body).jsonObject["error"]?.jsonPrimitive?.content
        }.getOrNull()
        throw MatchIntentApiException(statusCode, errorCode, publicError(statusCode, errorCode))
    }

    private fun toModel(body: MatchIntentBody): MatchIntent = try {
        MatchIntent(
            id = body.id,
            senderId = body.senderId,
            receiverId = body.receiverId,
            status = parseMatchIntentStatus(body.status),
            expiresAt = Instant.parse(body.expiresAt),
            respondedAt = body.respondedAt?.let(Instant::parse),
            closedAt = body.closedAt?.let(Instant::parse),
            createdAt = Instant.parse(body.createdAt),
        )
    } catch (_: Exception) {
        throw invalidResponse(200)
    }

    private fun invalidResponse(statusCode: Int) = MatchIntentApiException(
        statusCode,
        "INVALID_RESPONSE",
        "A resposta de matchmaking era inválida.",
    )

    private fun publicError(statusCode: Int, errorCode: String?): String = when {
        statusCode == 401 -> "Sua sessão expirou. Entre novamente para continuar."
        statusCode == 403 || errorCode == "AGE_ASSURANCE_REQUIRED" ->
            "A verificação de idade ainda não permite usar matchmaking."
        errorCode == "INVALID_TARGET" -> "Esse perfil não está disponível para uma conexão."
        errorCode == "NOT_ELIGIBLE" -> "Essa conexão não está disponível no momento."
        errorCode == "INTENT_NOT_AVAILABLE" -> "Essa solicitação expirou ou não está mais disponível."
        errorCode == "MATCHMAKING_NOT_CONFIGURED" || statusCode >= 500 ->
            "As solicitações estão temporariamente indisponíveis."
        else -> "Não foi possível carregar as solicitações agora."
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
private data class MatchIntentListResponse(
    val data: List<MatchIntentBody>,
)

@Serializable
private data class MatchIntentResponse(
    val data: MatchIntentBody,
)

@Serializable
private data class MatchIntentBody(
    val id: String,
    @SerialName("sender_id") val senderId: String,
    @SerialName("receiver_id") val receiverId: String,
    val status: String,
    @SerialName("expires_at") val expiresAt: String,
    @SerialName("responded_at") val respondedAt: String? = null,
    @SerialName("closed_at") val closedAt: String? = null,
    @SerialName("created_at") val createdAt: String,
)

@Serializable
private data class MatchIntentCreateRequest(
    @SerialName("receiver_id") val receiverId: String,
)

@Serializable
private data class MatchIntentRespondRequest(
    val decision: String,
)

internal fun parseMatchIntentStatus(value: String): MatchIntentStatus = when (value) {
    "SENT" -> MatchIntentStatus.SENT
    "ACCEPTED" -> MatchIntentStatus.ACCEPTED
    "DECLINED" -> MatchIntentStatus.DECLINED
    "EXPIRED" -> MatchIntentStatus.EXPIRED
    "CANCELLED" -> MatchIntentStatus.CANCELLED
    else -> MatchIntentStatus.UNKNOWN
}

internal fun buildMatchIntentCreateRequestBody(json: Json, receiverId: String): String =
    json.encodeToString(MatchIntentCreateRequest(receiverId))

internal fun buildMatchIntentRespondRequestBody(
    json: Json,
    decision: MatchIntentDecision,
): String = json.encodeToString(MatchIntentRespondRequest(decision.wireValue))
