package com.vibematch.app

import android.app.Activity
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.vibematch.app.auth.AuthApiClient
import com.vibematch.app.consent.Consent
import com.vibematch.app.consent.ConsentApiClient
import com.vibematch.app.consent.ConsentDecision
import com.vibematch.app.consent.ConsentParticipantStatus
import com.vibematch.app.consent.ConsentStatus
import com.vibematch.app.consent.ConsentViewModel
import com.vibematch.app.consent.ConsentViewModelFactory
import com.vibematch.app.auth.AuthViewModel
import com.vibematch.app.auth.AuthViewModelFactory
import com.vibematch.app.auth.GoogleOidcClient
import com.vibematch.app.auth.PhoneVerificationApiClient
import com.vibematch.app.auth.PhoneVerificationStep
import com.vibematch.app.auth.PhoneVerificationViewModel
import com.vibematch.app.auth.PhoneVerificationViewModelFactory
import com.vibematch.app.auth.SecureSessionStore
import com.vibematch.app.chat.ChatMessage
import com.vibematch.app.matching.MatchIntentApiClient
import com.vibematch.app.matching.MatchIntentViewModel
import com.vibematch.app.matching.MatchIntentViewModelFactory
import com.vibematch.app.profile.ProfileApiClient
import com.vibematch.app.profile.ProfileGate
import com.vibematch.app.profile.ProfileViewModel
import com.vibematch.app.profile.ProfileViewModelFactory
import com.vibematch.app.chat.ChatViewModel
import com.vibematch.app.chat.ChatViewModelFactory

private val VibePurple = Color(0xFF6D4AFF)
private val VibeInk = Color(0xFF20202A)
private val VibeBackground = Color(0xFFF8F7FC)
private val VibeUserBubble = Color(0xFFE8E1FF)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            VibeMatchTheme {
                val sessionStore = remember { SecureSessionStore(applicationContext) }
                val authGateway = remember { AuthApiClient(BuildConfig.API_BASE_URL) }
                val googleOidcClient = remember {
                    GoogleOidcClient(applicationContext, BuildConfig.GOOGLE_SERVER_CLIENT_ID)
                }
                val authViewModel: AuthViewModel = viewModel(
                    factory = AuthViewModelFactory(
                        googleOidcClient = googleOidcClient,
                        authGateway = authGateway,
                        sessionStore = sessionStore,
                    ),
                )
                val chatViewModel: ChatViewModel = viewModel(
                    factory = ChatViewModelFactory(
                        gateway = ChatApiClient(BuildConfig.API_BASE_URL),
                        accessTokenProvider = sessionStore::readAccessToken,
                        onSessionExpired = authViewModel::signOut,
                    ),
                )
                val profileViewModel: ProfileViewModel = viewModel(
                    factory = ProfileViewModelFactory(
                        gateway = ProfileApiClient(BuildConfig.API_BASE_URL),
                        accessTokenProvider = sessionStore::readAccessToken,
                        onSessionExpired = authViewModel::signOut,
                    ),
                )
                val phoneViewModel: PhoneVerificationViewModel = viewModel(
                    factory = PhoneVerificationViewModelFactory(
                        gateway = PhoneVerificationApiClient(BuildConfig.API_BASE_URL),
                        accessTokenProvider = sessionStore::readAccessToken,
                        onSessionExpired = authViewModel::signOut,
                        onPhoneVerified = authViewModel::markPhoneVerified,
                    ),
                )
                val matchIntentViewModel: MatchIntentViewModel = viewModel(
                    factory = MatchIntentViewModelFactory(
                        gateway = MatchIntentApiClient(BuildConfig.API_BASE_URL),
                        accessTokenProvider = sessionStore::readAccessToken,
                        onSessionExpired = authViewModel::signOut,
                        onPhoneVerificationRequired = authViewModel::markPhoneUnverified,
                    ),
                )
                val consentViewModel: ConsentViewModel = viewModel(
                    factory = ConsentViewModelFactory(
                        gateway = ConsentApiClient(BuildConfig.API_BASE_URL),
                        accessTokenProvider = sessionStore::readAccessToken,
                        currentUserIdProvider = { authViewModel.state.value.session?.userId },
                        onSessionExpired = authViewModel::signOut,
                        onPhoneVerificationRequired = authViewModel::markPhoneUnverified,
                        onAgeAssuranceRequired = {
                            profileViewModel.reset()
                            profileViewModel.load()
                        },
                    ),
                )
                VibeMatchApp(
                    activity = this@MainActivity,
                    authViewModel = authViewModel,
                    chatViewModel = chatViewModel,
                    profileViewModel = profileViewModel,
                    phoneViewModel = phoneViewModel,
                    matchIntentViewModel = matchIntentViewModel,
                    consentViewModel = consentViewModel,
                )
            }
        }
    }
}

