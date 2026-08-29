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
    fun `missing build placeholders are not configured`() {
        assertFalse(isGoogleServerClientIdConfigured("MISSING_GOOGLE_SERVER_CLIENT_ID"))
        assertFalse(isGoogleServerClientIdConfigured("seu-web-client-id.apps.googleusercontent.com"))
    }

    @Test
    fun `real client id is configured`() {
        assertTrue(isGoogleServerClientIdConfigured("1234567890-example.apps.googleusercontent.com"))
    }
}
