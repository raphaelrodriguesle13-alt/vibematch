package com.vibematch.app.auth

import android.app.Activity
import android.content.Context
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException

class GoogleAuthException(message: String) : Exception(message)

interface GoogleSignInGateway {
    suspend fun signIn(activity: Activity): String
    suspend fun signOut()
}

class GoogleOidcClient(
    context: Context,
    private val serverClientId: String,
    private val credentialManager: CredentialManager = CredentialManager.create(context),
) : GoogleSignInGateway {
    override suspend fun signIn(activity: Activity): String {
        if (serverClientId.isBlank()) {
            throw GoogleAuthException("Google server client ID is not configured")
        }

        val authorizedOption = GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(true)
            .setServerClientId(serverClientId)
            .setAutoSelectEnabled(true)
            .build()
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(authorizedOption)
            .build()

        val result = try {
            credentialManager.getCredential(context = activity, request = request)
        } catch (_: NoCredentialException) {
            requestAllAccounts(activity)
        } catch (_: GetCredentialException) {
            throw GoogleAuthException("Google sign-in was cancelled or unavailable")
        }

        return extractIdToken(result)
    }

    override suspend fun signOut() {
        try {
            credentialManager.clearCredentialState(ClearCredentialStateRequest())
        } catch (_: ClearCredentialException) {
            throw GoogleAuthException("Could not clear Google credential state")
        }
    }

    private suspend fun requestAllAccounts(activity: Activity) = run {
        val option = GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(false)
            .setServerClientId(serverClientId)
            .setAutoSelectEnabled(false)
            .build()
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(option)
            .build()
        try {
            credentialManager.getCredential(context = activity, request = request)
        } catch (_: GetCredentialException) {
            throw GoogleAuthException("No Google account is available for sign-in")
        }
    }

    private fun extractIdToken(result: androidx.credentials.GetCredentialResponse): String {
        val credential = result.credential
        if (
            credential is CustomCredential &&
            credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
        ) {
            return try {
                GoogleIdTokenCredential.createFrom(credential.data).idToken
            } catch (_: GoogleIdTokenParsingException) {
                throw GoogleAuthException("Google returned an invalid ID token")
            }
        }
        throw GoogleAuthException("Google did not return an ID token")
    }

}
