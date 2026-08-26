package com.vibematch.app.matching

import androidx.compose.runtime.MutableState
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch

data class MatchIntentUiState(
    val incoming: List<MatchIntent> = emptyList(),
    val isLoading: Boolean = false,
    val respondingIntentId: String? = null,
    val hasLoaded: Boolean = false,
    val errorMessage: String? = null,
    val infoMessage: String? = null,
    val ageBlocked: Boolean = false,
    val sessionExpired: Boolean = false,
)

class MatchIntentViewModel(
    private val gateway: MatchIntentGateway,
    private val accessTokenProvider: () -> String?,
    private val onSessionExpired: () -> Unit = {},
    private val onPhoneVerificationRequired: () -> Unit = {},
) : ViewModel() {
    private val mutableState: MutableState<MatchIntentUiState> =
        mutableStateOf(MatchIntentUiState())
    val state: State<MatchIntentUiState> = mutableState

    fun reset() {
        mutableState.value = MatchIntentUiState()
    }

    fun load(refresh: Boolean = false) {
        if (mutableState.value.isLoading || (mutableState.value.hasLoaded && !refresh)) return
        val token = accessTokenProvider()?.trim()
        if (token.isNullOrEmpty()) {
            expireSession()
            return
        }
        mutableState.value = mutableState.value.copy(
            isLoading = true,
            errorMessage = null,
            infoMessage = null,
            ageBlocked = false,
            sessionExpired = false,
        )
        viewModelScope.launch {
            try {
                val incoming = gateway.listIncoming(token)
                mutableState.value = mutableState.value.copy(
                    incoming = incoming,
                    isLoading = false,
                    hasLoaded = true,
                    errorMessage = null,
                    ageBlocked = false,
                )
            } catch (error: Exception) {
                if (!handleSessionOrAgeError(error)) {
                    mutableState.value = mutableState.value.copy(
                        isLoading = false,
                        errorMessage = publicError(error),
                    )
                }
            }
        }
    }

    fun respond(intentId: String, decision: MatchIntentDecision) {
        if (mutableState.value.respondingIntentId != null) return
        val intent = mutableState.value.incoming.firstOrNull { it.id == intentId }
        if (intent == null || intent.status != MatchIntentStatus.SENT) {
            mutableState.value = mutableState.value.copy(
                errorMessage = "Essa solicitação não está mais disponível.",
            )
            return
        }
        val token = accessTokenProvider()?.trim()
        if (token.isNullOrEmpty()) {
            expireSession()
            return
        }
        mutableState.value = mutableState.value.copy(
            respondingIntentId = intentId,
            errorMessage = null,
            infoMessage = null,
            ageBlocked = false,
            sessionExpired = false,
        )
        viewModelScope.launch {
            try {
                val updated = gateway.respond(token, intentId, decision)
                mutableState.value = mutableState.value.copy(
                    incoming = mutableState.value.incoming.map { current ->
                        if (current.id == updated.id) updated else current
                    },
                    respondingIntentId = null,
                    infoMessage = if (decision == MatchIntentDecision.ACCEPTED) {
                        "Solicitação aceita. Qualquer vídeo dependerá de consentimento mútuo e nova autorização do backend."
                    } else {
                        "Solicitação recusada."
                    },
                    errorMessage = null,
                )
            } catch (error: Exception) {
                if (!handleSessionOrAgeError(error)) {
                    mutableState.value = mutableState.value.copy(
                        respondingIntentId = null,
                        errorMessage = publicError(error),
                    )
                }
            }
        }
    }

    fun clearMessages() {
        mutableState.value = mutableState.value.copy(
            errorMessage = null,
            infoMessage = null,
        )
    }

    private fun handleSessionOrAgeError(error: Exception): Boolean {
        if (error is MatchIntentApiException && error.statusCode == 401) {
            expireSession()
            return true
        }
        if (error is MatchIntentApiException && error.errorCode == "PHONE_VERIFICATION_REQUIRED") {
            mutableState.value = mutableState.value.copy(
                isLoading = false,
                respondingIntentId = null,
                errorMessage = "Confirme seu telefone novamente para usar matchmaking.",
            )
            onPhoneVerificationRequired()
            return true
        }
        if (error is MatchIntentApiException &&
            (error.statusCode == 403 || error.errorCode == "AGE_ASSURANCE_REQUIRED")
        ) {
            mutableState.value = mutableState.value.copy(
                isLoading = false,
                respondingIntentId = null,
                ageBlocked = true,
                errorMessage = "A verificação de idade ainda não permite usar matchmaking.",
            )
            return true
        }
        return false
    }

    private fun publicError(error: Exception): String = when (error) {
        is MatchIntentApiException -> error.message ?: "Não foi possível carregar as solicitações agora."
        else -> "Não foi possível carregar as solicitações agora. Verifique sua conexão."
    }

    private fun expireSession() {
        mutableState.value = mutableState.value.copy(
            isLoading = false,
            respondingIntentId = null,
            sessionExpired = true,
            errorMessage = "Sua sessão expirou. Entre novamente para continuar.",
        )
        onSessionExpired()
    }
}

class MatchIntentViewModelFactory(
    private val gateway: MatchIntentGateway,
    private val accessTokenProvider: () -> String?,
    private val onSessionExpired: () -> Unit = {},
    private val onPhoneVerificationRequired: () -> Unit = {},
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(MatchIntentViewModel::class.java)) {
            return MatchIntentViewModel(
                gateway = gateway,
                accessTokenProvider = accessTokenProvider,
                onSessionExpired = onSessionExpired,
                onPhoneVerificationRequired = onPhoneVerificationRequired,
            ) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}
