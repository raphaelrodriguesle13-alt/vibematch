package com.vibematch.app.chat

import java.util.UUID

data class ChatMessage(
    val id: String,
    val role: Role,
    val text: String,
) {
    enum class Role(val wireValue: String) {
        USER("user"),
        ASSISTANT("assistant"),
    }

    companion object {
        fun user(text: String): ChatMessage = ChatMessage(
            id = UUID.randomUUID().toString(),
            role = Role.USER,
            text = text,
        )

        fun assistant(text: String): ChatMessage = ChatMessage(
            id = UUID.randomUUID().toString(),
            role = Role.ASSISTANT,
            text = text,
        )
    }
}
