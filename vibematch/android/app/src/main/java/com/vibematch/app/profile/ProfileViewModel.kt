package com.vibematch.app.profile

import androidx.compose.runtime.MutableState
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import java.util.Locale
import kotlinx.coroutines.launch

enum class ProfileGate {
    READY,
    AGE_NOT_STARTED,
    AGE_PENDING,
    AGE_REJECTED,
    AGE_UNAVAILABLE,
    BLOCKED,
    SUSPENDED,
}

data class ProfileUiState(
    val isLoading: Boolean = false,
    val isStartingAgeAssurance: Boolean = false,
    val isRefreshingAgeAssurance: Boolean = false,
    val isSaving: Boolean = false,
    val hasLoaded: Boolean = false,
    val profile: UserProfile? = null,
    val availableInterests: List<ProfileInterest> = emptyList(),
    val draft: ProfileDraft = defaultProfileDraft(),
    val errorMessage: String? = null,
    val infoMessage: String? = null,
    val ageVerificationUrl: String? = null,
    val sessionExpired: Boolean = false,
    val profileIncomplete: Boolean = false,
    val gate: ProfileGate = ProfileGate.READY,
    val saved: Boolean = false,
)

class ProfileViewModel(
    private val gateway: ProfileGateway,
    private val accessTokenProvider: () -> String?,
    private val onSessionExpired: () -> Unit = {},
) : ViewModel() {
    private val mutableState: MutableState<ProfileUiState> = mutableStateOf(ProfileUiState())
    val state: State<ProfileUiState> = mutableState
    private var requestGeneration = 0L

    fun reset() {
        requestGeneration += 1
        mutableState.value = ProfileUiState()
    }

    fun load() {
        if (mutableState.value.isLoading || mutableState.value.hasLoaded) return
        val token = accessTokenProvider()?.trim()
        if (token.isNullOrEmpty()) {
            expireSession()
            return
        }
        val generation = requestGeneration
        mutableState.value = mutableState.value.copy(isLoading = true, errorMessage = null)
        viewModelScope.launch {
            try {
                val interests = gateway.listInterests(token)
                if (!isCurrentRequest(generation, token)) return@launch
                val profile = gateway.getProfile(token)
                if (!isCurrentRequest(generation, token)) return@launch
                val ageStatus = try {
                    gateway.getAgeAssuranceStatus(token)
                } catch (error: Exception) {
                    if (error is ProfileApiException && error.statusCode == 401) throw error
                    AgeAssuranceStatus.UNKNOWN
                }
                if (!isCurrentRequest(generation, token)) return@launch
                mutableState.value = mutableState.value.copy(
                    isLoading = false,
                    hasLoaded = true,
                    profile = profile,
                    ageVerificationUrl = null,
                    availableInterests = interests,
                    draft = profile?.toDraft() ?: defaultProfileDraft(),
                    profileIncomplete = profile == null,
                    gate = gateFor(ageStatus),
                    errorMessage = null,
                )
            } catch (error: Exception) {
                if (!isCurrentRequest(generation, token)) return@launch
                if (!handleSessionOrGateError(error)) {
                    mutableState.value = mutableState.value.copy(
                        isLoading = false,
                        errorMessage = publicError(error),
                    )
                }
            }
        }
    }

    fun updateDisplayName(value: String) {
        updateDraft { copy(displayName = value) }
    }

    fun updateAvatarUrl(value: String) {
        updateDraft { copy(avatarUrl = value) }
    }

    fun updateLanguage(value: String) {
        updateDraft { copy(language = value) }
    }

    fun updateRegion(value: String) {
        updateDraft { copy(region = value) }
    }

    fun toggleInterest(interestId: String) {
        if (interestId !in mutableState.value.availableInterests.map(ProfileInterest::id)) return
        val selected = mutableState.value.draft.interestIds
        val next = if (interestId in selected) {
            selected - interestId
        } else if (selected.size < MAX_INTERESTS) {
            selected + interestId
        } else {
            mutableState.value = mutableState.value.copy(
                errorMessage = "Você pode selecionar até $MAX_INTERESTS interesses.",
            )
            return
        }
        updateDraft { copy(interestIds = next) }
    }

    fun startAgeAssurance() {
        if (mutableState.value.isStartingAgeAssurance || mutableState.value.isRefreshingAgeAssurance) return
        val token = accessTokenProvider()?.trim()
        if (token.isNullOrEmpty()) {
            expireSession()
            return
        }
        val generation = requestGeneration
        mutableState.value = mutableState.value.copy(
            isStartingAgeAssurance = true,
            errorMessage = null,
            infoMessage = null,
        )
        viewModelScope.launch {
            try {
                val result = gateway.startAgeAssurance(token)
                if (!isCurrentRequest(generation, token)) return@launch
                mutableState.value = mutableState.value.copy(
                    isStartingAgeAssurance = false,
                    gate = gateFor(result.status),
                    ageVerificationUrl = result.verificationUrl,
                    errorMessage = null,
                    infoMessage = "A verificação foi iniciada pelo provedor. Abra o link seguro e volte ao app para atualizar o status.",
                )
            } catch (error: Exception) {
                if (isCurrentRequest(generation, token)) handleAgeAssuranceError(error)
            }
        }
    }

    fun refreshAgeAssurance() {
        if (mutableState.value.isStartingAgeAssurance || mutableState.value.isRefreshingAgeAssurance) return
        val token = accessTokenProvider()?.trim()
        if (token.isNullOrEmpty()) {
            expireSession()
            return
        }
        val generation = requestGeneration
        mutableState.value = mutableState.value.copy(
            isRefreshingAgeAssurance = true,
            errorMessage = null,
        )
        viewModelScope.launch {
            try {
                val status = gateway.refreshAgeAssurance(token)
                if (!isCurrentRequest(generation, token)) return@launch
                mutableState.value = mutableState.value.copy(
                    isRefreshingAgeAssurance = false,
                    gate = gateFor(status),
                    ageVerificationUrl = if (status == AgeAssuranceStatus.PENDING) {
                        mutableState.value.ageVerificationUrl
                    } else {
                        null
                    },
                    errorMessage = null,
                    infoMessage = if (status == AgeAssuranceStatus.APPROVED) {
                        "Verificação aprovada pelo backend."
                    } else {
                        null
                    },
                )
            } catch (error: Exception) {
                if (isCurrentRequest(generation, token)) handleAgeAssuranceError(error)
            }
        }
    }

    fun save() {
        if (mutableState.value.isSaving) return
        val token = accessTokenProvider()?.trim()
        if (token.isNullOrEmpty()) {
            expireSession()
            return
        }
        val draft = mutableState.value.draft.copy(
            displayName = mutableState.value.draft.displayName.trim(),
            avatarUrl = mutableState.value.draft.avatarUrl.trim(),
            language = mutableState.value.draft.language.trim(),
            region = mutableState.value.draft.region.trim(),
        )
        val validationError = validateDraft(draft)
        if (validationError != null) {
            mutableState.value = mutableState.value.copy(errorMessage = validationError)
            return
        }
        val generation = requestGeneration
        mutableState.value = mutableState.value.copy(
            draft = draft,
            isSaving = true,
            errorMessage = null,
            saved = false,
        )
        viewModelScope.launch {
            try {
                val profile = gateway.updateProfile(token, draft)
                if (!isCurrentRequest(generation, token)) return@launch
                mutableState.value = mutableState.value.copy(
                    isSaving = false,
                    profile = profile,
                    draft = profile.toDraft(),
                    profileIncomplete = false,
                    errorMessage = null,
                    saved = true,
                )
            } catch (error: Exception) {
                if (!isCurrentRequest(generation, token)) return@launch
                if (!handleSessionOrGateError(error)) {
                    mutableState.value = mutableState.value.copy(
                        isSaving = false,
                        errorMessage = publicError(error),
                    )
                }
            }
        }
    }

    fun clearError() {
        mutableState.value = mutableState.value.copy(errorMessage = null)
    }

    fun clearInfo() {
        mutableState.value = mutableState.value.copy(infoMessage = null)
    }

    fun clearSaved() {
        mutableState.value = mutableState.value.copy(saved = false)
    }

    private fun isCurrentRequest(generation: Long, token: String): Boolean =
        requestGeneration == generation && accessTokenProvider()?.trim() == token

    private fun updateDraft(transform: ProfileDraft.() -> ProfileDraft) {
        mutableState.value = mutableState.value.copy(
            draft = transform(mutableState.value.draft),
            errorMessage = null,
            saved = false,
        )
    }

    private fun validateDraft(draft: ProfileDraft): String? = when {
        draft.displayName.isBlank() -> "Informe como você quer ser chamado."
        draft.language.isBlank() -> "Informe seu idioma."
        draft.region.isBlank() -> "Informe sua região."
        else -> null
    }

    private fun handleAgeAssuranceError(error: Exception) {
        if (error is ProfileApiException && error.statusCode == 401) {
            expireSession()
            return
        }
        val gate = gateFor(error)
        mutableState.value = mutableState.value.copy(
            isStartingAgeAssurance = false,
            isRefreshingAgeAssurance = false,
            gate = gate ?: mutableState.value.gate,
            errorMessage = publicError(error),
        )
    }

    private fun handleSessionOrGateError(error: Exception): Boolean {
        if (error is ProfileApiException && error.statusCode == 401) {
            expireSession()
            return true
        }
        val gate = gateFor(error)
        if (gate != null) {
            mutableState.value = mutableState.value.copy(
                isLoading = false,
                isSaving = false,
                gate = gate,
                errorMessage = null,
            )
            return true
        }
        return false
    }

    private fun gateFor(status: AgeAssuranceStatus): ProfileGate = when (status) {
        AgeAssuranceStatus.NOT_STARTED -> ProfileGate.AGE_NOT_STARTED
        AgeAssuranceStatus.PENDING -> ProfileGate.AGE_PENDING
        AgeAssuranceStatus.APPROVED -> ProfileGate.READY
        AgeAssuranceStatus.REJECTED -> ProfileGate.AGE_REJECTED
        AgeAssuranceStatus.UNKNOWN -> ProfileGate.AGE_UNAVAILABLE
    }

    private fun gateFor(error: Exception): ProfileGate? {
        val code = (error as? ProfileApiException)?.errorCode ?: return null
        return when (code) {
            "AGE_NOT_STARTED" -> ProfileGate.AGE_NOT_STARTED
            "AGE_PENDING", "AGE_ASSURANCE_REQUIRED" -> ProfileGate.AGE_PENDING
            "AGE_REJECTED" -> ProfileGate.AGE_REJECTED
            "USER_BLOCKED" -> ProfileGate.BLOCKED
            "USER_SUSPENDED" -> ProfileGate.SUSPENDED
            else -> null
        }
    }

    private fun publicError(error: Exception): String = when (error) {
        is ProfileApiException -> when {
            error.statusCode == 403 -> "Esta conta não está autorizada para esta etapa."
            error.statusCode == 409 -> "A verificação já está em andamento. Atualize o status antes de tentar novamente."
            error.statusCode == 429 -> "Muitas tentativas. Aguarde antes de tentar novamente."
            error.errorCode == "AGE_PROVIDER_UNAVAILABLE" || error.statusCode >= 500 ->
                "O serviço de verificação está temporariamente indisponível."
            error.errorCode == "AGE_SESSION_NOT_AVAILABLE" ->
                "Nenhuma sessão de verificação está disponível. Inicie novamente pelo backend."
            error.errorCode == "INVALID_PROFILE" || error.errorCode == "INVALID_INTERESTS" ->
                "Revise os dados do perfil e tente novamente."
            error.errorCode == "PROFILE_NOT_CONFIGURED" -> "O perfil ainda não está disponível."
            else -> error.message ?: "Não foi possível atualizar o perfil agora."
        }
        else -> "Não foi possível atualizar o perfil agora. Verifique sua conexão."
    }

    private fun expireSession() {
        mutableState.value = mutableState.value.copy(
            isLoading = false,
            isStartingAgeAssurance = false,
            isRefreshingAgeAssurance = false,
            isSaving = false,
            sessionExpired = true,
            errorMessage = "Sua sessão expirou. Entre novamente para continuar.",
        )
        onSessionExpired()
    }

    override fun onCleared() {
        requestGeneration += 1
        super.onCleared()
    }

    private companion object {
        const val MAX_INTERESTS = 10
    }
}

class ProfileViewModelFactory(
    private val gateway: ProfileGateway,
    private val accessTokenProvider: () -> String?,
    private val onSessionExpired: () -> Unit = {},
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(ProfileViewModel::class.java)) {
            return ProfileViewModel(gateway, accessTokenProvider, onSessionExpired) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}

private fun UserProfile.toDraft() = ProfileDraft(
    displayName = displayName,
    avatarUrl = avatarUrl.orEmpty(),
    language = language,
    region = region,
    interestIds = interests.map(ProfileInterest::id).toSet(),
)

private fun defaultProfileDraft(): ProfileDraft {
    val locale = Locale.getDefault()
    val language = locale.toLanguageTag().takeIf { it.isNotBlank() } ?: ""
    val region = locale.country.takeIf { it.length >= 2 } ?: ""
    return ProfileDraft(
        displayName = "",
        avatarUrl = "",
        language = language,
        region = region,
        interestIds = emptySet(),
    )
}
