package com.vibematch.app.auth

import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import okhttp3.Authenticator
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route

fun interface SessionTokenRefresher {
    fun refreshIfCurrent(staleAccessToken: String): String?
}

class SessionRefreshCoordinator(
    private val sessionStore: SessionStore,
    private val authGateway: AuthGateway,
    private val onSessionExpired: () -> Unit,
    private val nowMillis: () -> Long = System::currentTimeMillis,
) : SessionTokenRefresher {
    private val refreshLock = Any()
    private val recentRotations = LinkedHashMap<String, String>()
    private var expirationNotifiedFor: String? = null

    override fun refreshIfCurrent(staleAccessToken: String): String? {
        val refreshed = synchronized(refreshLock) {
            val currentToken = sessionStore.readAccessToken()
            if (currentToken.isNullOrBlank()) {
                return@synchronized null
            }
            if (currentToken != staleAccessToken) {
                return@synchronized recentRotations[staleAccessToken]
                    ?.takeIf { it == currentToken }
            }

            val tokenAfterLock = sessionStore.readAccessToken()
            if (tokenAfterLock.isNullOrBlank() || tokenAfterLock != staleAccessToken) {
                tokenAfterLock
            } else {
                val currentSession = sessionStore.read()
                val credentials = sessionStore.readRefreshCredentials()
                if (currentSession == null || credentials == null) {
                    null
                } else {
                    val refreshedBundle = runCatching {
                        runBlocking(Dispatchers.IO) {
                            authGateway.refreshSession(credentials.refreshToken)
                        }
                    }.getOrNull()
                    val sessionAfterRefresh = sessionStore.read()
                    val credentialsAfterRefresh = sessionStore.readRefreshCredentials()
                    refreshedBundle?.takeIf { bundle ->
                        sessionAfterRefresh?.userId == currentSession.userId &&
                            sessionAfterRefresh.sessionJwt == staleAccessToken &&
                            credentialsAfterRefresh?.refreshToken == credentials.refreshToken &&
                            bundle.session.userId == currentSession.userId &&
                            bundle.session.sessionJwt != staleAccessToken &&
                            bundle.refreshCredentials.refreshToken != credentials.refreshToken &&
                            bundle.session.expiresAtMillis > nowMillis() &&
                            bundle.refreshCredentials.refreshExpiresAtMillis > nowMillis()
                    }?.takeIf { bundle ->
                        sessionStore.replaceWithRefreshIfCurrent(
                            expectedAccessToken = staleAccessToken,
                            expectedRefreshToken = credentials.refreshToken,
                            session = bundle.session,
                            credentials = bundle.refreshCredentials,
                        )
                    }?.also { bundle ->
                        recentRotations[staleAccessToken] = bundle.session.sessionJwt
                        while (recentRotations.size > 4) {
                            recentRotations.remove(recentRotations.entries.first().key)
                        }
                        expirationNotifiedFor = null
                    }?.session?.sessionJwt
                }
            }
        }

        if (refreshed != null) return refreshed
        expireIfStillCurrent(staleAccessToken)
        return null
    }

    private fun expireIfStillCurrent(staleAccessToken: String) {
        var notify = false
        synchronized(refreshLock) {
            if (sessionStore.readAccessToken() == staleAccessToken) {
                sessionStore.clear()
                if (expirationNotifiedFor != staleAccessToken) {
                    expirationNotifiedFor = staleAccessToken
                    notify = true
                }
            }
        }
        if (notify) onSessionExpired()
    }
}

class SessionAuthenticator(
    private val refresher: SessionTokenRefresher,
) : Authenticator {
    override fun authenticate(route: Route?, response: Response): Request? {
        if (responseCount(response) >= 2) return null
        val authorization = response.request.header("Authorization") ?: return null
        val staleAccessToken = authorization.removePrefix("Bearer ").takeIf {
            authorization.startsWith("Bearer ") && it.isNotBlank()
        } ?: return null
        val freshAccessToken = refresher.refreshIfCurrent(staleAccessToken) ?: return null
        if (freshAccessToken == staleAccessToken) return null
        return response.request.newBuilder()
            .header("Authorization", "Bearer $freshAccessToken")
            .build()
    }

    private fun responseCount(response: Response): Int {
        var count = 1
        var prior = response.priorResponse
        while (prior != null) {
            count += 1
            prior = prior.priorResponse
        }
        return count
    }
}

fun buildSessionAwareHttpClient(refresher: SessionTokenRefresher): OkHttpClient =
    OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .authenticator(SessionAuthenticator(refresher))
        .build()
