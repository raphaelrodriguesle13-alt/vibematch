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
    suspend fun loginWithGoogle(googleIdToken: String): AuthSessionBundle
    suspend fun refreshSession(refreshToken: String): AuthSessionBundle
    suspend fun logout(sessionJwt: String)
    suspend fun logoutWithRefresh(refreshToken: String)
}

data class AuthSession(
    val sessionJwt: String,
    val userId: String,
    val isNewUser: Boolean,
    val phoneVerified: Boolean,
    val expiresAtMillis: Long,
)

data class RefreshCredentials(
    val refreshToken: String,
    val refreshExpiresAtMillis: Long,
)

data class AuthSessionBundle(
    val session: AuthSession,
    val refreshCredentials: RefreshCredentials,
)

data class AuthLogoutSnapshot(
    val session: AuthSession?,
    val refreshCredentials: RefreshCredentials?,
)

class AuthApiException(
    val statusCode: Int,
    message: String,
) : IOException(message)

interface SessionStore {
    fun read(): AuthSession?
    fun readAccessToken(): String?
    fun readRefreshCredentials(): RefreshCredentials? = null
    fun readLogoutSnapshot(): AuthLogoutSnapshot = AuthLogoutSnapshot(
        session = read(),
        refreshCredentials = readRefreshCredentials(),
    )
    fun save(session: AuthSession)
    fun saveWithRefresh(session: AuthSession, credentials: RefreshCredentials) {
        save(session)
    }
    fun replaceWithRefreshIfCurrent(
        expectedAccessToken: String,
        expectedRefreshToken: String,
        session: AuthSession,
        credentials: RefreshCredentials,
    ): Boolean {
        if (
            readAccessToken() != expectedAccessToken ||
            readRefreshCredentials()?.refreshToken != expectedRefreshToken
        ) {
            return false
        }
        saveWithRefresh(session, credentials)
        return true
    }
    fun clear()
}

class SecureSessionStore(context: Context) : SessionStore {
    private val storeLock = Any()
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

    override fun read(): AuthSession? = synchronized(storeLock) {
        val sessionJwt = preferences.getString(KEY_SESSION_JWT, null) ?: return@synchronized null
        val userId = preferences.getString(KEY_USER_ID, null) ?: return@synchronized null
        val expiresAtMillis = preferences.getLong(KEY_EXPIRES_AT, 0L)
        if (sessionJwt.isBlank() || userId.isBlank() || expiresAtMillis <= 0L) {
            return@synchronized null
        }
        val refreshExpiresAtMillis = preferences.getLong(KEY_REFRESH_EXPIRES_AT, 0L)
        if (
            expiresAtMillis <= System.currentTimeMillis() &&
            (refreshExpiresAtMillis <= 0L || refreshExpiresAtMillis <= System.currentTimeMillis())
        ) {
            clear()
            return@synchronized null
        }
        AuthSession(
            sessionJwt = sessionJwt,
            userId = userId,
            isNewUser = preferences.getBoolean(KEY_IS_NEW_USER, false),
            phoneVerified = preferences.getBoolean(KEY_PHONE_VERIFIED, false),
            expiresAtMillis = expiresAtMillis,
        )
    }

    override fun readAccessToken(): String? = read()?.sessionJwt

    override fun readLogoutSnapshot(): AuthLogoutSnapshot = synchronized(storeLock) {
        AuthLogoutSnapshot(
            session = read(),
            refreshCredentials = readRefreshCredentials(),
        )
    }

    override fun readRefreshCredentials(): RefreshCredentials? = synchronized(storeLock) {
        val refreshToken = preferences.getString(KEY_REFRESH_TOKEN, null)
            ?: return@synchronized null
        val refreshExpiresAtMillis = preferences.getLong(KEY_REFRESH_EXPIRES_AT, 0L)
        if (refreshToken.isBlank() || refreshExpiresAtMillis <= System.currentTimeMillis()) {
            preferences.edit()
                .remove(KEY_REFRESH_TOKEN)
                .remove(KEY_REFRESH_EXPIRES_AT)
                .apply()
            return@synchronized null
        }
        RefreshCredentials(refreshToken, refreshExpiresAtMillis)
    }

