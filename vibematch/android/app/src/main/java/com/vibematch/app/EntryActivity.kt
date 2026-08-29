package com.vibematch.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import com.facebook.CallbackManager
import com.facebook.FacebookCallback
import com.facebook.FacebookException
import com.facebook.FacebookSdk
import com.facebook.login.LoginManager
import com.facebook.login.LoginResult
import com.vibematch.app.auth.AuthApiClient
import com.vibematch.app.auth.AuthSessionBundle
import com.vibematch.app.auth.GoogleOidcClient
import com.vibematch.app.auth.ProviderLoginApiClient
import com.vibematch.app.auth.SecureSessionStore
import com.vibematch.app.auth.isGoogleServerClientIdConfigured
import kotlinx.coroutines.launch

private val EntryPurple = Color(0xFF6D4AFF)
private val EntryInk = Color(0xFF20202A)
private val EntryBackground = Color(0xFFF8F7FC)

class EntryActivity : ComponentActivity() {
    private lateinit var sessionStore: SecureSessionStore
    private lateinit var googleClient: GoogleOidcClient
    private lateinit var googleApi: AuthApiClient
    private lateinit var providerApi: ProviderLoginApiClient
    private var callbackManager: CallbackManager? = null
    private var facebookLoginManager: LoginManager? = null

    private var uiState by mutableStateOf(EntryUiState())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        sessionStore = SecureSessionStore(applicationContext)
        if (sessionStore.read() != null) {
            openMain()
            return
        }

        googleClient = GoogleOidcClient(applicationContext, BuildConfig.GOOGLE_SERVER_CLIENT_ID)
        googleApi = AuthApiClient(BuildConfig.API_BASE_URL)
        providerApi = ProviderLoginApiClient(BuildConfig.API_BASE_URL)
        configureFacebookIfAvailable()

