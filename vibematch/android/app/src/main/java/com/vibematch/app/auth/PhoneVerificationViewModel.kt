package com.vibematch.app.auth

import androidx.compose.runtime.MutableState
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch

enum class PhoneVerificationStep {
    PHONE_INPUT,
    CODE_INPUT,
}

data class PhoneVerificationUiState(
    val phoneE164: String = "",
    val code: String = "",
    val step: PhoneVerificationStep = PhoneVerificationStep.PHONE_INPUT,
    val verificationId: String? = null,
    val expiresAtMillis: Long? = null,
    val isLoading: Boolean = false,
    val isConfirming: Boolean = false,
    val errorMessage: String? = null,
    val sessionExpired: Boolean = false,
    val completed: Boolean = false,
)

class PhoneVerificationViewModel(
    private val gateway: PhoneVerificationGateway,
    private val accessTokenProvider: () -> String?,
    private val onSessionExpired: () -> Unit = {},
    private val onPhoneVerified: () -> Unit = {},
) : ViewModel() {
    private val mutableState: MutableState<PhoneVerificationUiState> =
        mutableStateOf(PhoneVerificationUiState())
    val state: State<PhoneVerificationUiState> = mutableState

    fun reset() {
        mutableState.value = PhoneVerificationUiState()
    }

    fun updatePhone(value: String) {
        mutableState.value = mutableState.value.copy(
            phoneE164 = value,
            errorMessage = null,
        )
    }

    fun updateCode(value: String) {
        mutableState.value = mutableState.value.copy(
            code = value,
            errorMessage = null,
        )
    }

    fun start() {
        if (mutableState.value.isLoading || mutableState.value.isConfirming) return
        val phone = mutableState.value.phoneE164.trim()
        if (phone.isBlank()) {
            mutableState.value = mutableState.value.copy(
                errorMessage = "Informe seu telefone no formato internacional, como +5511999999999.",
            )
            return
        }
        val token = accessTokenProvider()?.trim()
        if (token.isNullOrEmpty()) {
            expireSession()
            return
        }
        mutableState.value = mutableState.value.copy(
            phoneE164 = phone,
            isLoading = true,
            errorMessage = null,
            sessionExpired = false,
        )
        viewModelScope.launch {
            try {
                val result = gateway.start(token, phone)
                mutableState.value = mutableState.value.copy(
                    step = PhoneVerificationStep.CODE_INPUT,
                    verificationId = result.verificationId,
                    expiresAtMillis = result.expiresAtMillis,
                    code = "",
                    isLoading = false,
                    errorMessage = null,
                )
            } catch (error: Exception) {
                if (!handleSessionError(error)) {
                    mutableState.value = mutableState.value.copy(
                        isLoading = false,
                        errorMessage = publicError(error),
                    )
                }
            }
        }
    }

    fun confirm() {
        if (mutableState.value.isLoading || mutableState.value.isConfirming) return
        val verificationId = mutableState.value.verificationId
        val code = mutableState.value.code.trim()
        if (verificationId.isNullOrBlank()) {
            mutableState.value = mutableState.value.copy(
                step = PhoneVerificationStep.PHONE_INPUT,
                errorMessage = "Solicite um novo código para continuar.",
            )
            return
        }
        if (code.isBlank()) {
            mutableState.value = mutableState.value.copy(
                errorMessage = "Informe o código recebido por SMS.",
            )
            return
        }
        val token = accessTokenProvider()?.trim()
        if (token.isNullOrEmpty()) {
            expireSession()
            return
        }
        mutableState.value = mutableState.value.copy(
            isConfirming = true,
            errorMessage = null,
            sessionExpired = false,
        )
        viewModelScope.launch {
            try {
                gateway.confirm(token, verificationId, code)
                mutableState.value = mutableState.value.copy(
                    isConfirming = false,
                    completed = true,
                    errorMessage = null,
                )
                onPhoneVerified()
            } catch (error: Exception) {
                if (!handleSessionError(error)) {
                    mutableState.value = mutableState.value.copy(
                        isConfirming = false,
                        errorMessage = publicError(error),
                    )
                }
            }
        }
    }

    fun requestNewCode() {
        mutableState.value = mutableState.value.copy(
            step = PhoneVerificationStep.PHONE_INPUT,
            code = "",
            verificationId = null,
            expiresAtMillis = null,
            errorMessage = null,
            completed = false,
        )
    }

    fun clearError() {
        mutableState.value = mutableState.value.copy(errorMessage = null)
    }

    private fun handleSessionError(error: Exception): Boolean {
        if (error is PhoneVerificationApiException && error.statusCode == 401) {
            expireSession()
            return true
        }
        return false
    }

    private fun publicError(error: Exception): String = when (error) {
        is PhoneVerificationApiException -> when (error.errorCode) {
            "INVALID_PHONE" ->
                "Informe um telefone no formato internacional, como +5511999999999."
            "INVALID_CODE" -> "O código informado é inválido. Tente novamente."
            "VERIFICATION_NOT_AVAILABLE" ->
                "Essa verificação expirou ou já foi utilizada. Solicite um novo código."
            "TOO_MANY_ATTEMPTS" ->
                "As tentativas foram bloqueadas. Solicite uma nova verificação mais tarde."
            "SMS_PROVIDER_UNAVAILABLE", "PHONE_VERIFICATION_NOT_CONFIGURED" ->
                "A verificação telefônica está temporariamente indisponível."
            else -> error.message ?: "Não foi possível verificar o telefone agora."
        }
        else -> "Não foi possível verificar o telefone agora. Verifique sua conexão."
    }

    private fun expireSession() {
        mutableState.value = mutableState.value.copy(
            isLoading = false,
            isConfirming = false,
            sessionExpired = true,
            errorMessage = "Sua sessão expirou. Entre novamente para continuar.",
        )
        onSessionExpired()
    }
}

class PhoneVerificationViewModelFactory(
    private val gateway: PhoneVerificationGateway,
    private val accessTokenProvider: () -> String?,
    private val onSessionExpired: () -> Unit = {},
    private val onPhoneVerified: () -> Unit = {},
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(PhoneVerificationViewModel::class.java)) {
            return PhoneVerificationViewModel(
                gateway = gateway,
                accessTokenProvider = accessTokenProvider,
                onSessionExpired = onSessionExpired,
                onPhoneVerified = onPhoneVerified,
            ) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}
