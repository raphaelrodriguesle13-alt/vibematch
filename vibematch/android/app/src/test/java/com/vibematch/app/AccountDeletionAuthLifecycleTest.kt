package com.vibematch.app

import android.app.Activity
import com.vibematch.app.auth.AuthGateway
import com.vibematch.app.auth.AuthLogoutSnapshot
import com.vibematch.app.auth.AuthSession
import com.vibematch.app.auth.AuthSessionBundle
import com.vibematch.app.auth.AuthViewModel
import com.vibematch.app.auth.GoogleSignInGateway
import com.vibematch.app.auth.RefreshCredentials
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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AccountDeletionAuthLifecycleTest {
    private val dispatcher = UnconfinedTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `server accepted deletion clears access refresh and local realtime authority`() = runTest {
        val events = mutableListOf<String>()
        val store = FakeSessionStore(
            session = testSession(),
            refreshCredentials = testRefresh(),
            events = events,
        )
        val google = FakeGoogleGateway(events = events)
        val viewModel = AuthViewModel(google, FakeAuthGateway(), store)

        viewModel.completeAccountDeletion {
            events += "realtime-revoked"
        }
        advanceUntilIdle()

        assertNull(store.session)
        assertNull(store.refreshCredentials)
        assertNull(viewModel.state.value.session)
        assertTrue(google.signOutCalled)
        assertEquals(
            listOf("store-clear", "realtime-revoked", "google-sign-out"),
            events,
        )
    }

    @Test
    fun `late login callback cannot restore deleted account`() = runTest {
        val releaseGoogle = CompletableDeferred<String>()
        val store = FakeSessionStore()
        val google = FakeGoogleGateway(onSignIn = { releaseGoogle.await() })
        val viewModel = AuthViewModel(google, FakeAuthGateway(), store)

        viewModel.signIn(Activity())
        viewModel.completeAccountDeletion()
        releaseGoogle.complete("google-id-token")
        advanceUntilIdle()

        assertNull(store.session)
        assertNull(store.refreshCredentials)
        assertNull(viewModel.state.value.session)
    }

    private fun testSession() = AuthSession(
        sessionJwt = "session-jwt",
        userId = "user-1",
        isNewUser = false,
        phoneVerified = true,
        expiresAtMillis = System.currentTimeMillis() + 60_000,
    )

    private fun testRefresh() = RefreshCredentials(
        refreshToken = "refresh-token",
        refreshExpiresAtMillis = System.currentTimeMillis() + 86_400_000,
    )

    private class FakeGoogleGateway(
        private val events: MutableList<String>? = null,
        private val onSignIn: (suspend () -> String)? = null,
    ) : GoogleSignInGateway {
        var signOutCalled = false

        override suspend fun signIn(activity: Activity): String =
            onSignIn?.invoke() ?: "google-id-token"

        override suspend fun signOut() {
            signOutCalled = true
            events?.add("google-sign-out")
        }
    }

    private class FakeAuthGateway : AuthGateway {
        override suspend fun loginWithGoogle(googleIdToken: String): AuthSessionBundle = AuthSessionBundle(
            session = AuthSession(
                sessionJwt = "late-session",
                userId = "user-1",
                isNewUser = false,
                phoneVerified = true,
                expiresAtMillis = System.currentTimeMillis() + 60_000,
            ),
            refreshCredentials = RefreshCredentials(
                refreshToken = "late-refresh",
                refreshExpiresAtMillis = System.currentTimeMillis() + 86_400_000,
            ),
        )

        override suspend fun refreshSession(refreshToken: String): AuthSessionBundle =
            loginWithGoogle("unused")

        override suspend fun logout(sessionJwt: String) = Unit

        override suspend fun logoutWithRefresh(refreshToken: String) = Unit
    }

    private class FakeSessionStore(
        var session: AuthSession? = null,
        var refreshCredentials: RefreshCredentials? = null,
        private val events: MutableList<String>? = null,
    ) : SessionStore {
        override fun read(): AuthSession? = session

        override fun readAccessToken(): String? = session?.sessionJwt

        override fun readRefreshCredentials(): RefreshCredentials? = refreshCredentials

        override fun readLogoutSnapshot() = AuthLogoutSnapshot(session, refreshCredentials)

        override fun save(session: AuthSession) {
            this.session = session
        }

        override fun saveWithRefresh(session: AuthSession, credentials: RefreshCredentials) {
            this.session = session
            refreshCredentials = credentials
        }

        override fun clear() {
            events?.add("store-clear")
            session = null
            refreshCredentials = null
        }
    }
}
