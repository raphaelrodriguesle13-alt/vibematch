package com.vibematch.app.account

import androidx.compose.runtime.MutableState
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch

data class AccountDeletionUiState(
    val isDeleting: Boolean = false,
    val completed: Boolean = false,
    val errorMessage: String? = null,
)

class AccountDeletionViewModel(
    private val gateway: AccountDeletionGateway,
    private val accessTokenProvider: () -> String?,
    private val onSessionExpired: () -> Unit = {},
    private val onAccountDeleted: () -> Unit = {},
) : ViewModel() {
    private val mutableState: MutableState<AccountDeletionUiState> =
        mutableStateOf(AccountDeletionUiState())
    private var operationGeneration = 0L
    val state: State<AccountDeletionUiState> = mutableState

    fun reset() {
        operationGeneration += 1
        mutableState.value = AccountDeletionUiState()
    }

    fun requestDeletion() {
        if (mutableState.value.isDeleting || mutableState.value.completed) return
        val token = accessTokenProvider()?.trim()
        if (token.isNullOrEmpty()) {
            onSessionExpired()
            return
        }
        val generation = ++operationGeneration
        mutableState.value = AccountDeletionUiState(isDeleting = true)
        viewModelScope.launch {
            try {
                gateway.requestDeletion(token)
                if (generation != operationGeneration) return@launch
                mutableState.value = AccountDeletionUiState(completed = true)
                onAccountDeleted()
            } catch (error: Exception) {
                if (generation != operationGeneration) return@launch
                if (error is AccountDeletionApiException && error.statusCode == 401) {
                    mutableState.value = AccountDeletionUiState()
                    onSessionExpired()
                    return@launch
                }
                mutableState.value = AccountDeletionUiState(
                    errorMessage = publicError(error),
                )
            }
        }
    }

    fun clearError() {
        mutableState.value = mutableState.value.copy(errorMessage = null)
    }

    private fun publicError(error: Exception): String = when (error) {
        is AccountDeletionApiException ->
            error.message ?: "Não foi possível solicitar a exclusão da conta agora."
        else -> "Não foi possível solicitar a exclusão da conta agora. Verifique sua conexão."
    }
}

class AccountDeletionViewModelFactory(
    private val gateway: AccountDeletionGateway,
    private val accessTokenProvider: () -> String?,
    private val onSessionExpired: () -> Unit = {},
    private val onAccountDeleted: () -> Unit = {},
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(AccountDeletionViewModel::class.java)) {
            return AccountDeletionViewModel(
                gateway = gateway,
                accessTokenProvider = accessTokenProvider,
                onSessionExpired = onSessionExpired,
                onAccountDeleted = onAccountDeleted,
            ) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}