@Composable
private fun VibeMatchTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = MaterialTheme.colorScheme.copy(
            primary = VibePurple,
            onBackground = VibeInk,
            background = VibeBackground,
        ),
        content = content,
    )
}

@Composable
private fun VibeMatchApp(
    activity: Activity,
    authViewModel: AuthViewModel,
    chatViewModel: ChatViewModel,
    profileViewModel: ProfileViewModel,
    phoneViewModel: PhoneVerificationViewModel,
    matchIntentViewModel: MatchIntentViewModel,
    consentViewModel: ConsentViewModel,
) {
    val authState by authViewModel.state
    val session = authState.session
    val sessionId = session?.userId
    var showProfile by remember(sessionId) { mutableStateOf(false) }
    var showMatchIntents by remember(sessionId) { mutableStateOf(false) }
    var showConsent by remember(sessionId) { mutableStateOf(false) }
    var consentMatchIntentId by remember(sessionId) { mutableStateOf<String?>(null) }

    LaunchedEffect(sessionId) {
        profileViewModel.reset()
        phoneViewModel.reset()
        matchIntentViewModel.reset()
        consentViewModel.reset()
        showConsent = false
        consentMatchIntentId = null
        if (sessionId != null) profileViewModel.load()
    }

    if (session == null) {
        LoginScreen(activity, authViewModel)
    } else {
        val profileState by profileViewModel.state
        val selectedConsentMatchIntentId = consentMatchIntentId
        when {
            showProfile ||
                !profileState.hasLoaded ||
                profileState.profileIncomplete ||
                profileState.gate != ProfileGate.READY -> {
                ProfileScreen(
                    viewModel = profileViewModel,
                    onClose = { showProfile = false },
                    onLogout = {
                        profileViewModel.reset()
                        matchIntentViewModel.reset()
                        chatViewModel.clearConversation()
                        phoneViewModel.reset()
                        authViewModel.signOut()
                    },
                )
            }
            !session.phoneVerified -> {
                PhoneVerificationScreen(
                    viewModel = phoneViewModel,
                    onLogout = {
                        phoneViewModel.reset()
                        matchIntentViewModel.reset()
                        chatViewModel.clearConversation()
                        authViewModel.signOut()
                    },
                )
            }
            showConsent && selectedConsentMatchIntentId != null -> {
                ConsentScreen(
                    viewModel = consentViewModel,
                    matchIntentId = selectedConsentMatchIntentId,
                    currentUserId = session.userId,
                    onClose = {
                        showConsent = false
                        consentMatchIntentId = null
                        showMatchIntents = true
                    },
                    onLogout = {
                        consentViewModel.reset()
                        matchIntentViewModel.reset()
                        chatViewModel.clearConversation()
                        phoneViewModel.reset()
                        authViewModel.signOut()
                    },
                )
            }
            showMatchIntents -> {
                MatchIntentScreen(
                    viewModel = matchIntentViewModel,
                    onClose = { showMatchIntents = false },
                    onOpenConsent = { matchIntentId ->
                        consentMatchIntentId = matchIntentId
                        showMatchIntents = false
                        showConsent = true
                    },
                    onLogout = {
                        matchIntentViewModel.reset()
                        consentViewModel.reset()
                        chatViewModel.clearConversation()
                        phoneViewModel.reset()
                        authViewModel.signOut()
                    },
                )
            }
            else -> {
                ChatScreen(
                    viewModel = chatViewModel,
                    isSigningOut = authState.isLoading,
                    onLogout = {
                        chatViewModel.clearConversation()
                        matchIntentViewModel.reset()
                        phoneViewModel.reset()
                        authViewModel.signOut()
                    },
                    onOpenProfile = { showProfile = true },
                    onOpenMatchIntents = { showMatchIntents = true },
                )
            }
        }
    }
}

