package com.vibematch.app.moderation

import androidx.compose.runtime.MutableState
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch

data class ModerationUiState(
    val isBlocking: Boolean = false,
    val isReporting: Boolean = false,
    val blockCompleted: Boolean = false,
    val reportCompleted: Boolean = false,
    val selectedCategory: ReportCategory = ReportCategory.OTHER,
    val errorMessage: String? = null,
    val infoMessage: String? = null,
    val sessionExpired: Boolean = false,
)

class ModerationViewModel(
    private val gateway: ModerationGateway,
    private val accessTokenProvider: () -> String?,
    private val onSessionExpired: () -> Unit = {},
    private val onBlocked: () -> Unit = {},
) : ViewModel() {
    private val mutableState: MutableState<ModerationUiState> = mutableStateOf(ModerationUiState())
    val state: State<ModerationUiState> = mutableState

    fun reset() {
        mutableState.value = ModerationUiState()
    }

    fun selectCategory(category: ReportCategory) {
        mutableState.value = mutableState.value.copy(
            selectedCategory = category,
            errorMessage = null,
        )
    }

    fun block(blockedId: String) {
        if (mutableState.value.isBlocking || mutableState.value.isReporting) return
        runAuthenticatedAction(
            action = { token -> gateway.block(token, blockedId) },
            onStarted = {
                mutableState.value = mutableState.value.copy(
                    isBlocking = true,
                    errorMessage = null,
                    infoMessage = null,
                    blockCompleted = false,
                )
            },
            onSuccess = {
                mutableState.value = mutableState.value.copy(
                    isBlocking = false,
                    blockCompleted = true,
                    infoMessage = "A conta foi bloqueada pelo backend. Esta conversa não será retomada pelo app.",
                )
                onBlocked()
            },
            onFailure = { error ->
                mutableState.value = mutableState.value.copy(
                    isBlocking = false,
                    errorMessage = publicError(error),
                )
            },
        )
    }

    fun report(reportedId: String, sessionId: String? = null) {
        if (mutableState.value.isBlocking || mutableState.value.isReporting) return
        val category = mutableState.value.selectedCategory
        runAuthenticatedAction(
            action = { token -> gateway.report(token, reportedId, sessionId, category) },
            onStarted = {
                mutableState.value = mutableState.value.copy(
                    isReporting = true,
                    errorMessage = null,
                    infoMessage = null,
                    reportCompleted = false,
                )
            },
            onSuccess = {
                mutableState.value = mutableState.value.copy(
                    isReporting = false,
                    reportCompleted = true,
                    infoMessage = "Sua denúncia foi registrada para análise do backend.",
                )
            },
            onFailure = { error ->
                mutableState.value = mutableState.value.copy(
                    isReporting = false,
                    errorMessage = publicError(error),
                )
            },
        )
    }

    fun clearMessages() {
        mutableState.value = mutableState.value.copy(
            errorMessage = null,
            infoMessage = null,
        )
    }

    private fun <T> runAuthenticatedAction(
        action: suspend (String) -> T,
        onStarted: () -> Unit,
        onSuccess: (T) -> Unit,
        onFailure: (Exception) -> Unit,
    ) {
        val token = accessTokenProvider()?.trim()
        if (token.isNullOrEmpty()) {
            mutableState.value = mutableState.value.copy(
                sessionExpired = true,
                errorMessage = "Sua sessão expirou. Entre novamente para continuar.",
            )
            onSessionExpired()
            return
        }
        onStarted()
        viewModelScope.launch {
            try {
                onSuccess(action(token))
            } catch (error: Exception) {
                if (error is ModerationApiException && error.statusCode == 401) {
                    mutableState.value = mutableState.value.copy(
                        isBlocking = false,
                        isReporting = false,
                        sessionExpired = true,
                        errorMessage = "Sua sessão expirou. Entre novamente para continuar.",
                    )
                    onSessionExpired()
                } else {
                    onFailure(error)
                }
            }
        }
    }

    private fun publicError(error: Exception): String = when (error) {
        is ModerationApiException -> when (error.errorCode) {
            "BLOCK_NOT_AVAILABLE" -> "Não foi possível bloquear esta conta agora."
            "REPORT_NOT_AVAILABLE" -> "Não foi possível registrar a denúncia agora."
            "INVALID_MODERATION_REQUEST" -> "Os dados de moderação são inválidos."
            else -> if (error.statusCode == 429) {
                "Muitas solicitações de moderação. Aguarde antes de tentar novamente."
            } else {
                "Não foi possível concluir esta ação agora."
            }
        }
        else -> "Não foi possível concluir esta ação agora. Verifique sua conexão."
    }
}

class ModerationViewModelFactory(
    private val gateway: ModerationGateway,
    private val accessTokenProvider: () -> String?,
    private val onSessionExpired: () -> Unit = {},
    private val onBlocked: () -> Unit = {},
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(ModerationViewModel::class.java)) {
            return ModerationViewModel(
                gateway = gateway,
                accessTokenProvider = accessTokenProvider,
                onSessionExpired = onSessionExpired,
                onBlocked = onBlocked,
            ) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}
