package com.vibematch.app.auth

import android.app.Activity
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch

data class AuthUiState(
    val session: AuthSession? = null,
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
)

class AuthViewModel(
    private val googleOidcClient: GoogleSignInGateway,
    private val authGateway: AuthGateway,
    private val sessionStore: SessionStore,
) : ViewModel() {
    private val mutableState: MutableState<AuthUiState> = mutableStateOf(
        AuthUiState(session = sessionStore.read()),
    )
    val state: State<AuthUiState> = mutableState

    fun signIn(activity: Activity) {
        if (mutableState.value.isLoading) return
        mutableState.value = mutableState.value.copy(isLoading = true, errorMessage = null)

        viewModelScope.launch {
            try {
                val googleIdToken = googleOidcClient.signIn(activity)
                val sessionBundle = authGateway.loginWithGoogle(googleIdToken)
                sessionStore.saveWithRefresh(
                    sessionBundle.session,
                    sessionBundle.refreshCredentials,
                )
                mutableState.value = AuthUiState(session = sessionBundle.session)
            } catch (error: Exception) {
                mutableState.value = AuthUiState(
                    errorMessage = publicSignInError(error),
                )
            }
        }
    }

    fun markPhoneVerified() {
        updatePhoneVerificationHint(true)
    }

    fun markPhoneUnverified() {
        updatePhoneVerificationHint(false)
    }

    private fun updatePhoneVerificationHint(phoneVerified: Boolean) {
        val session = mutableState.value.session ?: return
        val updatedSession = session.copy(phoneVerified = phoneVerified)
        sessionStore.save(updatedSession)
        mutableState.value = mutableState.value.copy(session = updatedSession)
    }

    fun signOut() {
        if (mutableState.value.isLoading) return
        val session = mutableState.value.session
        mutableState.value = mutableState.value.copy(isLoading = true, errorMessage = null)

        viewModelScope.launch {
            var errorMessage: String? = null
            try {
                if (session != null) authGateway.logout(session.sessionJwt)
            } catch (_: Exception) {
                errorMessage = "A sessão local foi encerrada, mas o servidor não confirmou o logout."
            }
            try {
                googleOidcClient.signOut()
            } catch (_: Exception) {
                if (errorMessage == null) {
                    errorMessage = "A sessão foi encerrada, mas o estado do Google não pôde ser limpo."
                }
            }
            sessionStore.clear()
            mutableState.value = AuthUiState(errorMessage = errorMessage)
        }
    }

    fun clearError() {
        mutableState.value = mutableState.value.copy(errorMessage = null)
    }

    private fun publicSignInError(error: Exception): String = when (error) {
        is AuthApiException -> error.message ?: "Não foi possível concluir o login agora."
        is GoogleAuthException -> error.message ?: "Não foi possível concluir o login Google."
        else -> "Não foi possível concluir o login agora. Verifique sua conexão."
    }
}

class AuthViewModelFactory(
    private val googleOidcClient: GoogleSignInGateway,
    private val authGateway: AuthGateway,
    private val sessionStore: SessionStore,
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(AuthViewModel::class.java)) {
            return AuthViewModel(googleOidcClient, authGateway, sessionStore) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}
