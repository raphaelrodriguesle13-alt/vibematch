package com.vibematch.app.auth

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

data class PhoneVerificationStart(
    val verificationId: String,
    val expiresAtMillis: Long,
)

interface PhoneVerificationGateway {
    suspend fun start(accessToken: String, phoneE164: String): PhoneVerificationStart
    suspend fun confirm(accessToken: String, verificationId: String, code: String): Boolean
}

class PhoneVerificationApiException(
    val statusCode: Int,
    val errorCode: String?,
    message: String,
) : IOException(message)

class PhoneVerificationApiClient(
    baseUrl: String,
    private val httpClient: OkHttpClient = defaultHttpClient(),
) : PhoneVerificationGateway {
    private val baseUrl = baseUrl.trimEnd('/')
    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun start(
        accessToken: String,
        phoneE164: String,
    ): PhoneVerificationStart {
        val requestBody = buildPhoneStartRequestBody(json, phoneE164)
            .toRequestBody("application/json; charset=utf-8".toMediaType())
        val response = execute(
            Request.Builder()
                .url("$baseUrl/auth/phone/start")
                .header("Authorization", "Bearer $accessToken")
                .header("Accept", "application/json")
                .post(requestBody)
                .build(),
        )
        response.use {
            val body = it.body?.string().orEmpty()
            ensureSuccess(it.code, it.isSuccessful, body)
            val payload = decode<PhoneStartBody>(body, it.code)
            val expiresAtMillis = parseExpiry(payload.expiresAt, it.code)
            if (payload.verificationId.isBlank()) {
                throw PhoneVerificationApiException(
                    it.code,
                    "INVALID_RESPONSE",
                    "A resposta de verificação telefônica era inválida.",
                )
            }
            return PhoneVerificationStart(payload.verificationId, expiresAtMillis)
        }
    }

    override suspend fun confirm(
        accessToken: String,
        verificationId: String,
        code: String,
    ): Boolean {
        val requestBody = buildPhoneConfirmRequestBody(json, verificationId, code)
            .toRequestBody("application/json; charset=utf-8".toMediaType())
        val response = execute(
            Request.Builder()
                .url("$baseUrl/auth/phone/confirm")
                .header("Authorization", "Bearer $accessToken")
                .header("Accept", "application/json")
                .post(requestBody)
                .build(),
        )
        response.use {
            val body = it.body?.string().orEmpty()
            ensureSuccess(it.code, it.isSuccessful, body)
            val payload = decode<PhoneConfirmBody>(body, it.code)
            if (!payload.ok || !payload.phoneVerified) {
                throw PhoneVerificationApiException(
                    it.code,
                    "INVALID_RESPONSE",
                    "A confirmação telefônica não foi concluída.",
                )
            }
            return true
        }
    }

    private suspend fun execute(request: Request) = withContext(Dispatchers.IO) {
        httpClient.newCall(request).execute()
    }

    private fun ensureSuccess(statusCode: Int, successful: Boolean, body: String) {
        if (successful) return
        val errorCode = runCatching {
            json.parseToJsonElement(body).jsonObject["error"]?.jsonPrimitive?.content
        }.getOrNull()
        throw PhoneVerificationApiException(statusCode, errorCode, publicError(statusCode, errorCode))
    }

    private inline fun <reified T> decode(body: String, statusCode: Int): T = try {
        if (body.isBlank()) throw IllegalArgumentException("empty body")
        json.decodeFromString<T>(body)
    } catch (_: Exception) {
        throw PhoneVerificationApiException(
            statusCode,
            "INVALID_RESPONSE",
            "A resposta de verificação telefônica era inválida.",
        )
    }

    private fun parseExpiry(value: String, statusCode: Int): Long = try {
        Instant.parse(value).toEpochMilli()
    } catch (_: Exception) {
        throw PhoneVerificationApiException(
            statusCode,
            "INVALID_RESPONSE",
            "A validade da verificação telefônica era inválida.",
        )
    }

    private fun publicError(statusCode: Int, errorCode: String?): String = when {
        statusCode == 401 -> "Sua sessão expirou. Entre novamente para continuar."
        errorCode == "INVALID_PHONE" -> "Informe um telefone no formato internacional, como +5511999999999."
        errorCode == "INVALID_CODE" -> "O código informado é inválido. Tente novamente."
        errorCode == "VERIFICATION_NOT_AVAILABLE" ->
            "Essa verificação expirou ou já foi utilizada. Solicite um novo código."
        errorCode == "TOO_MANY_ATTEMPTS" ->
            "As tentativas foram bloqueadas. Solicite uma nova verificação mais tarde."
        errorCode == "SMS_PROVIDER_UNAVAILABLE" || statusCode >= 500 ->
            "O envio de SMS está temporariamente indisponível."
        errorCode == "PHONE_VERIFICATION_NOT_CONFIGURED" ->
            "A verificação telefônica ainda não está disponível."
        else -> "Não foi possível verificar o telefone agora."
    }

    private companion object {
        fun defaultHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .build()
    }
}

@Serializable
private data class PhoneStartBody(
    @SerialName("verification_id") val verificationId: String,
    @SerialName("expires_at") val expiresAt: String,
)

@Serializable
private data class PhoneConfirmBody(
    val ok: Boolean,
    @SerialName("phone_verified") val phoneVerified: Boolean,
)

@Serializable
private data class PhoneStartRequest(
    @SerialName("phone_e164") val phoneE164: String,
)

@Serializable
private data class PhoneConfirmRequest(
    @SerialName("verification_id") val verificationId: String,
    val code: String,
)

internal fun buildPhoneStartRequestBody(json: Json, phoneE164: String): String =
    json.encodeToString(PhoneStartRequest(phoneE164))

internal fun buildPhoneConfirmRequestBody(
    json: Json,
    verificationId: String,
    code: String,
): String = json.encodeToString(PhoneConfirmRequest(verificationId, code))
