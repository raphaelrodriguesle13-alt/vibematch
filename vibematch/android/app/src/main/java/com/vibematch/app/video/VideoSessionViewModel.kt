package com.vibematch.app.video

import androidx.compose.runtime.MutableState
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import java.util.UUID
import kotlinx.coroutines.launch

data class VideoSessionUiState(
    val consentId: String? = null,
    val session: VideoSession? = null,
    val isCreating: Boolean = false,
    val isIssuingToken: Boolean = false,
    val tokenIssued: Boolean = false,
    val errorMessage: String? = null,
    val infoMessage: String? = null,
    val ageBlocked: Boolean = false,
    val phoneBlocked: Boolean = false,
    val sessionExpired: Boolean = false,
)

class VideoSessionViewModel(
    private val gateway: VideoSessionGateway,
    private val accessTokenProvider: () -> String?,
    private val onSessionExpired: () -> Unit = {},
    private val onPhoneVerificationRequired: () -> Unit = {},
    private val onAgeAssuranceRequired: () -> Unit = {},
    private val onTokenIssued: (token: String, session: VideoSession) -> Unit = { _, _ -> },
) : ViewModel() {
    private val mutableState: MutableState<VideoSessionUiState> = mutableStateOf(VideoSessionUiState())
    val state: State<VideoSessionUiState> = mutableState

    fun reset() {
        mutableState.value = VideoSessionUiState()
    }

    fun create(consentId: String) {
        if (mutableState.value.isCreating || mutableState.value.isIssuingToken) return
        if (consentId.isBlank()) {
            mutableState.value = mutableState.value.copy(
                errorMessage = "O consentimento não está disponível para vídeo.",
            )
            return
        }
        val token = accessTokenProvider()?.trim()
        if (token.isNullOrEmpty()) {
            expireSession()
            return
        }
        mutableState.value = VideoSessionUiState(
            consentId = consentId,
            isCreating = true,
        )
        viewModelScope.launch {
            try {
                val session = gateway.create(token, consentId)
                mutableState.value = mutableState.value.copy(
                    session = session,
                    isCreating = false,
                    errorMessage = null,
                    infoMessage = "Sessão de vídeo autorizada pelo backend. A câmera ainda não foi iniciada.",
                )
            } catch (error: Exception) {
                if (!handleEligibilityOrSessionError(error)) {
                    mutableState.value = mutableState.value.copy(
                        isCreating = false,
                        errorMessage = publicError(error),
                    )
                }
            }
        }
    }

    fun issueToken() {
        if (mutableState.value.isCreating || mutableState.value.isIssuingToken) return
        val session = mutableState.value.session
        if (session == null) {
            mutableState.value = mutableState.value.copy(
                errorMessage = "Crie uma sessão autorizada antes de solicitar o token.",
            )
            return
        }
        val token = accessTokenProvider()?.trim()
        if (token.isNullOrEmpty()) {
            expireSession()
            return
        }
        mutableState.value = mutableState.value.copy(
            isIssuingToken = true,
            errorMessage = null,
            infoMessage = null,
            tokenIssued = false,
            ageBlocked = false,
            phoneBlocked = false,
            sessionExpired = false,
        )
        viewModelScope.launch {
            try {
                val participantToken = gateway.issueToken(token, session.id)
                onTokenIssued(participantToken, session)
                mutableState.value = mutableState.value.copy(
                    isIssuingToken = false,
                    tokenIssued = true,
                    infoMessage = "O backend emitiu uma credencial JIT. A integração de câmera/RTC ainda não está ativa.",
                    errorMessage = null,
                )
            } catch (error: Exception) {
                if (!handleEligibilityOrSessionError(error)) {
                    mutableState.value = mutableState.value.copy(
                        isIssuingToken = false,
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

    private fun handleEligibilityOrSessionError(error: Exception): Boolean {
        if (error is VideoApiException && error.statusCode == 401) {
            expireSession()
            return true
        }
        if (error is VideoApiException && error.errorCode == "PHONE_VERIFICATION_REQUIRED") {
            mutableState.value = mutableState.value.copy(
                isCreating = false,
                isIssuingToken = false,
                phoneBlocked = true,
                errorMessage = "Confirme seu telefone novamente para usar vídeo.",
            )
            onPhoneVerificationRequired()
            return true
        }
        if (error is VideoApiException && error.errorCode == "AGE_ASSURANCE_REQUIRED") {
            mutableState.value = mutableState.value.copy(
                isCreating = false,
                isIssuingToken = false,
                ageBlocked = true,
                errorMessage = "A verificação de idade ainda não permite usar vídeo.",
            )
            onAgeAssuranceRequired()
            return true
        }
        return false
    }

    private fun publicError(error: Exception): String = when (error) {
        is VideoApiException -> when {
            error.errorCode == "VIDEO_NOT_AUTHORIZED" ->
                "O backend não autorizou esta sessão de vídeo."
            error.errorCode == "RATE_LIMITED" || error.statusCode == 429 ->
                "Muitas solicitações de vídeo. Aguarde antes de tentar novamente."
            error.errorCode == "VIDEO_PROVIDER_UNAVAILABLE" || error.statusCode >= 500 ->
                "O vídeo está temporariamente indisponível."
            error.errorCode == "INVALID_VIDEO_REQUEST" ->
                "Os dados da sessão de vídeo são inválidos."
            else -> "Não foi possível autorizar o vídeo agora."
        }
        else -> "Não foi possível autorizar o vídeo agora. Verifique sua conexão."
    }

    private fun expireSession() {
        mutableState.value = mutableState.value.copy(
            isCreating = false,
            isIssuingToken = false,
            sessionExpired = true,
            errorMessage = "Sua sessão expirou. Entre novamente para continuar.",
        )
        onSessionExpired()
    }
}

class VideoSessionViewModelFactory(
    private val gateway: VideoSessionGateway,
    private val accessTokenProvider: () -> String?,
    private val onSessionExpired: () -> Unit = {},
    private val onPhoneVerificationRequired: () -> Unit = {},
    private val onAgeAssuranceRequired: () -> Unit = {},
    private val onTokenIssued: (token: String, session: VideoSession) -> Unit = { _, _ -> },
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(VideoSessionViewModel::class.java)) {
            return VideoSessionViewModel(
                gateway = gateway,
                accessTokenProvider = accessTokenProvider,
                onSessionExpired = onSessionExpired,
                onPhoneVerificationRequired = onPhoneVerificationRequired,
                onAgeAssuranceRequired = onAgeAssuranceRequired,
                onTokenIssued = onTokenIssued,
            ) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}
