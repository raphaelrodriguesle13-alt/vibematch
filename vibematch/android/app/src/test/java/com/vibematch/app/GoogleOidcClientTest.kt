package com.vibematch.app

import com.vibematch.app.auth.isGoogleServerClientIdConfigured
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GoogleOidcClientTest {
    @Test
    fun `blank client id is not configured`() {
        assertFalse(isGoogleServerClientIdConfigured(""))
        assertFalse(isGoogleServerClientIdConfigured("   "))
    }

    @Test
    fun `missing build placeholder is not configured`() {
        assertFalse(isGoogleServerClientIdConfigured("MISSING_GOOGLE_SERVER_CLIENT_ID"))
    }

    @Test
    fun `real client id is configured`() {
        assertTrue(isGoogleServerClientIdConfigured("1234567890-example.apps.googleusercontent.com"))
    }
}
