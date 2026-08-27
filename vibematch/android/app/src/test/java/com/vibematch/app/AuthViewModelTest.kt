package com.vibematch.app

import android.app.Activity
import com.vibematch.app.auth.AuthGateway
import com.vibematch.app.auth.AuthLogoutSnapshot
import com.vibematch.app.auth.AuthSession
import com.vibematch.app.auth.AuthSessionBundle
import com.vibematch.app.auth.RefreshCredentials
import com.vibematch.app.auth.AuthViewModel
import com.vibematch.app.auth.GoogleSignInGateway
import com.vibematch.app.auth.SessionStore
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AuthViewModelTest {
    private val dispatcher = UnconfinedTestDispatcher()
    private lateinit var google: FakeGoogleSignInGateway
    private lateinit var auth: FakeAuthGateway
    private lateinit var store: FakeSessionStore

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        google = FakeGoogleSignInGateway()
        auth = FakeAuthGateway()
        store = FakeSessionStore()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `sign in exchanges Google ID token and stores backend session`() = runTest {
        val viewModel = AuthViewModel(google, auth, store)

        viewModel.signIn(Activity())

        assertEquals("google-id-token", auth.lastGoogleIdToken)
        assertEquals("session-jwt", viewModel.state.value.session?.sessionJwt)
        assertEquals("session-jwt", store.session?.sessionJwt)
        assertEquals("refresh-token", store.refreshCredentials?.refreshToken)
        assertFalse(viewModel.state.value.isLoading)
        assertNull(viewModel.state.value.errorMessage)
    }

    @Test
    fun `marks phone verified after server confirmation and persists local session hint`() {
        store.session = testSession()
        val viewModel = AuthViewModel(google, auth, store)

        viewModel.markPhoneVerified()

        assertTrue(viewModel.state.value.session?.phoneVerified == true)
        assertTrue(store.session?.phoneVerified == true)
        assertEquals("session-jwt", viewModel.state.value.session?.sessionJwt)
    }

    @Test
    fun `sign out clears local session before revoking refresh credentials`() = runTest {
        store.session = testSession()
        store.refreshCredentials = testRefreshCredentials()
        val events = mutableListOf<String>()
        store.events = events
        auth.events = events
        google.events = events
        val viewModel = AuthViewModel(google, auth, store)

        viewModel.signOut()

        assertNull(auth.lastLogoutToken)
        assertEquals("refresh-token", auth.lastRefreshLogoutToken)
        assertTrue(google.signOutCalled)
        assertNull(store.session)
        assertNull(store.refreshCredentials)
        assertNull(viewModel.state.value.session)
        assertFalse(viewModel.state.value.isLoading)
        assertNull(viewModel.state.value.errorMessage)
        assertEquals(
            listOf("store-clear", "refresh-logout", "google-sign-out"),
            events,
        )
    }

    @Test
    fun `expired access still sends the valid refresh credential for revocation`() = runTest {
        store.session = testSession(expiresAtMillis = System.currentTimeMillis() - 1)
        store.refreshCredentials = testRefreshCredentials()
        val viewModel = AuthViewModel(google, auth, store)

        viewModel.signOut()

        assertNull(auth.lastLogoutToken)
        assertEquals("refresh-token", auth.lastRefreshLogoutToken)
        assertNull(store.session)
        assertNull(store.refreshCredentials)
    }

    @Test
    fun `duplicate sign out does not revoke the same snapshot twice`() = runTest {
        store.session = testSession()
        store.refreshCredentials = testRefreshCredentials()
        val releaseRevocation = CompletableDeferred<Unit>()
        auth.onRefreshLogout = { releaseRevocation.await() }
        val viewModel = AuthViewModel(google, auth, store)

        viewModel.signOut()
        viewModel.signOut()

        assertEquals(0, auth.logoutCalls)
        assertEquals(1, auth.refreshLogoutCalls)
        releaseRevocation.complete(Unit)
        advanceUntilIdle()
    }

    @Test
    fun `late revocation from account A cannot clear account B`() = runTest {
        store.session = testSession(userId = "user-a", sessionJwt = "session-a")
        store.refreshCredentials = testRefreshCredentials("refresh-a")
        val releaseRevocation = CompletableDeferred<Unit>()
        auth.onRefreshLogout = { releaseRevocation.await() }
        val viewModel = AuthViewModel(google, auth, store)

        viewModel.signOut()
        assertNull(viewModel.state.value.session)
        assertNull(store.session)

        auth.loginResult = testBundle(userId = "user-b", sessionJwt = "session-b", refreshToken = "refresh-b")
        viewModel.signIn(Activity())
        assertEquals("user-b", viewModel.state.value.session?.userId)

        releaseRevocation.complete(Unit)
        advanceUntilIdle()

        assertEquals("user-b", viewModel.state.value.session?.userId)
        assertEquals("user-b", store.session?.userId)
        assertEquals("refresh-b", store.refreshCredentials?.refreshToken)
        assertFalse(google.signOutCalled)
    }

    @Test
    fun `sign out uses legacy access logout only when refresh is unavailable`() = runTest {
        store.session = testSession()
        val viewModel = AuthViewModel(google, auth, store)

        viewModel.signOut()

        assertEquals("session-jwt", auth.lastLogoutToken)
        assertNull(auth.lastRefreshLogoutToken)
        assertNull(store.session)
        assertNull(store.refreshCredentials)
        assertNull(viewModel.state.value.errorMessage)
    }

    @Test
    fun `sign out clears local session but surfaces unconfirmed refresh revocation`() = runTest {
        store.session = testSession()
        store.refreshCredentials = testRefreshCredentials()
        auth.refreshLogoutError = IllegalStateException("backend unavailable")
        val viewModel = AuthViewModel(google, auth, store)

        viewModel.signOut()

        assertEquals("refresh-token", auth.lastRefreshLogoutToken)
        assertNull(store.session)
        assertNull(store.refreshCredentials)
        assertEquals(
            "A sessão local foi encerrada, mas o servidor não confirmou a revogação.",
            viewModel.state.value.errorMessage,
        )
    }

    @Test
    fun `sign in exposes public error and does not persist on provider failure`() = runTest {
        google.error = IllegalStateException("private provider detail")
        val viewModel = AuthViewModel(google, auth, store)

        viewModel.signIn(Activity())

        assertEquals(
            "Não foi possível concluir o login agora. Verifique sua conexão.",
            viewModel.state.value.errorMessage,
        )
        assertNull(store.session)
    }

    private fun testSession(
        userId: String = "user-1",
        sessionJwt: String = "session-jwt",
        expiresAtMillis: Long = System.currentTimeMillis() + 60_000,
    ) = AuthSession(
        sessionJwt = sessionJwt,
        userId = userId,
        isNewUser = false,
        phoneVerified = false,
        expiresAtMillis = expiresAtMillis,
    )

    private fun testRefreshCredentials(refreshToken: String = "refresh-token") = RefreshCredentials(
        refreshToken = refreshToken,
        refreshExpiresAtMillis = System.currentTimeMillis() + 86_400_000,
    )

    private fun testBundle(
        userId: String,
        sessionJwt: String,
        refreshToken: String,
    ) = AuthSessionBundle(
        session = testSession(userId = userId, sessionJwt = sessionJwt),
        refreshCredentials = testRefreshCredentials(refreshToken),
    )

    private class FakeGoogleSignInGateway : GoogleSignInGateway {
        var error: Exception? = null
        var signOutCalled = false
        var events: MutableList<String>? = null

        override suspend fun signIn(activity: Activity): String {
            error?.let { throw it }
            return "google-id-token"
        }

        override suspend fun signOut() {
            signOutCalled = true
            events?.add("google-sign-out")
        }
    }

    private class FakeAuthGateway : AuthGateway {
        var lastGoogleIdToken: String? = null
        var lastLogoutToken: String? = null
        var lastRefreshLogoutToken: String? = null
        var logoutError: Exception? = null
        var refreshLogoutError: Exception? = null
        var loginResult: AuthSessionBundle = AuthSessionBundle(
            session = AuthSession(
                sessionJwt = "session-jwt",
                userId = "user-1",
                isNewUser = true,
                phoneVerified = false,
                expiresAtMillis = System.currentTimeMillis() + 60_000,
            ),
            refreshCredentials = RefreshCredentials(
                refreshToken = "refresh-token",
                refreshExpiresAtMillis = System.currentTimeMillis() + 86_400_000,
            ),
        )
        var onRefreshLogout: (suspend () -> Unit)? = null
        var logoutCalls = 0
        var refreshLogoutCalls = 0
        var events: MutableList<String>? = null

        override suspend fun loginWithGoogle(googleIdToken: String): AuthSessionBundle {
            lastGoogleIdToken = googleIdToken
            return loginResult
        }

        override suspend fun refreshSession(refreshToken: String): AuthSessionBundle =
            loginWithGoogle("unused")

        override suspend fun logout(sessionJwt: String) {
            lastLogoutToken = sessionJwt
            logoutCalls += 1
            events?.add("access-logout")
            logoutError?.let { throw it }
        }

        override suspend fun logoutWithRefresh(refreshToken: String) {
            lastRefreshLogoutToken = refreshToken
            refreshLogoutCalls += 1
            events?.add("refresh-logout")
            onRefreshLogout?.invoke()
            refreshLogoutError?.let { throw it }
        }
    }

    private class FakeSessionStore : SessionStore {
        var session: AuthSession? = null
        var refreshCredentials: RefreshCredentials? = null
        var events: MutableList<String>? = null

        override fun read(): AuthSession? = session

        override fun readAccessToken(): String? = session?.sessionJwt

        override fun readRefreshCredentials(): RefreshCredentials? = refreshCredentials

        override fun readLogoutSnapshot() = AuthLogoutSnapshot(session, refreshCredentials)

        override fun save(session: AuthSession) {
            this.session = session
        }

        override fun saveWithRefresh(session: AuthSession, credentials: RefreshCredentials) {
            this.session = session
            this.refreshCredentials = credentials
        }

        override fun clear() {
            events?.add("store-clear")
            session = null
            refreshCredentials = null
        }
    }
}