        setContent {
            MaterialTheme(
                colorScheme = MaterialTheme.colorScheme.copy(
                    primary = EntryPurple,
                    onBackground = EntryInk,
                    background = EntryBackground,
                ),
            ) {
                EntryScreen(
                    state = uiState,
                    googleAvailable = isGoogleServerClientIdConfigured(BuildConfig.GOOGLE_SERVER_CLIENT_ID),
                    facebookAvailable = isFacebookConfigured(),
                    onGoogle = ::loginGoogle,
                    onFacebook = ::loginFacebook,
                    onPhoneStart = ::startPhone,
                    onPhoneConfirm = ::confirmPhone,
                    onPhoneCancel = {
                        uiState = uiState.copy(
                            phoneChallengeId = null,
                            phoneCode = "",
                            errorMessage = null,
                        )
                    },
                    onPhoneChanged = { uiState = uiState.copy(phoneNumber = it, errorMessage = null) },
                    onCodeChanged = { uiState = uiState.copy(phoneCode = it, errorMessage = null) },
                    onDismissError = { uiState = uiState.copy(errorMessage = null) },
                )
            }
        }
    }

    @Deprecated("Facebook SDK callback bridge")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        callbackManager?.onActivityResult(requestCode, resultCode, data)
    }

    private fun loginGoogle() {
        if (uiState.loading || !isGoogleServerClientIdConfigured(BuildConfig.GOOGLE_SERVER_CLIENT_ID)) return
        uiState = uiState.copy(loading = true, errorMessage = null)
        lifecycleScope.launch {
            try {
                val idToken = googleClient.signIn(this@EntryActivity)
                finishLogin(googleApi.loginWithGoogle(idToken))
            } catch (_: Exception) {
                uiState = uiState.copy(
                    loading = false,
                    errorMessage = "Não foi possível entrar com Google agora. Tente novamente ou use outra opção.",
                )
            }
        }
    }

    private fun loginFacebook() {
        if (uiState.loading || !isFacebookConfigured()) return
        val loginManager = facebookLoginManager ?: return
        uiState = uiState.copy(loading = true, errorMessage = null)
        loginManager.logInWithReadPermissions(this, listOf("public_profile"))
    }

    private fun startPhone() {
        if (uiState.loading) return
        val normalized = normalizeBrazilPhone(uiState.phoneNumber)
        if (normalized == null) {
            uiState = uiState.copy(
                errorMessage = "Digite o número com DDI, por exemplo +55 11 99999-9999.",
            )
            return
        }
        uiState = uiState.copy(loading = true, errorMessage = null)
        lifecycleScope.launch {
            try {
                val challenge = providerApi.startPhoneLogin(normalized)
                uiState = uiState.copy(
                    loading = false,
                    phoneNumber = normalized,
                    phoneChallengeId = challenge.verificationId,
                    phoneCode = "",
                )
            } catch (error: Exception) {
                uiState = uiState.copy(
                    loading = false,
                    errorMessage = error.message ?: "Não foi possível enviar o código agora.",
                )
            }
        }
    }

    private fun confirmPhone() {
        val challengeId = uiState.phoneChallengeId ?: return
        val code = uiState.phoneCode.trim()
        if (uiState.loading || code.length !in 4..8 || code.any { !it.isDigit() }) {
            uiState = uiState.copy(errorMessage = "Digite o código recebido por SMS.")
            return
        }
        uiState = uiState.copy(loading = true, errorMessage = null)
        lifecycleScope.launch {
            try {
                finishLogin(providerApi.confirmPhoneLogin(challengeId, code))
            } catch (error: Exception) {
                uiState = uiState.copy(
                    loading = false,
                    errorMessage = error.message ?: "Não foi possível confirmar o código agora.",
                )
            }
        }
    }

    private fun configureFacebookIfAvailable() {
        if (!isFacebookConfigured()) return
        FacebookSdk.setApplicationId(BuildConfig.FACEBOOK_APP_ID)
        FacebookSdk.setClientToken(BuildConfig.FACEBOOK_CLIENT_TOKEN)
        FacebookSdk.sdkInitialize(applicationContext)

        val manager = LoginManager.getInstance()
        val callbacks = CallbackManager.Factory.create()
        facebookLoginManager = manager
        callbackManager = callbacks

        manager.registerCallback(
            callbacks,
            object : FacebookCallback<LoginResult> {
                override fun onSuccess(result: LoginResult) {
                    val token = result.accessToken.token
                    lifecycleScope.launch {
                        try {
                            finishLogin(providerApi.loginWithFacebook(token))
                        } catch (error: Exception) {
                            uiState = uiState.copy(
                                loading = false,
                                errorMessage = error.message
                                    ?: "Não foi possível entrar com Facebook agora.",
                            )
                        }
                    }
                }

                override fun onCancel() {
                    uiState = uiState.copy(loading = false)
                }

                override fun onError(error: FacebookException) {
                    uiState = uiState.copy(
                        loading = false,
                        errorMessage = "Não foi possível entrar com Facebook agora. Tente novamente.",
                    )
                }
            },
        )
    }

    private fun finishLogin(bundle: AuthSessionBundle) {
        sessionStore.saveWithRefresh(bundle.session, bundle.refreshCredentials)
        uiState = EntryUiState()
        openMain()
    }

    private fun openMain() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }

    private fun isFacebookConfigured(): Boolean =
        BuildConfig.FACEBOOK_APP_ID.isNotBlank() &&
            BuildConfig.FACEBOOK_CLIENT_TOKEN.isNotBlank() &&
            !BuildConfig.FACEBOOK_APP_ID.startsWith("MISSING_") &&
            !BuildConfig.FACEBOOK_CLIENT_TOKEN.startsWith("MISSING_")
}

private data class EntryUiState(
    val loading: Boolean = false,
    val phoneNumber: String = "",
    val phoneChallengeId: String? = null,
    val phoneCode: String = "",
    val errorMessage: String? = null,
)

