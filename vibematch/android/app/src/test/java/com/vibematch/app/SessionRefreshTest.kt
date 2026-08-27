package com.vibematch.app

import com.vibematch.app.auth.AuthGateway
import com.vibematch.app.auth.AuthLogoutSnapshot
import com.vibematch.app.auth.AuthSession
import com.vibematch.app.auth.AuthSessionBundle
import com.vibematch.app.auth.AuthApiException
import com.vibematch.app.auth.RefreshCredentials
import com.vibematch.app.auth.SessionRefreshCoordinator
import com.vibematch.app.auth.SessionStore
import com.vibematch.app.auth.SessionAuthenticator
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionRefreshTest {
    @Test
    fun `concurrent 401 callbacks share one rotating refresh`() = runBlocking {
        val store = FakeSessionStore(session = session("access-old"), credentials = credentials("refresh-old"))
        val gateway = FakeAuthGateway()
        val refreshStarted = CountDownLatch(1)
        val releaseRefresh = CountDownLatch(1)
        gateway.onRefresh = {
            refreshStarted.countDown()
            assertTrue(releaseRefresh.await(2, TimeUnit.SECONDS))
            bundle("access-new", "refresh-new")
        }
        var expirationCallbacks = 0
        val coordinator = SessionRefreshCoordinator(
            sessionStore = store,
            authGateway = gateway,
            onSessionExpired = { _ -> expirationCallbacks += 1 },
            nowMillis = { 1_000L },
        )

        val first = async(Dispatchers.Default) { coordinator.refreshIfCurrent("access-old") }
        assertTrue(refreshStarted.await(2, TimeUnit.SECONDS))
        val second = async(Dispatchers.Default) { coordinator.refreshIfCurrent("access-old") }
        releaseRefresh.countDown()

        assertEquals("access-new", first.await())
        assertEquals("access-new", second.await())
        assertEquals(1, gateway.refreshCalls)
        assertEquals(0, expirationCallbacks)
        assertEquals("refresh-new", store.credentials?.refreshToken)
    }

    @Test
    fun `invalid refresh clears credentials and notifies expiration once`() {
        val store = FakeSessionStore(session = session("access-old"), credentials = credentials("refresh-old"))
        val gateway = FakeAuthGateway().apply {
            refreshError = AuthApiException(401, "expired")
        }
        var expirationCallbacks = 0
        val coordinator = SessionRefreshCoordinator(
            sessionStore = store,
            authGateway = gateway,
            onSessionExpired = { _ -> expirationCallbacks += 1 },
            nowMillis = { 1_000L },
        )

        assertNull(coordinator.refreshIfCurrent("access-old"))
        assertNull(store.session)
        assertNull(store.credentials)
        assertEquals(1, expirationCallbacks)
        assertNull(coordinator.refreshIfCurrent("access-old"))
        assertEquals(1, expirationCallbacks)
    }

    @Test
    fun `invalid refresh passes the captured pair to expiry logout`() {
        val store = FakeSessionStore(session = session("access-old"), credentials = credentials("refresh-old"))
        val gateway = FakeAuthGateway().apply {
            refreshError = AuthApiException(401, "expired")
        }
        var capturedSnapshot: AuthLogoutSnapshot? = null
        val coordinator = SessionRefreshCoordinator(
            sessionStore = store,
            authGateway = gateway,
            onSessionExpired = { snapshot -> capturedSnapshot = snapshot },
            nowMillis = { 1_000L },
        )

        assertNull(coordinator.refreshIfCurrent("access-old"))
        assertEquals("access-old", capturedSnapshot?.session?.sessionJwt)
        assertEquals("refresh-old", capturedSnapshot?.refreshCredentials?.refreshToken)
        assertNull(store.session)
        assertNull(store.credentials)
    }

    @Test
    fun `unknown stale callback does not borrow a different account token`() {
        val store = FakeSessionStore(session = session("access-new"), credentials = credentials("refresh-new"))
        val gateway = FakeAuthGateway()
        var expirationCallbacks = 0
        val coordinator = SessionRefreshCoordinator(
            store,
            gateway,
            onSessionExpired = { _ -> expirationCallbacks += 1 },
        )

        assertNull(coordinator.refreshIfCurrent("access-old"))
        assertEquals(0, gateway.refreshCalls)
        assertEquals(0, expirationCallbacks)
        assertEquals("access-new", store.session?.sessionJwt)
    }

    @Test
    fun `known sequential duplicate reuses the rotated token without another refresh`() {
        val store = FakeSessionStore(session = session("access-old"), credentials = credentials("refresh-old"))
        val gateway = FakeAuthGateway()
        val coordinator = SessionRefreshCoordinator(
            store,
            gateway,
            onSessionExpired = { _ -> },
            nowMillis = { 1_000L },
        )

        assertEquals("access-new", coordinator.refreshIfCurrent("access-old"))
        assertEquals("access-new", coordinator.refreshIfCurrent("access-old"))
        assertEquals(1, gateway.refreshCalls)
    }

    @Test
    fun `does not restore a session after local logout during refresh`() {
        val store = FakeSessionStore(
            session = session("access-old"),
            credentials = credentials("refresh-old"),
        )
        val gateway = FakeAuthGateway().apply {
            onRefresh = {
                store.clear()
                bundle("access-new", "refresh-new")
            }
        }
        var expirationCallbacks = 0
        val coordinator = SessionRefreshCoordinator(
            sessionStore = store,
            authGateway = gateway,
            onSessionExpired = { _ -> expirationCallbacks += 1 },
            nowMillis = { 1_000L },
        )

        assertNull(coordinator.refreshIfCurrent("access-old"))
        assertNull(store.session)
        assertNull(store.credentials)
        assertEquals(0, expirationCallbacks)

    }

    @Test
    fun `authenticator retries an authorized request only once`() {
        val refresher = com.vibematch.app.auth.SessionTokenRefresher { "access-new" }
        val authenticator = SessionAuthenticator(refresher)
        val request = Request.Builder()
            .url("https://api.example/resource")
            .header("Authorization", "Bearer access-old")
            .build()
        val firstResponse = response(request)

        val retried = authenticator.authenticate(null, firstResponse)
        assertEquals("Bearer access-new", retried?.header("Authorization"))

        val retryResponse = response(retried!!).newBuilder()
            .priorResponse(firstResponse)
            .build()
        assertNull(authenticator.authenticate(null, retryResponse))
    }

    @Test
    fun `authenticator does not refresh requests without bearer authorization`() {
        val refresher = com.vibematch.app.auth.SessionTokenRefresher { "access-new" }
        val authenticator = SessionAuthenticator(refresher)
        val request = Request.Builder().url("https://api.example/resource").build()

        assertNull(authenticator.authenticate(null, response(request)))
    }

    private fun response(request: Request): Response = Response.Builder()
        .request(request)
        .protocol(Protocol.HTTP_1_1)
        .code(401)
        .message("Unauthorized")
        .build()

    private fun session(accessToken: String) = AuthSession(
        sessionJwt = accessToken,
        userId = "user-1",
        isNewUser = false,
        phoneVerified = true,
        expiresAtMillis = 60_000L,
    )

    private fun credentials(refreshToken: String) = RefreshCredentials(
        refreshToken = refreshToken,
        refreshExpiresAtMillis = 120_000L,
    )

    private fun bundle(accessToken: String, refreshToken: String) = AuthSessionBundle(
        session(accessToken),
        credentials(refreshToken),
    )

    private class FakeAuthGateway : AuthGateway {
        var refreshCalls = 0
        var refreshError: Exception? = null
        var onRefresh: (() -> AuthSessionBundle)? = null

        override suspend fun loginWithGoogle(googleIdToken: String): AuthSessionBundle =
            error("unused")

        override suspend fun refreshSession(refreshToken: String): AuthSessionBundle {
            refreshCalls += 1
            refreshError?.let { throw it }
            return onRefresh?.invoke() ?: AuthSessionBundle(
                AuthSession(
                    sessionJwt = "access-new",
                    userId = "user-1",
                    isNewUser = false,
                    phoneVerified = true,
                    expiresAtMillis = 60_000L,
                ),
                RefreshCredentials(
                    refreshToken = "refresh-new",
                    refreshExpiresAtMillis = 120_000L,
                ),
            )
        }

        override suspend fun logout(sessionJwt: String) = Unit

        override suspend fun logoutWithRefresh(refreshToken: String) = Unit
    }

    private class FakeSessionStore(
        var session: AuthSession?,
        var credentials: RefreshCredentials?,
    ) : SessionStore {
        override fun read(): AuthSession? = session

        override fun readAccessToken(): String? = session?.sessionJwt

        override fun readRefreshCredentials(): RefreshCredentials? = credentials

        override fun save(session: AuthSession) {
            this.session = session
        }

        override fun saveWithRefresh(session: AuthSession, credentials: RefreshCredentials) {
            this.session = session
            this.credentials = credentials
        }

        override fun clear() {
            session = null
            credentials = null
        }
    }
}
