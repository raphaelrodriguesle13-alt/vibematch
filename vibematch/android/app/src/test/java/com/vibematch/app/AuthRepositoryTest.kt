package com.vibematch.app

import com.vibematch.app.auth.AuthApiClient
import com.vibematch.app.auth.AuthApiException
import com.vibematch.app.auth.buildGoogleLoginRequestBody
import com.vibematch.app.auth.buildRefreshRequestBody
import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class AuthRepositoryTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `builds Google login request with backend field name`() {
        val payload = buildGoogleLoginRequestBody(json, "google-id-token")
        val root = json.parseToJsonElement(payload).jsonObject

        assertEquals("google-id-token", root.getValue("google_id_token").jsonPrimitive.content)
    }

    @Test
    fun `login parses server session and refresh credentials`() = runTest {
        val requests = mutableListOf<okhttp3.Request>()
        val body = sessionResponseBody()
        val client = AuthApiClient(
            baseUrl = "https://api.example",
            httpClient = fakeHttpClient(requests, body),
        )

        val result = client.loginWithGoogle("google-id-token")

        assertEquals("session-jwt", result.session.sessionJwt)
        assertEquals("user-1", result.session.userId)
        assertEquals("rotated-refresh-token", result.refreshCredentials.refreshToken)
        assertEquals("POST", requests.single().method)
        assertEquals("/auth/google", requests.single().url.encodedPath)
    }

    @Test
    fun `refresh posts only the refresh token and parses rotated credentials`() = runTest {
        val requests = mutableListOf<okhttp3.Request>()
        val bodies = mutableListOf<String>()
        val client = AuthApiClient(
            baseUrl = "https://api.example",
            httpClient = fakeHttpClient(requests, sessionResponseBody(), bodies),
        )

        val result = client.refreshSession("presented-refresh-token")
        val root = json.parseToJsonElement(bodies.single()).jsonObject

        assertEquals("rotated-refresh-token", result.refreshCredentials.refreshToken)
        assertEquals("presented-refresh-token", root.getValue("refresh_token").jsonPrimitive.content)
        assertEquals("POST", requests.single().method)
        assertEquals("/auth/refresh", requests.single().url.encodedPath)
        assertTrue(requests.single().header("Authorization") == null)
    }

    @Test
    fun `refresh maps invalid rotation to a public 401 error`() = runTest {
        val client = AuthApiClient(
            baseUrl = "https://api.example",
            httpClient = fakeHttpClient(
                requests = mutableListOf(),
                body = "{\"error\":\"INVALID_REFRESH_TOKEN\"}",
                statusCode = 401,
            ),
        )

        val error = assertThrows(AuthApiException::class.java) {
            kotlinx.coroutines.runBlocking { client.refreshSession("presented-refresh-token") }
        }

        assertEquals(401, error.statusCode)
        assertEquals("Sua sessão expirou. Entre novamente.", error.message)
    }

    @Test
    fun `refresh rejects incomplete server response`() = runTest {
        val client = AuthApiClient(
            baseUrl = "https://api.example",
            httpClient = fakeHttpClient(
                requests = mutableListOf(),
                body = "{\"session_jwt\":\"only-access\"}",
            ),
        )

        val error = assertThrows(AuthApiException::class.java) {
            kotlinx.coroutines.runBlocking { client.refreshSession("presented-refresh-token") }
        }

        assertEquals(200, error.statusCode)
    }

    private fun sessionResponseBody(): String {
        val now = Instant.now()
        return """
            {
              "session_jwt":"session-jwt",
              "refresh_token":"rotated-refresh-token",
              "user_id":"user-1",
              "is_new_user":false,
              "phone_verified":true,
              "expires_at":"${now.plus(5, ChronoUnit.MINUTES)}",
              "refresh_expires_at":"${now.plus(30, ChronoUnit.DAYS)}"
            }
        """.trimIndent()
    }

    private fun fakeHttpClient(
        requests: MutableList<okhttp3.Request>,
        body: String,
        bodies: MutableList<String> = mutableListOf(),
        statusCode: Int = 200,
    ): OkHttpClient = OkHttpClient.Builder()
        .addInterceptor { chain ->
            requests += chain.request()
            val buffer = Buffer()
            chain.request().body?.writeTo(buffer)
            bodies += buffer.readUtf8()
            Response.Builder()
                .request(chain.request())
                .protocol(Protocol.HTTP_1_1)
                .code(statusCode)
                .message(if (statusCode in 200..299) "OK" else "Error")
                .body(body.toResponseBody("application/json".toMediaType()))
                .build()
        }
        .build()
}
