package com.vibematch.app

import java.io.IOException
import java.util.concurrent.TimeUnit
import com.vibematch.app.chat.ChatMessage
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

interface ChatGateway {
    suspend fun send(
        accessToken: String,
        message: String,
        history: List<ChatMessage>,
    ): ChatReply
}

data class ChatReply(
    val requestId: String,
    val model: String,
    val text: String,
)

class ChatApiException(
    val statusCode: Int,
    message: String,
) : IOException(message)

class ChatApiClient(
    baseUrl: String,
    private val httpClient: OkHttpClient = defaultHttpClient(),
) : ChatGateway {
    private val endpoint = "${baseUrl.trimEnd('/')}/api/chat"
    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun send(
        accessToken: String,
        message: String,
        history: List<ChatMessage>,
    ): ChatReply {
        val requestBody = buildChatRequestBody(json, message, history)
            .toRequestBody("application/json; charset=utf-8".toMediaType())
        val request = Request.Builder()
            .url(endpoint)
            .header("Authorization", "Bearer $accessToken")
            .header("Accept", "application/json")
            .post(requestBody)
            .build()

        val response = httpClient.newCall(request).execute()
        response.use {
            val body = it.body?.string().orEmpty()
            if (!it.isSuccessful) {
                throw ChatApiException(it.code, "Chat request failed with HTTP ${it.code}")
            }
            val envelope = try {
                json.decodeFromString<ChatResponseEnvelope>(body)
            } catch (_: Exception) {
                throw ChatApiException(it.code, "Chat response was invalid")
            }
            return ChatReply(
                requestId = envelope.data.requestId,
                model = envelope.data.model,
                text = envelope.data.text,
            )
        }
    }

    private companion object {
        fun defaultHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(40, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .build()
    }
}

@Serializable
private data class ChatRequestBody(
    val message: String,
    val history: List<ChatHistoryItemBody> = emptyList(),
)

@Serializable
private data class ChatHistoryItemBody(
    val role: String,
    val content: String,
)

@Serializable
private data class ChatResponseEnvelope(
    val data: ChatResponseBody,
)

@Serializable
private data class ChatResponseBody(
    @kotlinx.serialization.SerialName("request_id") val requestId: String,
    val model: String,
    val text: String,
)

internal fun buildChatRequestBody(
    json: Json,
    message: String,
    history: List<ChatMessage>,
): String = json.encodeToString(
    ChatRequestBody(
        message = message,
        history = history.map { ChatHistoryItemBody(it.role.wireValue, it.text) },
    ),
)
