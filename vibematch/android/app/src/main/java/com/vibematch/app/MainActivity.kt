package com.vibematch.app

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.vibematch.app.chat.ChatMessage
import com.vibematch.app.chat.ChatViewModel
import com.vibematch.app.chat.ChatViewModelFactory
import com.vibematch.app.chat.DevSessionStore

private val VibePurple = Color(0xFF6D4AFF)
private val VibeInk = Color(0xFF20202A)
private val VibeBackground = Color(0xFFF8F7FC)
private val VibeUserBubble = Color(0xFFE8E1FF)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            VibeMatchTheme {
                val sessionStore = remember { DevSessionStore() }
                val chatViewModel: ChatViewModel = viewModel(
                    factory = ChatViewModelFactory(
                        gateway = ChatApiClient(BuildConfig.API_BASE_URL),
                        accessTokenProvider = sessionStore::getAccessToken,
                    ),
                )
                ChatScreen(chatViewModel, sessionStore)
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
private fun ChatScreen(viewModel: ChatViewModel, sessionStore: DevSessionStore) {
    val state by viewModel.state
    var draft by remember { mutableStateOf("") }
    var hasSession by remember { mutableStateOf(!sessionStore.getAccessToken().isNullOrBlank()) }
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
            ChatHeader()
            if (BuildConfig.DEV_TOKEN_INPUT_ENABLED) {
                SessionTokenCard(sessionStore) { hasSession = true }
            } else {
                ReleaseAuthCard()
            }
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
                enabled = hasSession,
                onDraftChange = { draft = it },
                onSend = {
                    viewModel.send(draft)
                    if (!sessionStore.getAccessToken().isNullOrBlank()) draft = ""
                },
            )
        }
    }
}

@Composable
private fun ChatHeader() {
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
        Column {
            Text(
                text = "VibeMatch",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = "Seu espaço para conversar",
                style = MaterialTheme.typography.bodySmall,
                color = Color(0xFF72717D),
            )
        }
    }
}

@Composable
private fun SessionTokenCard(sessionStore: DevSessionStore, onTokenSaved: () -> Unit) {
    var token by remember { mutableStateOf(sessionStore.getAccessToken().orEmpty()) }
    var saved by remember { mutableStateOf(!token.isNullOrBlank()) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(Color.White)
            .padding(14.dp),
    ) {
        Text(
            text = "Sessão de desenvolvimento",
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = "Até o login Google ser conectado, informe um JWT de sessão do backend.",
            style = MaterialTheme.typography.bodySmall,
            color = Color(0xFF72717D),
        )
        Spacer(modifier = Modifier.height(8.dp))
        OutlinedTextField(
            value = token,
            onValueChange = {
                token = it
                saved = false
            },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            placeholder = { Text("Bearer token") },
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            shape = RoundedCornerShape(12.dp),
        )
        Spacer(modifier = Modifier.height(8.dp))
        Button(
            onClick = {
                sessionStore.setAccessToken(token)
                saved = true
                onTokenSaved()
            },
            modifier = Modifier.align(Alignment.End),
            colors = ButtonDefaults.buttonColors(containerColor = VibePurple),
        ) {
            Text(if (saved) "Token salvo" else "Salvar sessão")
        }
    }
}

@Composable
private fun ReleaseAuthCard() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(Color.White)
            .padding(14.dp),
    ) {
        Text(
            text = "Entre para conversar",
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold,
        )
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = "O login Google será conectado nesta etapa. O modo de token manual não existe no release.",
            style = MaterialTheme.typography.bodySmall,
            color = Color(0xFF72717D),
        )
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
