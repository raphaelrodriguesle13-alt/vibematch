package com.vibematch.app

import com.vibematch.app.auth.buildGoogleLoginRequestBody
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class AuthRepositoryTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `builds Google login request with backend field name`() {
        val payload = buildGoogleLoginRequestBody(json, "google-id-token")
        val root = json.parseToJsonElement(payload).jsonObject

        assertEquals("google-id-token", root.getValue("google_id_token").jsonPrimitive.content)
    }
}
