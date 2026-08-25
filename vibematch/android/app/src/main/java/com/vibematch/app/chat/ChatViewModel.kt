package com.vibematch.app.chat

import androidx.compose.runtime.MutableState
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.vibematch.app.ChatApiException
import com.vibematch.app.ChatGateway
import kotlinx.coroutines.launch

data class ChatUiState(
    val messages: List<ChatMessage> = emptyList(),
    val isSending: Boolean = false,
    val errorMessage: String? = null,
)

class ChatViewModel(
    private val gateway: ChatGateway,
    private val accessTokenProvider: () -> String?,
    private val onSessionExpired: () -> Unit = {},
) : ViewModel() {
    private val mutableState: MutableState<ChatUiState> = mutableStateOf(ChatUiState())
    val state: State<ChatUiState> = mutableState

    fun send(draft: String) {
        val message = draft.trim()
        if (message.isEmpty() || mutableState.value.isSending) return

        val token = accessTokenProvider()?.trim()
        if (token.isNullOrEmpty()) {
            mutableState.value = mutableState.value.copy(
                errorMessage = "Entre novamente para conversar com o backend.",
            )
            return
        }

        val userMessage = ChatMessage.user(message)
        val history = mutableState.value.messages
        mutableState.value = mutableState.value.copy(
            messages = history + userMessage,
            isSending = true,
            errorMessage = null,
        )

        viewModelScope.launch {
            try {
                val reply = gateway.send(token, message, history)
                mutableState.value = mutableState.value.copy(
                    messages = mutableState.value.messages + ChatMessage.assistant(reply.text),
                    isSending = false,
                )
            } catch (error: Exception) {
                if (error is ChatApiException && error.statusCode == 401) {
                    mutableState.value = ChatUiState()
                    onSessionExpired()
                    return@launch
                }
                mutableState.value = mutableState.value.copy(
                    isSending = false,
                    errorMessage = publicError(error),
                )
            }
        }
    }

    fun clearConversation() {
        mutableState.value = ChatUiState()
    }

    fun clearError() {
        mutableState.value = mutableState.value.copy(errorMessage = null)
    }

    private fun publicError(error: Exception): String = when {
        error is ChatApiException && error.statusCode == 401 ->
            "Sua sessão expirou. Entre novamente para continuar."
        error is ChatApiException && error.statusCode == 504 ->
            "O chat demorou demais para responder. Tente novamente."
        error is ChatApiException && error.statusCode >= 500 ->
            "O chat está temporariamente indisponível. Tente novamente."
        else -> "Não foi possível enviar agora. Verifique sua conexão."
    }
}

class ChatViewModelFactory(
    private val gateway: ChatGateway,
    private val accessTokenProvider: () -> String?,
    private val onSessionExpired: () -> Unit = {},
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(ChatViewModel::class.java)) {
            return ChatViewModel(gateway, accessTokenProvider, onSessionExpired) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}
