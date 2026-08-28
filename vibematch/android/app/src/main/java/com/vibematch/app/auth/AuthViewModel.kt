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
    private var sessionGeneration = 0L
    private var signOutInFlight = false
    val state: State<AuthUiState> = mutableState

    fun signIn(activity: Activity) {
        if (mutableState.value.isLoading) return
        val generation = ++sessionGeneration
        signOutInFlight = false
        mutableState.value = mutableState.value.copy(isLoading = true, errorMessage = null)

        viewModelScope.launch {
            try {
                val googleIdToken = googleOidcClient.signIn(activity)
                val sessionBundle = authGateway.loginWithGoogle(googleIdToken)
                if (generation != sessionGeneration) return@launch
                sessionStore.saveWithRefresh(
                    sessionBundle.session,
                    sessionBundle.refreshCredentials,
                )
                mutableState.value = AuthUiState(session = sessionBundle.session)
            } catch (error: Exception) {
                if (generation != sessionGeneration) return@launch
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

    fun completeAccountDeletion(onLocalRevocation: () -> Unit = {}) {
        val generation = ++sessionGeneration
        signOutInFlight = true

        // The backend has already accepted deletion and revoked server-side authority.
        // Clear local access/refresh credentials before any best-effort cleanup so a
        // concurrent refresh cannot restore the deleted account.
        sessionStore.clear()
        mutableState.value = AuthUiState()
        runCatching(onLocalRevocation)

        viewModelScope.launch {
            var errorMessage: String? = null
            try {
                googleOidcClient.signOut()
            } catch (_: Exception) {
                errorMessage = "A conta foi removida deste dispositivo, mas o estado do Google não pôde ser limpo."
            }
            if (generation == sessionGeneration) {
                signOutInFlight = false
                mutableState.value = AuthUiState(errorMessage = errorMessage)
            }
        }
    }

    fun signOut(snapshotOverride: AuthLogoutSnapshot? = null) {
        if (signOutInFlight) return
        val generation = ++sessionGeneration
        signOutInFlight = true
        val snapshot = snapshotOverride ?: sessionStore.readLogoutSnapshot()

        // Fail closed before any network call. The captured credentials remain only in this coroutine.
        sessionStore.clear()
        mutableState.value = AuthUiState()

        viewModelScope.launch {
            var errorMessage: String? = null
            try {
                if (snapshot.refreshCredentials != null) {
                    authGateway.logoutWithRefresh(snapshot.refreshCredentials.refreshToken)
                } else {
                    snapshot.session?.let { authGateway.logout(it.sessionJwt) }
                }
            } catch (_: Exception) {
                errorMessage = if (snapshot.refreshCredentials != null) {
                    "A sessão local foi encerrada, mas o servidor não confirmou a revogação."
                } else {
                    "A sessão local foi encerrada, mas o servidor não confirmou o logout."
                }
            }
            if (generation == sessionGeneration) {
                try {
                    googleOidcClient.signOut()
                } catch (_: Exception) {
                    if (errorMessage == null) {
                        errorMessage = "A sessão foi encerrada, mas o estado do Google não pôde ser limpo."
                    }
                }
            }
            if (generation == sessionGeneration) {
                signOutInFlight = false
                mutableState.value = AuthUiState(errorMessage = errorMessage)
            }
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
