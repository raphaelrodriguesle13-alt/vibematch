package com.vibematch.app.video

import java.io.IOException
import java.time.Instant
import java.util.concurrent.TimeUnit
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody


enum class VideoSessionStatus {
    CREATED,
    ACTIVE,
    ENDED,
    UNKNOWN,
}

data class VideoSession(
    val id: String,
    val consentId: String,
    val status: VideoSessionStatus,
    val revocationPending: Boolean,
    val revokedAt: Instant?,
)

interface VideoSessionGateway {
    suspend fun create(accessToken: String, consentId: String): VideoSession
    suspend fun issueToken(accessToken: String, sessionId: String): String
}

class VideoApiException(
    val statusCode: Int,
    val errorCode: String?,
    message: String,
) : IOException(message)

class VideoSessionApiClient(
    baseUrl: String,
    private val httpClient: OkHttpClient = defaultHttpClient(),
) : VideoSessionGateway {
    private val baseUrl = baseUrl.trimEnd('/')
    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun create(accessToken: String, consentId: String): VideoSession {
        val body = buildVideoSessionCreateRequestBody(json, consentId)
            .toRequestBody("application/json; charset=utf-8".toMediaType())
        val response = execute(
            Request.Builder()
                .url("$baseUrl/api/video/sessions")
                .header("Authorization", "Bearer $accessToken")
                .header("Accept", "application/json")
                .post(body)
                .build(),
        )
        return response.use { parseSessionResponse(it) }
    }

    override suspend fun issueToken(accessToken: String, sessionId: String): String {
        val response = execute(
            Request.Builder()
                .url("$baseUrl/api/video/sessions/${sessionId.encodeForPath()}/token")
                .header("Authorization", "Bearer $accessToken")
                .header("Accept", "application/json")
                .post("".toRequestBody(null))
                .build(),
        )
        val body = response.body?.string().orEmpty()
        ensureSuccess(response.code, response.isSuccessful, body)
        return try {
            json.decodeFromString<VideoTokenResponse>(body).data.token
                .takeIf { it.isNotBlank() }
                ?: throw invalidResponse(response.code)
        } catch (error: VideoApiException) {
            throw error
        } catch (_: Exception) {
            throw invalidResponse(response.code)
        }
    }

    private suspend fun execute(request: Request) = withContext(Dispatchers.IO) {
        httpClient.newCall(request).execute()
    }

    private fun parseSessionResponse(response: okhttp3.Response): VideoSession {
        val body = response.body?.string().orEmpty()
        ensureSuccess(response.code, response.isSuccessful, body)
        return try {
            toModel(json.decodeFromString<VideoSessionResponse>(body).data)
        } catch (error: VideoApiException) {
            throw error
        } catch (_: Exception) {
            throw invalidResponse(response.code)
        }
    }

    private fun ensureSuccess(statusCode: Int, successful: Boolean, body: String) {
        if (successful) return
        val errorCode = runCatching {
            json.parseToJsonElement(body).jsonObject["error"]?.jsonPrimitive?.contentOrNull
        }.getOrNull()
        throw VideoApiException(statusCode, errorCode, publicError(statusCode, errorCode))
    }

    private fun toModel(body: VideoSessionBody): VideoSession = VideoSession(
        id = body.id,
        consentId = body.consentId,
        status = parseVideoSessionStatus(body.status),
        revocationPending = body.revocationPending,
        revokedAt = body.revokedAt?.let(Instant::parse),
    )

    private fun invalidResponse(statusCode: Int) = VideoApiException(
        statusCode,
        "INVALID_RESPONSE",
        "A resposta de vídeo era inválida.",
    )

    private fun publicError(statusCode: Int, errorCode: String?): String = when {
        statusCode == 401 -> "Sua sessão expirou. Entre novamente para continuar."
        errorCode == "AGE_ASSURANCE_REQUIRED" ->
            "A verificação de idade não autoriza esta sessão de vídeo."
        errorCode == "PHONE_VERIFICATION_REQUIRED" ->
            "Confirme seu telefone novamente para usar vídeo."
        errorCode == "VIDEO_NOT_AUTHORIZED" ->
            "O backend não autorizou esta sessão de vídeo."
        errorCode == "RATE_LIMITED" || statusCode == 429 ->
            "Muitas solicitações de vídeo. Aguarde antes de tentar novamente."
        errorCode == "VIDEO_NOT_CONFIGURED" || errorCode == "VIDEO_PROVIDER_UNAVAILABLE" ||
            statusCode >= 500 -> "O vídeo está temporariamente indisponível."
        errorCode == "INVALID_VIDEO_REQUEST" -> "Os dados da sessão de vídeo são inválidos."
        else -> "Não foi possível autorizar o vídeo agora."
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
private data class VideoSessionResponse(
    val data: VideoSessionBody,
)

@Serializable
private data class VideoSessionBody(
    val id: String,
    @SerialName("consent_id") val consentId: String,
    val status: String,
    @SerialName("revocation_pending") val revocationPending: Boolean,
    @SerialName("revoked_at") val revokedAt: String? = null,
)

@Serializable
private data class VideoTokenResponse(
    val data: VideoTokenBody,
)

@Serializable
private data class VideoTokenBody(
    @SerialName("session_id") val sessionId: String,
    val token: String,
)

@Serializable
private data class VideoSessionCreateRequest(
    @SerialName("consent_id") val consentId: String,
)

internal fun parseVideoSessionStatus(value: String): VideoSessionStatus = when (value) {
    "CREATED" -> VideoSessionStatus.CREATED
    "ACTIVE" -> VideoSessionStatus.ACTIVE
    "ENDED" -> VideoSessionStatus.ENDED
    else -> VideoSessionStatus.UNKNOWN
}

internal fun buildVideoSessionCreateRequestBody(json: Json, consentId: String): String =
    json.encodeToString(VideoSessionCreateRequest(consentId))
