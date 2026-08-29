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
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

class ProviderLoginApiClient(
    baseUrl: String,
    private val httpClient: OkHttpClient = defaultHttpClient(),
) {
    private val baseUrl = baseUrl.trimEnd('/')
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun loginWithFacebook(accessToken: String): AuthSessionBundle {
        val body = json.encodeToString(FacebookLoginRequest(accessToken))
            .toRequestBody(JSON_MEDIA_TYPE)
        val request = Request.Builder()
            .url("$baseUrl/auth/facebook")
            .header("Accept", "application/json")
            .post(body)
            .build()
        return executeSessionRequest(request, "Não foi possível entrar com Facebook agora.")
    }

    suspend fun startPhoneLogin(phoneE164: String): PhoneLoginChallenge {
        val body = json.encodeToString(PhoneLoginStartRequest(phoneE164))
            .toRequestBody(JSON_MEDIA_TYPE)
        val request = Request.Builder()
            .url("$baseUrl/auth/phone-login/start")
            .header("Accept", "application/json")
            .post(body)
            .build()

        val response = withContext(Dispatchers.IO) { httpClient.newCall(request).execute() }
        response.use {
            val responseBody = it.body?.string().orEmpty()
            if (!it.isSuccessful) {
                throw ProviderLoginException(it.code, publicPhoneStartError(it.code))
            }
            val payload = try {
                json.decodeFromString<PhoneLoginStartResponse>(responseBody)
            } catch (_: Exception) {
                throw ProviderLoginException(it.code, "A resposta do login por celular foi inválida.")
            }
            val expiresAtMillis = try {
                Instant.parse(payload.expiresAt).toEpochMilli()
            } catch (_: Exception) {
                throw ProviderLoginException(it.code, "A confirmação por celular expirou de forma inválida.")
            }
            if (payload.verificationId.isBlank() || expiresAtMillis <= System.currentTimeMillis()) {
                throw ProviderLoginException(it.code, "Não foi possível iniciar a confirmação por celular.")
            }
            return PhoneLoginChallenge(payload.verificationId, expiresAtMillis)
        }
    }

    suspend fun confirmPhoneLogin(verificationId: String, code: String): AuthSessionBundle {
        val body = json.encodeToString(PhoneLoginConfirmRequest(verificationId, code))
            .toRequestBody(JSON_MEDIA_TYPE)
        val request = Request.Builder()
            .url("$baseUrl/auth/phone-login/confirm")
            .header("Accept", "application/json")
            .post(body)
            .build()
        return executeSessionRequest(request, "Não foi possível confirmar o código agora.")
    }

    private suspend fun executeSessionRequest(request: Request, fallbackMessage: String): AuthSessionBundle {
        val response = withContext(Dispatchers.IO) { httpClient.newCall(request).execute() }
        response.use {
            val responseBody = it.body?.string().orEmpty()
            if (!it.isSuccessful) {
                throw ProviderLoginException(it.code, publicSessionError(it.code, fallbackMessage))
            }
            return parseSessionBundle(it.code, responseBody)
        }
    }

    private fun parseSessionBundle(statusCode: Int, responseBody: String): AuthSessionBundle {
        val payload = try {
            json.decodeFromString<ProviderAuthSessionResponse>(responseBody)
        } catch (_: Exception) {
            throw ProviderLoginException(statusCode, "A resposta de autenticação foi inválida.")
        }
        val expiresAtMillis = parseExpiry(statusCode, payload.expiresAt)
        val refreshExpiresAtMillis = parseExpiry(statusCode, payload.refreshExpiresAt)
        if (
            payload.sessionJwt.isBlank() ||
            payload.refreshToken.isBlank() ||
            payload.userId.isBlank() ||
            refreshExpiresAtMillis <= expiresAtMillis ||
            refreshExpiresAtMillis <= System.currentTimeMillis()
        ) {
            throw ProviderLoginException(statusCode, "A resposta de autenticação ficou incompleta.")
        }
        return AuthSessionBundle(
            session = AuthSession(
                sessionJwt = payload.sessionJwt,
                userId = payload.userId,
                isNewUser = payload.isNewUser,
                phoneVerified = payload.phoneVerified,
                expiresAtMillis = expiresAtMillis,
            ),
            refreshCredentials = RefreshCredentials(
                refreshToken = payload.refreshToken,
                refreshExpiresAtMillis = refreshExpiresAtMillis,
            ),
        )
    }

    private fun parseExpiry(statusCode: Int, value: String): Long = try {
        Instant.parse(value).toEpochMilli()
    } catch (_: Exception) {
        throw ProviderLoginException(statusCode, "A expiração da autenticação foi inválida.")
    }

    private fun publicSessionError(statusCode: Int, fallbackMessage: String): String = when (statusCode) {
        400, 401 -> "Não foi possível validar esse login. Tente novamente."
        403 -> "Esta conta não pode acessar o VibeMatch."
        410 -> "Esse código expirou. Solicite um novo."
        429 -> "Muitas tentativas. Aguarde um pouco e tente novamente."
        503 -> "Este método de login está temporariamente indisponível."
        else -> fallbackMessage
    }

    private fun publicPhoneStartError(statusCode: Int): String = when (statusCode) {
        400 -> "Digite o número com DDI, por exemplo +55 11 99999-9999."
        429 -> "Muitas tentativas. Aguarde um pouco antes de pedir outro código."
        503 -> "O login por celular está temporariamente indisponível."
        else -> "Não foi possível enviar o código agora."
    }

    private companion object {
        val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

        fun defaultHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .build()
    }
}

data class PhoneLoginChallenge(
    val verificationId: String,
    val expiresAtMillis: Long,
)

class ProviderLoginException(
    val statusCode: Int,
    message: String,
) : IOException(message)

@Serializable
private data class FacebookLoginRequest(
    @SerialName("access_token") val accessToken: String,
)

@Serializable
private data class PhoneLoginStartRequest(
    @SerialName("phone_e164") val phoneE164: String,
)

@Serializable
private data class PhoneLoginConfirmRequest(
    @SerialName("verification_id") val verificationId: String,
    val code: String,
)

@Serializable
private data class PhoneLoginStartResponse(
    @SerialName("verification_id") val verificationId: String,
    @SerialName("expires_at") val expiresAt: String,
)

@Serializable
private data class ProviderAuthSessionResponse(
    @SerialName("session_jwt") val sessionJwt: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("user_id") val userId: String,
    @SerialName("is_new_user") val isNewUser: Boolean,
    @SerialName("phone_verified") val phoneVerified: Boolean,
    @SerialName("expires_at") val expiresAt: String,
    @SerialName("refresh_expires_at") val refreshExpiresAt: String,
)