@Composable
private fun LoginScreen(activity: Activity, viewModel: AuthViewModel) {
    val state by viewModel.state
    Surface(
        modifier = Modifier.fillMaxSize(),
        color = VibeBackground,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 32.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                modifier = Modifier
                    .size(84.dp)
                    .clip(CircleShape)
                    .background(VibePurple),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = Icons.Default.AutoAwesome,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(40.dp),
                )
            }
            Spacer(modifier = Modifier.height(24.dp))
            Text(
                text = "Bem-vindo ao VibeMatch",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "Entre com sua conta Google para conversar com segurança.",
                style = MaterialTheme.typography.bodyLarge,
                color = Color(0xFF72717D),
                textAlign = TextAlign.Center,
            )
            Spacer(modifier = Modifier.height(28.dp))
            Button(
                onClick = { viewModel.signIn(activity) },
                enabled = !state.isLoading,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = VibePurple),
                shape = RoundedCornerShape(16.dp),
            ) {
                if (state.isLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        color = Color.White,
                        strokeWidth = 2.dp,
                    )
                } else {
                    Text("Entrar com Google")
                }
            }
            state.errorMessage?.let { error ->
                Spacer(modifier = Modifier.height(16.dp))
                ErrorBanner(error) { viewModel.clearError() }
            }
        }
    }
}

@Composable
private fun ChatScreen(
    viewModel: ChatViewModel,
    isSigningOut: Boolean,
    onLogout: () -> Unit,
    onOpenProfile: () -> Unit,
    onOpenMatchIntents: () -> Unit,
) {
    val state by viewModel.state
    var draft by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    LaunchedEffect(state.messages.size) {
        if (state.messages.isNotEmpty()) {
            listState.animateScrollToItem(state.messages.lastIndex)
        }
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = VibeBackground,
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            ChatHeader(
                isSigningOut = isSigningOut,
                onLogout = onLogout,
                onOpenProfile = onOpenProfile,
                onOpenMatchIntents = onOpenMatchIntents,
            )
            if (state.messages.isEmpty()) {
                EmptyChat(modifier = Modifier.weight(1f))
            } else {
                LazyColumn(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth(),
                    state = listState,
                    contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(state.messages, key = { it.id }) { message ->
                        MessageBubble(message)
                    }
                    if (state.isSending) {
                        item(key = "typing") {
                            TypingIndicator()
                        }
                    }
                }
            }
            state.errorMessage?.let { error ->
                ErrorBanner(error) { viewModel.clearError() }
            }
            Composer(
                draft = draft,
                isSending = state.isSending,
                enabled = !isSigningOut,
                onDraftChange = { draft = it },
                onSend = {
                    viewModel.send(draft)
                    draft = ""
                },
            )
        }
    }
}

@Composable
private fun ChatHeader(
    isSigningOut: Boolean,
    onLogout: () -> Unit,
    onOpenProfile: () -> Unit,
    onOpenMatchIntents: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 18.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(42.dp)
                .clip(CircleShape)
                .background(VibePurple),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Default.AutoAwesome,
                contentDescription = null,
                tint = Color.White,
                modifier = Modifier.size(22.dp),
            )
        }
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "VibeMatch",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = "Sessão segura ativa",
                style = MaterialTheme.typography.bodySmall,
                color = Color(0xFF72717D),
            )
        }
        TextButton(onClick = onOpenProfile, enabled = !isSigningOut) {
            Text("Perfil", color = VibePurple)
        }
        TextButton(onClick = onOpenMatchIntents, enabled = !isSigningOut) {
            Text("Solicitações", color = VibePurple)
        }
        TextButton(onClick = onLogout, enabled = !isSigningOut) {
            Text("Sair", color = VibePurple)
        }
    }
}

