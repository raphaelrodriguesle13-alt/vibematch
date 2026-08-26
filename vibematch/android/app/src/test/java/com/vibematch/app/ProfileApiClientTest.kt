package com.vibematch.app

import com.vibematch.app.profile.ProfileDraft
import com.vibematch.app.profile.buildProfileUpdateRequestBody
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ProfileApiClientTest {
    private val json = Json { ignoreUnknownKeys = true }

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
}
