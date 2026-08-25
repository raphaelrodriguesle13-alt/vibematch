package com.vibematch.app

import com.vibematch.app.chat.ChatMessage
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

class ChatApiClientTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `builds request with message and history roles`() {
        val payload = buildChatRequestBody(
            json = json,
            message = "Como funciona?",
            history = listOf(ChatMessage.assistant("Posso ajudar.")),
        )
        val root = json.parseToJsonElement(payload).jsonObject

        assertEquals("Como funciona?", root.getValue("message").jsonPrimitive.content)
        assertEquals(
            "assistant",
            root.getValue("history").jsonArray.first().jsonObject
                .getValue("role").jsonPrimitive.content,
        )
        assertEquals(
            "Posso ajudar.",
            root.getValue("history").jsonArray.first().jsonObject
                .getValue("content").jsonPrimitive.content,
        )
    }
}