    override fun save(session: AuthSession) = synchronized(storeLock) {
        preferences.edit()
            .putString(KEY_SESSION_JWT, session.sessionJwt)
            .putString(KEY_USER_ID, session.userId)
            .putBoolean(KEY_IS_NEW_USER, session.isNewUser)
            .putBoolean(KEY_PHONE_VERIFIED, session.phoneVerified)
            .putLong(KEY_EXPIRES_AT, session.expiresAtMillis)
            .apply()
    }

    override fun saveWithRefresh(
        session: AuthSession,
        credentials: RefreshCredentials,
    ) = synchronized(storeLock) {
        preferences.edit()
            .putString(KEY_SESSION_JWT, session.sessionJwt)
            .putString(KEY_USER_ID, session.userId)
            .putBoolean(KEY_IS_NEW_USER, session.isNewUser)
            .putBoolean(KEY_PHONE_VERIFIED, session.phoneVerified)
            .putLong(KEY_EXPIRES_AT, session.expiresAtMillis)
            .putString(KEY_REFRESH_TOKEN, credentials.refreshToken)
            .putLong(KEY_REFRESH_EXPIRES_AT, credentials.refreshExpiresAtMillis)
            .apply()
    }

    override fun replaceWithRefreshIfCurrent(
        expectedAccessToken: String,
        expectedRefreshToken: String,
        session: AuthSession,
        credentials: RefreshCredentials,
    ): Boolean = synchronized(storeLock) {
        if (
            preferences.getString(KEY_SESSION_JWT, null) != expectedAccessToken ||
            preferences.getString(KEY_REFRESH_TOKEN, null) != expectedRefreshToken
        ) {
            return@synchronized false
        }
        preferences.edit()
            .putString(KEY_SESSION_JWT, session.sessionJwt)
            .putString(KEY_USER_ID, session.userId)
            .putBoolean(KEY_IS_NEW_USER, session.isNewUser)
            .putBoolean(KEY_PHONE_VERIFIED, session.phoneVerified)
            .putLong(KEY_EXPIRES_AT, session.expiresAtMillis)
            .putString(KEY_REFRESH_TOKEN, credentials.refreshToken)
            .putLong(KEY_REFRESH_EXPIRES_AT, credentials.refreshExpiresAtMillis)
            .apply()
        true
    }

    override fun clear() = synchronized(storeLock) {
        preferences.edit().clear().apply()
    }

    private companion object {
        const val FILE_NAME = "vibematch_secure_session"
        const val KEY_SESSION_JWT = "session_jwt"
        const val KEY_USER_ID = "user_id"
        const val KEY_IS_NEW_USER = "is_new_user"
        const val KEY_PHONE_VERIFIED = "phone_verified"
        const val KEY_EXPIRES_AT = "expires_at_millis"
        const val KEY_REFRESH_TOKEN = "refresh_token"
        const val KEY_REFRESH_EXPIRES_AT = "refresh_expires_at_millis"
    }
}

