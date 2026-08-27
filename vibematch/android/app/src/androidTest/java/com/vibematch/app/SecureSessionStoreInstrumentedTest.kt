package com.vibematch.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.vibematch.app.auth.AuthSession
import com.vibematch.app.auth.RefreshCredentials
import com.vibematch.app.auth.SecureSessionStore
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SecureSessionStoreInstrumentedTest {
    private lateinit var context: Context
    private lateinit var store: SecureSessionStore

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        context.deleteSharedPreferences("vibematch_secure_session")
        store = SecureSessionStore(context)
    }

    @After
    fun tearDown() {
        context.deleteSharedPreferences("vibematch_secure_session")
    }

    @Test
    fun storesAndReadsSessionAndRefreshTogether() {
        val session = session("access-1", System.currentTimeMillis() + 60_000L)
        val credentials = credentials("refresh-1", System.currentTimeMillis() + 120_000L)

        store.saveWithRefresh(session, credentials)

        assertEquals(session, store.read())
        assertEquals("access-1", store.readAccessToken())
        assertEquals(credentials, store.readRefreshCredentials())
    }

    @Test
    fun capturesLogoutPairAcrossStoreRecreation() {
        val session = session("access-logout", System.currentTimeMillis() - 1L)
        val credentials = credentials("refresh-logout", System.currentTimeMillis() + 120_000L)
        store.saveWithRefresh(session, credentials)

        val reopenedStore = SecureSessionStore(context)
        val snapshot = reopenedStore.readLogoutSnapshot()

        assertEquals(session, snapshot.session)
        assertEquals(credentials, snapshot.refreshCredentials)
        reopenedStore.clear()
    }

    @Test
    fun retainsExpiredAccessWhileRefreshIsStillValid() {
        val session = session("access-expired", System.currentTimeMillis() - 1L)
        val credentials = credentials("refresh-valid", System.currentTimeMillis() + 120_000L)

        store.saveWithRefresh(session, credentials)

        assertNotNull(store.read())
        assertEquals(credentials, store.readRefreshCredentials())
    }

    @Test
    fun expiredRefreshMakesTheStoreFailClosed() {
        val session = session("access-expired", System.currentTimeMillis() - 1L)
        val credentials = credentials("refresh-expired", System.currentTimeMillis() - 1L)

        store.saveWithRefresh(session, credentials)

        assertNull(store.read())
        assertNull(store.readRefreshCredentials())
        assertNull(store.readAccessToken())
    }

    @Test
    fun conditionalReplacementRequiresTheCurrentCredentialPair() {
        val originalSession = session("access-1", System.currentTimeMillis() + 60_000L)
        val originalCredentials = credentials("refresh-1", System.currentTimeMillis() + 120_000L)
        val rotatedSession = session("access-2", System.currentTimeMillis() + 60_000L)
        val rotatedCredentials = credentials("refresh-2", System.currentTimeMillis() + 120_000L)
        store.saveWithRefresh(originalSession, originalCredentials)

        assertFalse(
            store.replaceWithRefreshIfCurrent(
                expectedAccessToken = "wrong-access",
                expectedRefreshToken = "refresh-1",
                session = rotatedSession,
                credentials = rotatedCredentials,
            ),
        )
        assertEquals(originalSession, store.read())
        assertEquals(originalCredentials, store.readRefreshCredentials())

        assertTrue(
            store.replaceWithRefreshIfCurrent(
                expectedAccessToken = "access-1",
                expectedRefreshToken = "refresh-1",
                session = rotatedSession,
                credentials = rotatedCredentials,
            ),
        )
        assertEquals(rotatedSession, store.read())
        assertEquals(rotatedCredentials, store.readRefreshCredentials())
    }

    private fun session(accessToken: String, expiresAtMillis: Long) = AuthSession(
        sessionJwt = accessToken,
        userId = "user-1",
        isNewUser = false,
        phoneVerified = true,
        expiresAtMillis = expiresAtMillis,
    )

    private fun credentials(refreshToken: String, expiresAtMillis: Long) = RefreshCredentials(
        refreshToken = refreshToken,
        refreshExpiresAtMillis = expiresAtMillis,
    )
}
