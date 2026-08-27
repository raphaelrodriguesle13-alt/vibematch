package com.vibematch.app

import com.vibematch.app.profile.AgeAssuranceStatus
import com.vibematch.app.profile.ProfileApiClient
import com.vibematch.app.profile.ProfileApiException
import com.vibematch.app.profile.ProfileDraft
import com.vibematch.app.profile.buildProfileUpdateRequestBody
import com.vibematch.app.profile.parseAgeAssuranceStatus
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ProfileApiClientTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `maps backend age assurance status without granting unknown values`() {
        assertEquals(AgeAssuranceStatus.NOT_STARTED, parseAgeAssuranceStatus("NOT_STARTED"))
        assertEquals(AgeAssuranceStatus.PENDING, parseAgeAssuranceStatus("PENDING"))
        assertEquals(AgeAssuranceStatus.APPROVED, parseAgeAssuranceStatus("APPROVED"))
        assertEquals(AgeAssuranceStatus.REJECTED, parseAgeAssuranceStatus("REJECTED"))
        assertEquals(AgeAssuranceStatus.UNKNOWN, parseAgeAssuranceStatus("FUTURE_STATUS"))
    }

    @Test
    fun `starts hosted age assurance with secure backend URL and auth`() = kotlinx.coroutines.test.runTest {
        val requests = mutableListOf<okhttp3.Request>()
        val client = ProfileApiClient(
            baseUrl = "https://api.example",
            httpClient = fakeHttpClient(
                requests = requests,
                body = "{\"data\":{\"status\":\"PENDING\",\"verification_url\":\"https://verify.example/session\"}}",
            ),
        )

        val result = client.startAgeAssurance("session-jwt")

        assertEquals(AgeAssuranceStatus.PENDING, result.status)
        assertEquals("https://verify.example/session", result.verificationUrl)
        assertEquals("POST", requests.single().method)
        assertEquals("/api/age-assurance/start", requests.single().url.encodedPath)
        assertEquals("Bearer session-jwt", requests.single().header("Authorization"))
    }

    @Test
    fun `rejects insecure hosted verification URL`() = kotlinx.coroutines.test.runTest {
        val client = ProfileApiClient(
            baseUrl = "https://api.example",
            httpClient = fakeHttpClient(
                requests = mutableListOf(),
                body = "{\"data\":{\"status\":\"PENDING\",\"verification_url\":\"http://verify.example/session\"}}",
            ),
        )

        var error: ProfileApiException? = null
        try {
            client.startAgeAssurance("session-jwt")
        } catch (caught: ProfileApiException) {
            error = caught
        }

        assertEquals("INVALID_RESPONSE", error?.errorCode)
    }

    @Test
    fun `refresh reads approval only from backend`() = kotlinx.coroutines.test.runTest {
        val client = ProfileApiClient(
            baseUrl = "https://api.example",
            httpClient = fakeHttpClient(
                requests = mutableListOf(),
                body = "{\"data\":{\"status\":\"APPROVED\"}}",
            ),
        )

        assertEquals(AgeAssuranceStatus.APPROVED, client.refreshAgeAssurance("session-jwt"))
    }

    @Test
    fun `builds profile update request with backend field names`() {
        val payload = buildProfileUpdateRequestBody(
            json = json,
            draft = ProfileDraft(
                displayName = "Rapha",
                avatarUrl = " ",
                language = "pt-BR",
                region = "BR-SP",
                interestIds = setOf(
                    "11111111-1111-4111-8111-111111111111",
                    "22222222-2222-4222-8222-222222222222",
                ),
            ),
        )
        val root = json.parseToJsonElement(payload).jsonObject

        assertEquals("Rapha", root.getValue("display_name").jsonPrimitive.content)
        assertTrue(
            root["avatar_url"] == null || root["avatar_url"].toString() == "null",
        )
        assertEquals("pt-BR", root.getValue("language").jsonPrimitive.content)
        assertEquals("BR-SP", root.getValue("region").jsonPrimitive.content)
        assertEquals(2, root.getValue("interest_ids").jsonArray.size)
    }

    private fun fakeHttpClient(
        requests: MutableList<okhttp3.Request>,
        body: String,
        statusCode: Int = 200,
    ): OkHttpClient = OkHttpClient.Builder()
        .addInterceptor { chain ->
            requests += chain.request()
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
