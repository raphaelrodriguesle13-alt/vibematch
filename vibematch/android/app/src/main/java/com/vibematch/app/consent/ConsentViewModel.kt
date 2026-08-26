package com.vibematch.app.consent

import androidx.compose.runtime.MutableState
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import java.util.UUID
import kotlinx.coroutines.launch

data class ConsentUiState(
    val matchIntentId: String? = null,
    val consent: Consent? = null,
    val isLoading: Boolean = false,
    val isDeciding: Boolean = false,
    val errorMessage: String? = null,
    val infoMessage: String? = null,
    val ageBlocked: Boolean = false,
    val sessionExpired: Boolean = false,
)

class ConsentViewModel(
    private val gateway: ConsentGateway,
    private val accessTokenProvider: () -> String?,
    private val currentUserIdProvider: () -> String?,
    private val onSessionExpired: () -> Unit = {},
    private val onPhoneVerificationRequired: () -> Unit = {},
    private val onAgeAssuranceRequired: () -> Unit = {},
) : ViewModel() {
    private val mutableState: MutableState<ConsentUiState> = mutableStateOf(ConsentUiState())
    val state: State<ConsentUiState> = mutableState

    fun reset() {
        mutableState.value = ConsentUiState()
    }

    fun create(matchIntentId: String) {
        if (mutableState.value.isLoading || mutableState.value.isDeciding) return
        if (matchIntentId.isBlank()) {
            mutableState.value = mutableState.value.copy(
                errorMessage = "A solicitação de conexão não está disponível.",
            )
            return
        }
        val token = accessTokenProvider()?.trim()
        if (token.isNullOrEmpty()) {
            expireSession()
            return
        }
        mutableState.value = ConsentUiState(
            matchIntentId = matchIntentId,
            isLoading = true,
        )
        viewModelScope.launch {
            try {
                val consent = gateway.create(token, matchIntentId)
                mutableState.value = mutableState.value.copy(
                    consent = consent,
                    isLoading = false,
                    errorMessage = null,
                )
            } catch (error: Exception) {
                if (!handleEligibilityOrSessionError(error)) {
                    mutableState.value = mutableState.value.copy(
                        isLoading = false,
                        errorMessage = publicError(error),
                    )
                }
            }
        }
    }

    fun decide(decision: ConsentDecision) {
        if (mutableState.value.isLoading || mutableState.value.isDeciding) return
        val consent = mutableState.value.consent
        if (consent == null) {
            mutableState.value = mutableState.value.copy(
                errorMessage = "Crie o consentimento antes de decidir.",
            )
            return
        }
        val token = accessTokenProvider()?.trim()
        if (token.isNullOrEmpty()) {
            expireSession()
            return
        }
        val requestId = UUID.randomUUID().toString()
        mutableState.value = mutableState.value.copy(
            isDeciding = true,
            errorMessage = null,
            infoMessage = null,
            ageBlocked = false,
            sessionExpired = false,
        )
        viewModelScope.launch {
            try {
                val updated = gateway.decide(token, consent.id, decision, requestId)
                val currentUserId = currentUserIdProvider()
                mutableState.value = mutableState.value.copy(
                    consent = updated,
                    isDeciding = false,
                    infoMessage = decisionMessage(updated, currentUserId),
                    errorMessage = null,
                )
            } catch (error: Exception) {
                if (!handleEligibilityOrSessionError(error)) {
                    mutableState.value = mutableState.value.copy(
                        isDeciding = false,
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

    private fun decisionMessage(consent: Consent, currentUserId: String?): String = when {
        consent.status == ConsentStatus.ACCEPTED_BOTH ->
            "Consentimento mútuo registrado. Qualquer vídeo ainda dependerá de uma sessão autorizada pelo backend."
        consent.status == ConsentStatus.DECLINED -> "Consentimento recusado."
        currentUserId != null && ownStatus(consent, currentUserId) == ConsentParticipantStatus.ACCEPTED ->
            "Sua decisão foi registrada. Aguarde a decisão da outra pessoa."
        else -> "Sua decisão foi registrada pelo backend."
    }

    private fun ownStatus(consent: Consent, currentUserId: String): ConsentParticipantStatus = when {
        consent.userAId == currentUserId -> consent.userAStatus
        consent.userBId == currentUserId -> consent.userBStatus
        else -> ConsentParticipantStatus.UNKNOWN
    }

    private fun handleEligibilityOrSessionError(error: Exception): Boolean {
        if (error is ConsentApiException && error.statusCode == 401) {
            expireSession()
            return true
        }
        if (error is ConsentApiException && error.errorCode == "PHONE_VERIFICATION_REQUIRED") {
            mutableState.value = mutableState.value.copy(
                isLoading = false,
                isDeciding = false,
                errorMessage = "Confirme seu telefone novamente para usar consentimento.",
            )
            onPhoneVerificationRequired()
            return true
        }
        if (error is ConsentApiException &&
            (error.statusCode == 403 || error.errorCode == "AGE_ASSURANCE_REQUIRED")
        ) {
            mutableState.value = mutableState.value.copy(
                isLoading = false,
                isDeciding = false,
                ageBlocked = true,
                errorMessage = "A verificação de idade ainda não permite usar consentimento.",
            )
            onAgeAssuranceRequired()
            return true
        }
        return false
    }

    private fun publicError(error: Exception): String = when (error) {
        is ConsentApiException -> error.message ?: "Não foi possível atualizar o consentimento agora."
        else -> "Não foi possível atualizar o consentimento agora. Verifique sua conexão."
    }

    private fun expireSession() {
        mutableState.value = mutableState.value.copy(
            isLoading = false,
            isDeciding = false,
            sessionExpired = true,
            errorMessage = "Sua sessão expirou. Entre novamente para continuar.",
        )
        onSessionExpired()
    }
}

class ConsentViewModelFactory(
    private val gateway: ConsentGateway,
    private val accessTokenProvider: () -> String?,
    private val currentUserIdProvider: () -> String?,
    private val onSessionExpired: () -> Unit = {},
    private val onPhoneVerificationRequired: () -> Unit = {},
    private val onAgeAssuranceRequired: () -> Unit = {},
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(ConsentViewModel::class.java)) {
            return ConsentViewModel(
                gateway = gateway,
                accessTokenProvider = accessTokenProvider,
                currentUserIdProvider = currentUserIdProvider,
                onSessionExpired = onSessionExpired,
                onPhoneVerificationRequired = onPhoneVerificationRequired,
                onAgeAssuranceRequired = onAgeAssuranceRequired,
            ) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}