@Composable
private fun EmptyChat(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 36.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier
                .size(70.dp)
                .clip(CircleShape)
                .background(VibeUserBubble),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Default.AutoAwesome,
                contentDescription = null,
                tint = VibePurple,
                modifier = Modifier.size(34.dp),
            )
        }
        Spacer(modifier = Modifier.height(20.dp))
        Text(
            text = "Converse com o VibeMatch",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Pergunte sobre o app, interesses e como criar conexões com mais segurança.",
            style = MaterialTheme.typography.bodyMedium,
            color = Color(0xFF72717D),
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun MessageBubble(message: ChatMessage) {
    val isUser = message.role == ChatMessage.Role.USER
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
    ) {
        Text(
            text = message.text,
            modifier = Modifier
                .clip(
                    RoundedCornerShape(
                        topStart = 18.dp,
                        topEnd = 18.dp,
                        bottomStart = if (isUser) 18.dp else 4.dp,
                        bottomEnd = if (isUser) 4.dp else 18.dp,
                    )
                )
                .background(if (isUser) VibeUserBubble else Color.White)
                .padding(horizontal = 16.dp, vertical = 12.dp),
            color = VibeInk,
            style = MaterialTheme.typography.bodyLarge,
        )
    }
}

@Composable
private fun TypingIndicator() {
    Text(
        text = "VibeMatch está pensando...",
        modifier = Modifier
            .clip(RoundedCornerShape(18.dp))
            .background(Color.White)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        color = Color(0xFF72717D),
        style = MaterialTheme.typography.bodyMedium,
    )
}

@Composable
private fun ErrorBanner(message: String, onDismiss: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(Color(0xFFFFE8E8))
            .padding(start = 12.dp, end = 6.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = message,
            modifier = Modifier.weight(1f),
            color = Color(0xFF9E2D2D),
            style = MaterialTheme.typography.bodySmall,
        )
        TextButton(onClick = onDismiss) {
            Text("Fechar", color = Color(0xFF9E2D2D))
        }
    }
}

@Composable
private fun Composer(
    draft: String,
    isSending: Boolean,
    enabled: Boolean,
    onDraftChange: (String) -> Unit,
    onSend: () -> Unit,
) {
    val canSend = draft.trim().isNotEmpty() && !isSending && enabled
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        OutlinedTextField(
            value = draft,
            onValueChange = onDraftChange,
            modifier = Modifier.weight(1f),
            enabled = enabled && !isSending,
            placeholder = { Text("Escreva uma mensagem") },
            maxLines = 4,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            shape = RoundedCornerShape(18.dp),
        )
        Spacer(modifier = Modifier.width(8.dp))
        IconButton(
            onClick = onSend,
            enabled = canSend,
            modifier = Modifier
                .size(52.dp)
                .clip(CircleShape)
                .background(if (canSend) VibePurple else Color(0xFFD6D3DE)),
        ) {
            if (isSending) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    color = Color.White,
                    strokeWidth = 2.dp,
                )
            } else {
                Icon(
                    imageVector = Icons.Default.ArrowUpward,
                    contentDescription = "Enviar mensagem",
                    tint = Color.White,
                )
            }
        }
    }
}

@Composable
private fun ProfileScreen(
    viewModel: ProfileViewModel,
    onClose: () -> Unit,
    onLogout: () -> Unit,
) {
    val state by viewModel.state
    val canClose = !state.profileIncomplete && state.gate == ProfileGate.READY

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = VibeBackground,
    ) {
        Column(modifier = Modifier.fillMaxSize()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 18.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = if (state.profileIncomplete) "Vamos começar" else "Seu perfil",
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        text = if (state.profileIncomplete) {
                            "Conte um pouco sobre você para encontrar melhores conexões."
                        } else {
                            "Mantenha suas informações atualizadas."
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = Color(0xFF72717D),
                    )
                }
                if (canClose) {
                    TextButton(onClick = onClose) {
                        Text("Voltar", color = VibePurple)
                    }
                }
                TextButton(onClick = onLogout, enabled = !state.isSaving) {
                    Text("Sair", color = VibePurple)
                }
            }

            if (state.gate != ProfileGate.READY) {
                ProfileGateCard(
                    modifier = Modifier.weight(1f),
                    gate = state.gate,
                )
            } else if (state.isLoading) {
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .padding(32.dp),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    CircularProgressIndicator(color = VibePurple)
                    Spacer(modifier = Modifier.height(16.dp))
                    Text("Carregando seu perfil...", color = Color(0xFF72717D))
                }
            } else {
                ProfileForm(
                    modifier = Modifier.weight(1f),
                    state = state,
                    viewModel = viewModel,
                )
            }
        }
    }
}

