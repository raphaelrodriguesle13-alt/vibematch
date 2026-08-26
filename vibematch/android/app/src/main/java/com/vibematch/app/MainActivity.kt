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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.vibematch.app.auth.AuthApiClient
import com.vibematch.app.auth.AuthViewModel
import com.vibematch.app.auth.AuthViewModelFactory
import com.vibematch.app.auth.GoogleOidcClient
import com.vibematch.app.auth.SecureSessionStore
import com.vibematch.app.chat.ChatMessage
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
                VibeMatchApp(
                    activity = this@MainActivity,
                    authViewModel = authViewModel,
                    chatViewModel = chatViewModel,
                    profileViewModel = profileViewModel,
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
) {
    val authState by authViewModel.state
    val sessionId = authState.session?.userId
    var showProfile by remember(sessionId) { mutableStateOf(false) }

    LaunchedEffect(sessionId) {
        profileViewModel.reset()
        if (sessionId != null) profileViewModel.load()
    }

    if (authState.session == null) {
        LoginScreen(activity, authViewModel)
    } else {
        val profileState by profileViewModel.state
        if (
            !profileState.hasLoaded ||
                profileState.profileIncomplete ||
                profileState.gate != ProfileGate.READY ||
                showProfile
        ) {
            ProfileScreen(
                viewModel = profileViewModel,
                onClose = { showProfile = false },
                onLogout = {
                    profileViewModel.reset()
                    chatViewModel.clearConversation()
                    authViewModel.signOut()
                },
            )
        } else {
            ChatScreen(
                viewModel = chatViewModel,
                isSigningOut = authState.isLoading,
                onLogout = {
                    chatViewModel.clearConversation()
                    authViewModel.signOut()
                },
                onOpenProfile = { showProfile = true },
            )
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