@Composable
private fun EntryScreen(
    state: EntryUiState,
    googleAvailable: Boolean,
    facebookAvailable: Boolean,
    onGoogle: () -> Unit,
    onFacebook: () -> Unit,
    onPhoneStart: () -> Unit,
    onPhoneConfirm: () -> Unit,
    onPhoneCancel: () -> Unit,
    onPhoneChanged: (String) -> Unit,
    onCodeChanged: (String) -> Unit,
    onDismissError: () -> Unit,
) {
    Surface(modifier = Modifier.fillMaxSize(), color = EntryBackground) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(EntryBackground)
                .padding(horizontal = 28.dp, vertical = 36.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Surface(
                modifier = Modifier.height(112.dp),
                shape = CircleShape,
                color = EntryPurple,
            ) {
                Icon(
                    imageVector = Icons.Default.AutoAwesome,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.padding(30.dp),
                )
            }
            Spacer(modifier = Modifier.height(26.dp))
            Text(
                text = "Bem-vindo ao VibeMatch",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            )
            Spacer(modifier = Modifier.height(10.dp))
            Text(
                text = "Escolha como você quer entrar. Você poderá verificar seu celular para manter a comunidade mais segura.",
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center,
                color = EntryInk.copy(alpha = 0.68f),
            )
            Spacer(modifier = Modifier.height(28.dp))

            if (state.phoneChallengeId == null) {
                Button(
                    onClick = onGoogle,
                    enabled = !state.loading && googleAvailable,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(18.dp),
                ) {
                    LoginButtonContent(state.loading, "Continuar com Google")
                }
                Spacer(modifier = Modifier.height(12.dp))
                Button(
                    onClick = onFacebook,
                    enabled = !state.loading && facebookAvailable,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(18.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1877F2)),
                ) {
                    LoginButtonContent(state.loading, "Continuar com Facebook")
                }
                Spacer(modifier = Modifier.height(18.dp))
                OutlinedTextField(
                    value = state.phoneNumber,
                    onValueChange = onPhoneChanged,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Número de celular") },
                    placeholder = { Text("+55 11 99999-9999") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    singleLine = true,
                    enabled = !state.loading,
                )
                Spacer(modifier = Modifier.height(10.dp))
                OutlinedButton(
                    onClick = onPhoneStart,
                    enabled = !state.loading,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(18.dp),
                ) {
                    Text("Continuar com celular")
                }

                if (!googleAvailable || !facebookAvailable) {
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(
                        text = "Algumas opções podem ficar temporariamente indisponíveis enquanto a configuração do provedor é concluída.",
                        style = MaterialTheme.typography.bodySmall,
                        textAlign = TextAlign.Center,
                        color = EntryInk.copy(alpha = 0.58f),
                    )
                }
            } else {
                Text(
                    text = "Enviamos um código para ${state.phoneNumber}",
                    style = MaterialTheme.typography.titleMedium,
                    textAlign = TextAlign.Center,
                )
                Spacer(modifier = Modifier.height(14.dp))
                OutlinedTextField(
                    value = state.phoneCode,
                    onValueChange = onCodeChanged,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Código SMS") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    singleLine = true,
                    enabled = !state.loading,
                )
                Spacer(modifier = Modifier.height(12.dp))
                Button(
                    onClick = onPhoneConfirm,
                    enabled = !state.loading,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(18.dp),
                ) {
                    LoginButtonContent(state.loading, "Confirmar código")
                }
                TextButton(onClick = onPhoneCancel, enabled = !state.loading) {
                    Text("Usar outro número")
                }
            }

            state.errorMessage?.let { message ->
                Spacer(modifier = Modifier.height(18.dp))
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = MaterialTheme.colorScheme.errorContainer,
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = message,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                        TextButton(onClick = onDismissError, modifier = Modifier.align(Alignment.End)) {
                            Text("Fechar")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun LoginButtonContent(loading: Boolean, label: String) {
    if (loading) {
        CircularProgressIndicator(
            modifier = Modifier.height(20.dp),
            color = Color.White,
            strokeWidth = 2.dp,
        )
    } else {
        Text(label)
    }
}

private fun normalizeBrazilPhone(value: String): String? {
    val trimmed = value.trim()
    if (trimmed.startsWith("+")) {
        val digits = trimmed.drop(1).filter(Char::isDigit)
        return if (digits.length in 8..15 && digits.firstOrNull() != '0') "+$digits" else null
    }
    val digits = trimmed.filter(Char::isDigit)
    if (digits.length !in 10..11) return null
    return "+55$digits"
}