@Composable
private fun ConsentScreen(
    viewModel: com.vibematch.app.consent.ConsentViewModel,
    matchIntentId: String,
    currentUserId: String,
    onClose: () -> Unit,
    onLogout: () -> Unit,
) {
    val state by viewModel.state
    val isBusy = state.isLoading || state.isDeciding

    LaunchedEffect(matchIntentId) {
        viewModel.reset()
        viewModel.create(matchIntentId)
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = VibeBackground,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(onClick = onClose, enabled = !isBusy) {
                    Text("Voltar", color = VibePurple)
                }
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Consentimento",
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                    )
                    Text(
                        text = "Decisão mútua e controlada",
                        modifier = Modifier.fillMaxWidth(),
                        style = MaterialTheme.typography.bodySmall,
                        color = Color(0xFF72717D),
                        textAlign = TextAlign.Center,
                    )
                }
                TextButton(onClick = onLogout, enabled = !isBusy) {
                    Text("Sair", color = VibePurple)
                }
            }

            state.errorMessage?.let { error ->
                ErrorBanner(error) { viewModel.clearMessages() }
            }
            state.infoMessage?.let { message ->
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color(0xFF2F7D4A),
                )
            }

            when {
                state.isLoading -> {
                    Box(
                        modifier = Modifier.fillMaxWidth().weight(1f),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator(color = VibePurple)
                    }
                }
                state.ageBlocked -> {
                    ConsentBlockedCard(modifier = Modifier.weight(1f))
                }
                state.consent == null -> {
                    Column(
                        modifier = Modifier.fillMaxWidth().weight(1f),
                        verticalArrangement = Arrangement.Center,
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(
                            text = "Não foi possível abrir o consentimento.",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            textAlign = TextAlign.Center,
                        )
                    }
                }
                else -> {
                    val consent = state.consent
                    if (consent != null) {
                        ConsentCard(
                            modifier = Modifier.weight(1f),
                            consent = consent,
                            currentUserId = currentUserId,
                            isDeciding = state.isDeciding,
                            onDecision = viewModel::decide,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ConsentCard(
    modifier: Modifier = Modifier,
    consent: Consent,
    currentUserId: String,
    isDeciding: Boolean,
    onDecision: (ConsentDecision) -> Unit,
) {
    val ownStatus = when (currentUserId) {
        consent.userAId -> consent.userAStatus
        consent.userBId -> consent.userBStatus
        else -> ConsentParticipantStatus.UNKNOWN
    }
    val otherStatus = when (currentUserId) {
        consent.userAId -> consent.userBStatus
        consent.userBId -> consent.userAStatus
        else -> ConsentParticipantStatus.UNKNOWN
    }
    val canDecide = consent.status == ConsentStatus.PENDING &&
        ownStatus == ConsentParticipantStatus.PENDING

    Surface(
        modifier = modifier.fillMaxWidth(),
        color = Color.White,
        shape = RoundedCornerShape(20.dp),
        tonalElevation = 2.dp,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = when (consent.status) {
                    ConsentStatus.ACCEPTED_BOTH -> "Consentimento mútuo registrado"
                    ConsentStatus.DECLINED -> "Consentimento recusado"
                    ConsentStatus.EXPIRED -> "Consentimento expirado"
                    ConsentStatus.CANCELLED -> "Consentimento cancelado"
                    ConsentStatus.PENDING -> "Consentimento pendente"
                    ConsentStatus.UNKNOWN -> "Consentimento indisponível"
                },
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = "Seu estado: ${participantStatusLabel(ownStatus)}",
                style = MaterialTheme.typography.bodyMedium,
                color = VibeInk,
            )
            Text(
                text = "Estado da outra pessoa: ${participantStatusLabel(otherStatus)}",
                style = MaterialTheme.typography.bodyMedium,
                color = Color(0xFF5E5D68),
            )
            Text(
                text = when (consent.status) {
                    ConsentStatus.ACCEPTED_BOTH ->
                        "As duas pessoas aceitaram. Isso não cria uma sessão de vídeo automaticamente; o backend ainda precisa autorizar e revalidar essa etapa."
                    ConsentStatus.PENDING ->
                        "Escolha sua decisão. O resultado será registrado pelo backend com a sessão autenticada e um request_id único."
                    ConsentStatus.DECLINED -> "Nenhuma sessão de vídeo pode ser criada a partir deste consentimento."
                    else -> "Este consentimento não está disponível para novas decisões."
                },
                style = MaterialTheme.typography.bodyMedium,
                color = Color(0xFF72717D),
            )
            if (canDecide) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    TextButton(
                        onClick = { onDecision(ConsentDecision.DECLINED) },
                        enabled = !isDeciding,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text("Recusar", color = Color(0xFF8A3D4A))
                    }
                    Button(
                        onClick = { onDecision(ConsentDecision.ACCEPTED) },
                        enabled = !isDeciding,
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(containerColor = VibePurple),
                        shape = RoundedCornerShape(14.dp),
                    ) {
                        if (isDeciding) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                color = Color.White,
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Text("Aceitar")
                        }
                    }
                }
            }
        }
    }
}