class AuthApiClient(
    baseUrl: String,
    private val httpClient: OkHttpClient = defaultHttpClient(),
) : AuthGateway {
    private val baseUrl = baseUrl.trimEnd('/')
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun warmUp(): Boolean {
        val request = Request.Builder()
            .url("$baseUrl/health")
            .header("Accept", "application/json")
            .get()
            .build()
        return withContext(Dispatchers.IO) {
            runCatching {
                httpClient.newCall(request).execute().use { response -> response.isSuccessful }
            }.getOrDefault(false)
        }
    }

    override suspend fun loginWithGoogle(googleIdToken: String): AuthSessionBundle {
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
            return parseSessionBundle(it.code, responseBody)
        }
    }

    override suspend fun refreshSession(refreshToken: String): AuthSessionBundle {
        val body = buildRefreshRequestBody(json, refreshToken)
            .toRequestBody("application/json; charset=utf-8".toMediaType())
        val request = Request.Builder()
            .url("$baseUrl/auth/refresh")
            .header("Accept", "application/json")
            .post(body)
            .build()

        val response = withContext(Dispatchers.IO) {
            httpClient.newCall(request).execute()
        }
        response.use {
            val responseBody = it.body?.string().orEmpty()
            if (!it.isSuccessful) {
                throw AuthApiException(it.code, publicRefreshError(it.code))
            }
            return parseSessionBundle(it.code, responseBody)
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

    override suspend fun logoutWithRefresh(refreshToken: String) {
        val body = buildRefreshRequestBody(json, refreshToken)
            .toRequestBody("application/json; charset=utf-8".toMediaType())
        val request = Request.Builder()
            .url("$baseUrl/auth/logout/refresh")
            .header("Accept", "application/json")
            .post(body)
            .build()
        val response = withContext(Dispatchers.IO) {
            httpClient.newCall(request).execute()
        }
        response.use {
            if (!it.isSuccessful) {
                throw AuthApiException(it.code, "Logout revocation was not confirmed")
            }
        }
    }

    private fun parseSessionBundle(statusCode: Int, responseBody: String): AuthSessionBundle {
        val payload = try {
            json.decodeFromString<AuthSessionResponse>(responseBody)
        } catch (_: Exception) {
            throw AuthApiException(statusCode, "Auth response was invalid")
        }
        val expiresAtMillis = try {
            Instant.parse(payload.expiresAt).toEpochMilli()
        } catch (_: Exception) {
            throw AuthApiException(statusCode, "Auth expiry was invalid")
        }
        val refreshExpiresAtMillis = try {
            Instant.parse(payload.refreshExpiresAt).toEpochMilli()
        } catch (_: Exception) {
            throw AuthApiException(statusCode, "Refresh expiry was invalid")
        }
        if (
            payload.sessionJwt.isBlank() ||
            payload.refreshToken.isBlank() ||
            payload.userId.isBlank() ||
            refreshExpiresAtMillis <= expiresAtMillis ||
            refreshExpiresAtMillis <= System.currentTimeMillis()
        ) {
            throw AuthApiException(statusCode, "Auth response was incomplete")
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

    private fun publicLoginError(statusCode: Int): String = when (statusCode) {
        401 -> "O login Google não foi aceito. Tente novamente."
        403 -> "Esta conta não pode acessar o VibeMatch."
        429 -> "Muitas tentativas de login. Aguarde um instante e tente novamente."
        503 -> "O servidor está iniciando. Aguarde alguns segundos e tente novamente."
        else -> "Não foi possível concluir o login agora."
    }

    private fun publicRefreshError(statusCode: Int): String = when (statusCode) {
        400, 401 -> "Sua sessão expirou. Entre novamente."
        else -> "Não foi possível renovar sua sessão agora."
    }

    private companion object {
        fun defaultHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(75, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .callTimeout(90, TimeUnit.SECONDS)
            .build()
    }
}

@Serializable
private data class GoogleLoginRequest(
    @SerialName("google_id_token") val googleIdToken: String,
)

@Serializable
private data class AuthSessionResponse(
    @SerialName("session_jwt") val sessionJwt: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("user_id") val userId: String,
    @SerialName("is_new_user") val isNewUser: Boolean,
    @SerialName("phone_verified") val phoneVerified: Boolean,
    @SerialName("expires_at") val expiresAt: String,
    @SerialName("refresh_expires_at") val refreshExpiresAt: String,
)

@Serializable
private data class RefreshRequest(
    @SerialName("refresh_token") val refreshToken: String,
)

internal fun buildGoogleLoginRequestBody(json: Json, googleIdToken: String): String =
    json.encodeToString(GoogleLoginRequest(googleIdToken))

internal fun buildRefreshRequestBody(json: Json, refreshToken: String): String =
    json.encodeToString(RefreshRequest(refreshToken))
