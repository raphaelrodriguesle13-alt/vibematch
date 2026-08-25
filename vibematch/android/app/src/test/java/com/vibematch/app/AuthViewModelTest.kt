package com.vibematch.app

import android.app.Activity
import com.vibematch.app.auth.AuthGateway
import com.vibematch.app.auth.AuthSession
import com.vibematch.app.auth.AuthViewModel
import com.vibematch.app.auth.GoogleSignInGateway
import com.vibematch.app.auth.SessionStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
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
        assertFalse(viewModel.state.value.isLoading)
        assertNull(viewModel.state.value.errorMessage)
    }

    @Test
    fun `sign out revokes backend session clears Google state and local session`() = runTest {
        store.session = testSession()
        val viewModel = AuthViewModel(google, auth, store)

        viewModel.signOut()

        assertEquals("session-jwt", auth.lastLogoutToken)
        assertTrue(google.signOutCalled)
        assertNull(store.session)
        assertNull(viewModel.state.value.session)
        assertFalse(viewModel.state.value.isLoading)
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

    private fun testSession() = AuthSession(
        sessionJwt = "session-jwt",
        userId = "user-1",
        isNewUser = false,
        phoneVerified = false,
        expiresAtMillis = System.currentTimeMillis() + 60_000,
    )

    private class FakeGoogleSignInGateway : GoogleSignInGateway {
        var error: Exception? = null
        var signOutCalled = false

        override suspend fun signIn(activity: Activity): String {
            error?.let { throw it }
            return "google-id-token"
        }

        override suspend fun signOut() {
            signOutCalled = true
        }
    }

    private class FakeAuthGateway : AuthGateway {
        var lastGoogleIdToken: String? = null
        var lastLogoutToken: String? = null

        override suspend fun loginWithGoogle(googleIdToken: String): AuthSession {
            lastGoogleIdToken = googleIdToken
            return AuthSession(
                sessionJwt = "session-jwt",
                userId = "user-1",
                isNewUser = true,
                phoneVerified = false,
                expiresAtMillis = System.currentTimeMillis() + 60_000,
            )
        }

        override suspend fun logout(sessionJwt: String) {
            lastLogoutToken = sessionJwt
        }
    }

    private class FakeSessionStore : SessionStore {
        var session: AuthSession? = null

        override fun read(): AuthSession? = session

        override fun readAccessToken(): String? = session?.sessionJwt

        override fun save(session: AuthSession) {
            this.session = session
        }

        override fun clear() {
            session = null
        }
    }
}