private fun participantStatusLabel(status: ConsentParticipantStatus): String = when (status) {
    ConsentParticipantStatus.PENDING -> "pendente"
    ConsentParticipantStatus.ACCEPTED -> "aceito"
    ConsentParticipantStatus.DECLINED -> "recusado"
    ConsentParticipantStatus.UNKNOWN -> "indisponível"
}

@Composable
private fun ConsentBlockedCard(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "Consentimento indisponível",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )
        Text(
            text = "O backend não autorizou esta operação. Nenhuma ação local pode liberar consentimento ou vídeo.",
            style = MaterialTheme.typography.bodyMedium,
            color = Color(0xFF72717D),
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}

@Composable
private fun MatchIntentScreen(
    viewModel: MatchIntentViewModel,
    onClose: () -> Unit,
    onOpenConsent: (String) -> Unit,
    onLogout: () -> Unit,
) {
    val state by viewModel.state

    LaunchedEffect(Unit) {
        viewModel.load(refresh = true)
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = VibeBackground,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(onClick = onClose) {
                    Text("Voltar", color = VibePurple)
                }
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Solicitações",
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                    )
                    Text(
                        text = "Conexões recebidas",
                        modifier = Modifier.fillMaxWidth(),
                        style = MaterialTheme.typography.bodySmall,
                        color = Color(0xFF72717D),
                        textAlign = TextAlign.Center,
                    )
                }
                TextButton(onClick = onLogout, enabled = !state.isLoading && state.respondingIntentId == null) {
                    Text("Sair", color = VibePurple)
                }
            }

            state.errorMessage?.let { error ->
                ErrorBanner(error) { viewModel.clearMessages() }
            }
            state.infoMessage?.let { message ->
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color(0xFF2F7D4A),
                )
            }

            when {
                state.isLoading -> {
                    Box(
                        modifier = Modifier.fillMaxWidth().weight(1f),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator(color = VibePurple)
                    }
                }
                state.ageBlocked -> {
                    MatchIntentBlockedCard(modifier = Modifier.weight(1f))
                }
                state.incoming.isEmpty() -> {
                    Column(
                        modifier = Modifier.fillMaxWidth().weight(1f),
                        verticalArrangement = Arrangement.Center,
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(
                            text = "Nenhuma solicitação no momento.",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            textAlign = TextAlign.Center,
                        )
                        Text(
                            text = "Novas conexões aparecerão aqui quando o backend as disponibilizar.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = Color(0xFF72717D),
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(top = 8.dp),
                        )
                    }
                }
                else -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxWidth().weight(1f),
                        contentPadding = PaddingValues(bottom = 20.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        items(state.incoming, key = { it.id }) { intent ->
                            MatchIntentCard(
                                intent = intent,
                                isResponding = state.respondingIntentId == intent.id,
                                onDecision = { decision -> viewModel.respond(intent.id, decision) },
                                onOpenConsent = { onOpenConsent(intent.id) },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MatchIntentCard(
    intent: com.vibematch.app.matching.MatchIntent,
    isResponding: Boolean,
    onDecision: (com.vibematch.app.matching.MatchIntentDecision) -> Unit,
    onOpenConsent: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = Color.White,
        shape = RoundedCornerShape(20.dp),
        tonalElevation = 2.dp,
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                text = "Nova intenção de conexão",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = "Alguém quer iniciar uma conexão com você. Aceitar a intenção não cria uma sessão de vídeo: qualquer recurso de vídeo dependerá de consentimento mútuo e revalidação do backend.",
                style = MaterialTheme.typography.bodyMedium,
                color = Color(0xFF5E5D68),
            )
            if (intent.status == com.vibematch.app.matching.MatchIntentStatus.SENT) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    TextButton(
                        onClick = { onDecision(com.vibematch.app.matching.MatchIntentDecision.DECLINED) },
                        enabled = !isResponding,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text("Recusar", color = Color(0xFF8A3D4A))
                    }
                    Button(
                        onClick = { onDecision(com.vibematch.app.matching.MatchIntentDecision.ACCEPTED) },
                        enabled = !isResponding,
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.buttonColors(containerColor = VibePurple),
                        shape = RoundedCornerShape(14.dp),
                    ) {
                        if (isResponding) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                color = Color.White,
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Text("Aceitar")
                        }
                    }
                }
            } else if (intent.status == com.vibematch.app.matching.MatchIntentStatus.ACCEPTED) {
                Text(
                    text = "A intenção foi aceita. O próximo passo requer consentimento mútuo no backend.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xFF72717D),
                )
                TextButton(
                    onClick = onOpenConsent,
                    enabled = !isResponding,
                    modifier = Modifier.align(Alignment.End),
                ) {
                    Text("Abrir consentimento", color = VibePurple)
                }
            } else {
                Text(
                    text = "Esta solicitação não pode mais ser decidida.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xFF72717D),
                )
            }
        }
    }
}

