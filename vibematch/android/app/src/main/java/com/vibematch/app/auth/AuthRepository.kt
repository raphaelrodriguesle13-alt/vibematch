package com.vibematch.app.auth

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.io.IOException
import java.time.Instant
import java.util.concurrent.TimeUnit
import kotlinx.serialization.SerialName
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

interface AuthGateway {
    suspend fun loginWithGoogle(googleIdToken: String): AuthSession
    suspend fun logout(sessionJwt: String)
}

data class AuthSession(
    val sessionJwt: String,
    val userId: String,
    val isNewUser: Boolean,
    val phoneVerified: Boolean,
    val expiresAtMillis: Long,
)

class AuthApiException(
    val statusCode: Int,
    message: String,
) : IOException(message)

interface SessionStore {
    fun read(): AuthSession?
    fun readAccessToken(): String?
    fun save(session: AuthSession)
    fun clear()
}

class SecureSessionStore(context: Context) : SessionStore {
    private val preferences = run {
        val appContext = context.applicationContext
        val masterKey = MasterKey.Builder(appContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            appContext,
            FILE_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    override fun read(): AuthSession? {
        val sessionJwt = preferences.getString(KEY_SESSION_JWT, null) ?: return null
        val userId = preferences.getString(KEY_USER_ID, null) ?: return null
        val expiresAtMillis = preferences.getLong(KEY_EXPIRES_AT, 0L)
        if (sessionJwt.isBlank() || userId.isBlank() || expiresAtMillis <= 0L) return null
        if (expiresAtMillis <= System.currentTimeMillis()) {
            clear()
            return null
        }
        return AuthSession(
            sessionJwt = sessionJwt,
            userId = userId,
            isNewUser = preferences.getBoolean(KEY_IS_NEW_USER, false),
            phoneVerified = preferences.getBoolean(KEY_PHONE_VERIFIED, false),
            expiresAtMillis = expiresAtMillis,
        )
    }

    override fun readAccessToken(): String? = read()?.sessionJwt

    override fun save(session: AuthSession) {
        preferences.edit()
            .putString(KEY_SESSION_JWT, session.sessionJwt)
            .putString(KEY_USER_ID, session.userId)
            .putBoolean(KEY_IS_NEW_USER, session.isNewUser)
            .putBoolean(KEY_PHONE_VERIFIED, session.phoneVerified)
            .putLong(KEY_EXPIRES_AT, session.expiresAtMillis)
            .apply()
    }

    override fun clear() {
        preferences.edit().clear().apply()
    }

    private companion object {
        const val FILE_NAME = "vibematch_secure_session"
        const val KEY_SESSION_JWT = "session_jwt"
        const val KEY_USER_ID = "user_id"
        const val KEY_IS_NEW_USER = "is_new_user"
        const val KEY_PHONE_VERIFIED = "phone_verified"
        const val KEY_EXPIRES_AT = "expires_at_millis"
    }
}

class AuthApiClient(
    baseUrl: String,
    private val httpClient: OkHttpClient = defaultHttpClient(),
) : AuthGateway {
    private val baseUrl = baseUrl.trimEnd('/')
    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun loginWithGoogle(googleIdToken: String): AuthSession {
        val body = buildGoogleLoginRequestBody(json, googleIdToken)
            .toRequestBody("application/json; charset=utf-8".toMediaType())
        val request = Request.Builder()
            .url("$baseUrl/auth/google")
            .header("Accept", "application/json")
            .post(body)
            .build()

        val response = withContext(Dispatchers.IO) {
            httpClient.newCall(request).execute()
        }
        response.use {
            val responseBody = it.body?.string().orEmpty()
            if (!it.isSuccessful) {
                throw AuthApiException(it.code, publicLoginError(it.code))
            }
            val payload = try {
                json.decodeFromString<GoogleLoginResponse>(responseBody)
            } catch (_: Exception) {
                throw AuthApiException(it.code, "Auth response was invalid")
            }
            val expiresAtMillis = try {
                Instant.parse(payload.expiresAt).toEpochMilli()
            } catch (_: Exception) {
                throw AuthApiException(it.code, "Auth expiry was invalid")
            }
            if (payload.sessionJwt.isBlank() || payload.userId.isBlank()) {
                throw AuthApiException(it.code, "Auth response was incomplete")
            }
            return AuthSession(
                sessionJwt = payload.sessionJwt,
                userId = payload.userId,
                isNewUser = payload.isNewUser,
                phoneVerified = payload.phoneVerified,
                expiresAtMillis = expiresAtMillis,
            )
        }
    }

    override suspend fun logout(sessionJwt: String) {
        val request = Request.Builder()
            .url("$baseUrl/auth/logout")
            .header("Authorization", "Bearer $sessionJwt")
            .header("Accept", "application/json")
            .post("{}".toRequestBody("application/json; charset=utf-8".toMediaType()))
            .build()
        val response = withContext(Dispatchers.IO) {
            httpClient.newCall(request).execute()
        }
        response.use {
            if (!it.isSuccessful && it.code != 401) {
                throw AuthApiException(it.code, "Logout failed")
            }
        }
    }

    private fun publicLoginError(statusCode: Int): String = when (statusCode) {
        401 -> "O login Google não foi aceito. Tente novamente."
        403 -> "Esta conta não pode acessar o VibeMatch."
        else -> "Não foi possível concluir o login agora."
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
private data class GoogleLoginRequest(
    @SerialName("google_id_token") val googleIdToken: String,
)

@Serializable
private data class GoogleLoginResponse(
    @SerialName("session_jwt") val sessionJwt: String,
    @SerialName("user_id") val userId: String,
    @SerialName("is_new_user") val isNewUser: Boolean,
    @SerialName("phone_verified") val phoneVerified: Boolean,
    @SerialName("expires_at") val expiresAt: String,
)

internal fun buildGoogleLoginRequestBody(json: Json, googleIdToken: String): String =
    json.encodeToString(GoogleLoginRequest(googleIdToken))