@Composable
private fun MatchIntentBlockedCard(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "Matchmaking indisponível",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )
        Text(
            text = "O backend ainda não autorizou o uso de solicitações. Nenhuma ação local pode liberar este recurso.",
            style = MaterialTheme.typography.bodyMedium,
            color = Color(0xFF72717D),
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}

@Composable
private fun PhoneVerificationScreen(
    viewModel: PhoneVerificationViewModel,
    onLogout: () -> Unit,
) {
    val state by viewModel.state
    val isBusy = state.isLoading || state.isConfirming

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = VibeBackground,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 24.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Verifique seu telefone",
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        text = "Uma etapa de segurança antes de continuar.",
                        style = MaterialTheme.typography.bodySmall,
                        color = Color(0xFF72717D),
                    )
                }
                TextButton(onClick = onLogout, enabled = !isBusy) {
                    Text("Sair", color = VibePurple)
                }
            }

            Spacer(modifier = Modifier.weight(1f))
            if (state.step == PhoneVerificationStep.PHONE_INPUT) {
                Text(
                    text = "Digite seu telefone no formato internacional. Enviaremos um código para confirmar que ele pertence a você.",
                    style = MaterialTheme.typography.bodyLarge,
                    color = VibeInk,
                )
                OutlinedTextField(
                    value = state.phoneE164,
                    onValueChange = viewModel::updatePhone,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Telefone") },
                    placeholder = { Text("+5511999999999") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    enabled = !isBusy,
                    shape = RoundedCornerShape(16.dp),
                )
                state.errorMessage?.let { error ->
                    ErrorBanner(error) { viewModel.clearError() }
                }
                Button(
                    onClick = viewModel::start,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !isBusy,
                    colors = ButtonDefaults.buttonColors(containerColor = VibePurple),
                    shape = RoundedCornerShape(16.dp),
                ) {
                    if (state.isLoading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            color = Color.White,
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Text("Enviar código")
                    }
                }
            } else {
                Text(
                    text = "Informe o código recebido por SMS para confirmar ${state.phoneE164}.",
                    style = MaterialTheme.typography.bodyLarge,
                    color = VibeInk,
                )
                OutlinedTextField(
                    value = state.code,
                    onValueChange = viewModel::updateCode,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Código de confirmação") },
                    placeholder = { Text("Digite o código") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    enabled = !isBusy,
                    shape = RoundedCornerShape(16.dp),
                )
                state.errorMessage?.let { error ->
                    ErrorBanner(error) { viewModel.clearError() }
                }
                Button(
                    onClick = viewModel::confirm,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !isBusy,
                    colors = ButtonDefaults.buttonColors(containerColor = VibePurple),
                    shape = RoundedCornerShape(16.dp),
                ) {
                    if (state.isConfirming) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            color = Color.White,
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Text("Confirmar telefone")
                    }
                }
                TextButton(
                    onClick = viewModel::requestNewCode,
                    enabled = !isBusy,
                    modifier = Modifier.align(Alignment.CenterHorizontally),
                ) {
                    Text("Usar outro número", color = VibePurple)
                }
            }
            Spacer(modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun ProfileGateCard(modifier: Modifier = Modifier, gate: ProfileGate) {
    val title: String
    val description: String
    when (gate) {
        ProfileGate.AGE_NOT_STARTED -> {
            title = "Verificação de idade necessária"
            description = "Conclua a verificação de idade para liberar recursos restritos."
        }
        ProfileGate.AGE_PENDING -> {
            title = "Verificação de idade pendente"
            description = "Aguarde a confirmação do backend antes de continuar."
        }
        ProfileGate.AGE_REJECTED -> {
            title = "Não foi possível confirmar sua idade"
            description = "O acesso permanece bloqueado até uma nova orientação do suporte."
        }
        ProfileGate.AGE_UNAVAILABLE -> {
            title = "Verificação de idade indisponível"
            description = "O backend não confirmou sua elegibilidade. Tente novamente mais tarde."
        }
        ProfileGate.BLOCKED -> {
            title = "Conta bloqueada"
            description = "O backend bloqueou esta conta. Entre em contato com o suporte."
        }
        ProfileGate.SUSPENDED -> {
            title = "Conta suspensa"
            description = "O acesso está suspenso pelo backend e não pode ser liberado no app."
        }
        ProfileGate.READY -> return
    }
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(28.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )
        Text(
            text = description,
            style = MaterialTheme.typography.bodyLarge,
            color = Color(0xFF72717D),
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun ProfileForm(
    modifier: Modifier = Modifier,
    state: com.vibematch.app.profile.ProfileUiState,
    viewModel: ProfileViewModel,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Spacer(modifier = Modifier.height(2.dp))
        OutlinedTextField(
            value = state.draft.displayName,
            onValueChange = viewModel::updateDisplayName,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Nome de exibição") },
            placeholder = { Text("Como você quer ser chamado?") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
            enabled = !state.isSaving,
            shape = RoundedCornerShape(16.dp),
        )
        OutlinedTextField(
            value = state.draft.language,
            onValueChange = viewModel::updateLanguage,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Idioma") },
            placeholder = { Text("Ex.: pt-BR") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
            enabled = !state.isSaving,
            shape = RoundedCornerShape(16.dp),
        )
        OutlinedTextField(
            value = state.draft.region,
            onValueChange = viewModel::updateRegion,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Região") },
            placeholder = { Text("Ex.: BR-SP") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
            enabled = !state.isSaving,
            shape = RoundedCornerShape(16.dp),
        )
        OutlinedTextField(
            value = state.draft.avatarUrl,
            onValueChange = viewModel::updateAvatarUrl,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Avatar (opcional)") },
            placeholder = { Text("URL HTTPS") },
            singleLine = true,
            enabled = !state.isSaving,
            shape = RoundedCornerShape(16.dp),
        )

        Text(
            text = "Seus interesses",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = "Escolha até 10 interesses para personalizar suas conexões.",
            style = MaterialTheme.typography.bodySmall,
            color = Color(0xFF72717D),
        )
        if (state.availableInterests.isEmpty()) {
            Text(
                text = "Nenhum interesse disponível no momento. Você pode salvar o perfil e continuar.",
                style = MaterialTheme.typography.bodyMedium,
                color = Color(0xFF72717D),
            )
        } else {
            state.availableInterests.chunked(2).forEach { rowInterests ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    rowInterests.forEach { interest ->
                        FilterChip(
                            selected = interest.id in state.draft.interestIds,
                            onClick = { viewModel.toggleInterest(interest.id) },
                            label = { Text(interest.label) },
                            enabled = !state.isSaving,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    if (rowInterests.size == 1) Spacer(modifier = Modifier.weight(1f))
                }
            }
        }

        state.errorMessage?.let { error ->
            ErrorBanner(error) { viewModel.clearError() }
        }
        if (state.saved) {
            Text(
                text = "Perfil salvo com sucesso.",
                color = Color(0xFF2F7D4A),
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        Button(
            onClick = viewModel::save,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 4.dp),
            enabled = !state.isSaving,
            colors = ButtonDefaults.buttonColors(containerColor = VibePurple),
            shape = RoundedCornerShape(16.dp),
        ) {
            if (state.isSaving) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    color = Color.White,
                    strokeWidth = 2.dp,
                )
            } else {
                Text(if (state.profileIncomplete) "Continuar" else "Salvar alterações")
            }
        }
        Spacer(modifier = Modifier.height(20.dp))
    }
}
