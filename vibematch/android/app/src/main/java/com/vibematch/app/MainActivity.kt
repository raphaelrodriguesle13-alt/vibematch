package com.vibematch.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import com.vibematch.app.account.AccountDeletionAction
import com.vibematch.app.account.AccountDeletionApiClient
import com.vibematch.app.account.AccountDeletionViewModel
import com.vibematch.app.account.AccountDeletionViewModelFactory
import com.vibematch.app.auth.AuthApiClient
import com.vibematch.app.auth.AuthLogoutSnapshot
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
import com.vibematch.app.auth.isGoogleServerClientIdConfigured
import com.vibematch.app.auth.PhoneVerificationApiClient
import com.vibematch.app.auth.PhoneVerificationStep
import com.vibematch.app.auth.PhoneVerificationViewModel
import com.vibematch.app.auth.PhoneVerificationViewModelFactory
import com.vibematch.app.auth.SecureSessionStore
import com.vibematch.app.auth.SessionRefreshCoordinator
import com.vibematch.app.auth.buildSessionAwareHttpClient
import com.vibematch.app.billing.BillingApiClient
import com.vibematch.app.billing.BillingUiStatus
import com.vibematch.app.billing.BillingViewModel
import com.vibematch.app.billing.BillingViewModelFactory
import com.vibematch.app.billing.PlayBillingClientGateway
import com.vibematch.app.chat.ChatMessage
import com.vibematch.app.matching.MatchIntentApiClient
import com.vibematch.app.matching.MatchIntentViewModel
import com.vibematch.app.matching.MatchIntentViewModelFactory
import com.vibematch.app.video.VideoSession
import com.vibematch.app.video.VideoSessionApiClient
import com.vibematch.app.video.VideoSessionStatus
import com.vibematch.app.video.VideoSessionViewModel
import com.vibematch.app.video.VideoSessionViewModelFactory
import com.vibematch.app.moderation.ModerationApiClient
import com.vibematch.app.moderation.ReportCategory
import com.vibematch.app.moderation.ModerationViewModel
import com.vibematch.app.moderation.ModerationViewModelFactory
import com.vibematch.app.video.rtc.LiveKitRtcRoomGateway
import com.vibematch.app.video.rtc.RtcRoomViewModel
import com.vibematch.app.video.rtc.RtcRoomStatus
import com.vibematch.app.video.rtc.RtcRoomUiState
import com.vibematch.app.video.rtc.RtcRoomViewModelFactory
import io.livekit.android.renderer.SurfaceViewRenderer
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
                val rtcGateway = remember { LiveKitRtcRoomGateway(applicationContext) }
                val rtcRoomViewModel: RtcRoomViewModel = viewModel(
                    factory = RtcRoomViewModelFactory(rtcGateway),
                )
                val expireSession: (AuthLogoutSnapshot) -> Unit = { snapshot ->
                    if (!isFinishing && !isDestroyed) {
                        runOnUiThread {
                            rtcRoomViewModel.disconnect()
                            rtcRoomViewModel.discardPendingJitToken()
                            authViewModel.signOut(snapshot)
                        }
                    }
                }
                val expireCurrentSession: () -> Unit = {
                    expireSession(sessionStore.readLogoutSnapshot())
                }
                val sessionRefreshCoordinator = remember {
                    SessionRefreshCoordinator(
                        sessionStore = sessionStore,
                        authGateway = authGateway,
                        onSessionExpired = expireSession,
                    )
                }
                val sessionHttpClient = remember {
                    buildSessionAwareHttpClient(sessionRefreshCoordinator)
                }
                val onLogout: () -> Unit = {
                    rtcRoomViewModel.disconnect()
                    rtcRoomViewModel.discardPendingJitToken()
                    authViewModel.signOut()
                }
                val billingGateway = remember { PlayBillingClientGateway(applicationContext) }
                val billingViewModel: BillingViewModel = viewModel(
                    factory = BillingViewModelFactory(
                        playGateway = billingGateway,
                        validationGateway = BillingApiClient(
                            BuildConfig.API_BASE_URL,
                            BuildConfig.BILLING_VALIDATION_PATH,
                            httpClient = sessionHttpClient,
                        ),
                        accessTokenProvider = sessionStore::readAccessToken,
                        productId = BuildConfig.BILLING_PRODUCT_ID,
                        onSessionExpired = expireCurrentSession,
                    ),
                )
                val chatViewModel: ChatViewModel = viewModel(
                    factory = ChatViewModelFactory(
                        gateway = ChatApiClient(
                            BuildConfig.API_BASE_URL,
                            httpClient = sessionHttpClient,
                        ),
                        accessTokenProvider = sessionStore::readAccessToken,
                        onSessionExpired = expireCurrentSession,
                    ),
                )
                val profileViewModel: ProfileViewModel = viewModel(
                    factory = ProfileViewModelFactory(
                        gateway = ProfileApiClient(
                            BuildConfig.API_BASE_URL,
                            httpClient = sessionHttpClient,
                        ),
                        accessTokenProvider = sessionStore::readAccessToken,
                        onSessionExpired = expireCurrentSession,
                    ),
                )
                val phoneViewModel: PhoneVerificationViewModel = viewModel(
                    factory = PhoneVerificationViewModelFactory(
                        gateway = PhoneVerificationApiClient(
                            BuildConfig.API_BASE_URL,
                            httpClient = sessionHttpClient,
                        ),
                        accessTokenProvider = sessionStore::readAccessToken,
                        onSessionExpired = expireCurrentSession,
                        onPhoneVerified = authViewModel::markPhoneVerified,
                    ),
                )
                val matchIntentViewModel: MatchIntentViewModel = viewModel(
                    factory = MatchIntentViewModelFactory(
                        gateway = MatchIntentApiClient(
                            BuildConfig.API_BASE_URL,
                            httpClient = sessionHttpClient,
                        ),
                        accessTokenProvider = sessionStore::readAccessToken,
                        onSessionExpired = expireCurrentSession,
                        onPhoneVerificationRequired = authViewModel::markPhoneUnverified,
                    ),
                )
                val consentViewModel: ConsentViewModel = viewModel(
                    factory = ConsentViewModelFactory(
                        gateway = ConsentApiClient(
                            BuildConfig.API_BASE_URL,
                            httpClient = sessionHttpClient,
                        ),
                        accessTokenProvider = sessionStore::readAccessToken,
                        currentUserIdProvider = { authViewModel.state.value.session?.userId },
                        onSessionExpired = expireCurrentSession,
                        onPhoneVerificationRequired = authViewModel::markPhoneUnverified,
                        onAgeAssuranceRequired = {
                            profileViewModel.reset()
                            profileViewModel.load()
                        },
                    ),
                )
                val videoViewModel: VideoSessionViewModel = viewModel(
                    factory = VideoSessionViewModelFactory(
                        gateway = VideoSessionApiClient(
                            BuildConfig.API_BASE_URL,
                            httpClient = sessionHttpClient,
                        ),
                        accessTokenProvider = sessionStore::readAccessToken,
                        onSessionExpired = expireCurrentSession,
                        onPhoneVerificationRequired = authViewModel::markPhoneUnverified,
                        onAgeAssuranceRequired = {
                            profileViewModel.reset()
                            profileViewModel.load()
                        },
                        onAuthorizationRevoked = rtcRoomViewModel::disconnect,
                        onTokenIssued = { token, _ ->
                            rtcRoomViewModel.setPendingJitToken(token)
                        },
                    ),
                )
                val accountDeletionViewModel: AccountDeletionViewModel = viewModel(
                    factory = AccountDeletionViewModelFactory(
                        gateway = AccountDeletionApiClient(
                            BuildConfig.API_BASE_URL,
                            httpClient = sessionHttpClient,
                        ),
                        accessTokenProvider = sessionStore::readAccessToken,
                        onSessionExpired = expireCurrentSession,
                        onAccountDeleted = {
                            authViewModel.completeAccountDeletion {
                                videoViewModel.reset()
                                rtcRoomViewModel.disconnect()
                                rtcRoomViewModel.discardPendingJitToken()
                            }
                        },
                    ),
                )
                val moderationViewModel: ModerationViewModel = viewModel(
                    factory = ModerationViewModelFactory(
                        gateway = ModerationApiClient(
                            BuildConfig.API_BASE_URL,
                            httpClient = sessionHttpClient,
                        ),
                        accessTokenProvider = sessionStore::readAccessToken,
                        onSessionExpired = expireCurrentSession,
                        onBlocked = rtcRoomViewModel::disconnect,
                    ),
                )
                VibeMatchApp(
                    activity = this@MainActivity,
                    authViewModel = authViewModel,
                    accountDeletionViewModel = accountDeletionViewModel,
                    chatViewModel = chatViewModel,
                    billingViewModel = billingViewModel,
                    profileViewModel = profileViewModel,
                    phoneViewModel = phoneViewModel,
                    matchIntentViewModel = matchIntentViewModel,
                    consentViewModel = consentViewModel,
                    videoViewModel = videoViewModel,
                    moderationViewModel = moderationViewModel,
                    rtcRoomViewModel = rtcRoomViewModel,
                    onLogout = onLogout,
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
    accountDeletionViewModel: AccountDeletionViewModel,
    chatViewModel: ChatViewModel,
    billingViewModel: BillingViewModel,
    profileViewModel: ProfileViewModel,
    phoneViewModel: PhoneVerificationViewModel,
    matchIntentViewModel: MatchIntentViewModel,
    consentViewModel: ConsentViewModel,
    videoViewModel: VideoSessionViewModel,
    moderationViewModel: ModerationViewModel,
    rtcRoomViewModel: RtcRoomViewModel,
    onLogout: () -> Unit,
) {
    val authState by authViewModel.state
    val session = authState.session
    val sessionId = session?.userId
    var showProfile by remember(sessionId) { mutableStateOf(false) }
    var showBilling by remember(sessionId) { mutableStateOf(false) }
    var showMatchIntents by remember(sessionId) { mutableStateOf(false) }
    var showConsent by remember(sessionId) { mutableStateOf(false) }
    var consentMatchIntentId by remember(sessionId) { mutableStateOf<String?>(null) }
    var showVideo by remember(sessionId) { mutableStateOf(false) }
    var videoConsentId by remember(sessionId) { mutableStateOf<String?>(null) }
    var showModeration by remember(sessionId) { mutableStateOf(false) }
    var moderationTargetUserId by remember(sessionId) { mutableStateOf<String?>(null) }
    var moderationSessionId by remember(sessionId) { mutableStateOf<String?>(null) }
    var moderationReturnsToConsent by remember(sessionId) { mutableStateOf(false) }

    fun stopRtc() {
        rtcRoomViewModel.disconnect()
        rtcRoomViewModel.discardPendingJitToken()
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) stopRtc()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            stopRtc()
        }
    }

    LaunchedEffect(sessionId) {
        accountDeletionViewModel.reset()
        profileViewModel.reset()
        phoneViewModel.reset()
        matchIntentViewModel.reset()
        consentViewModel.reset()
        videoViewModel.reset()
        moderationViewModel.reset()
        billingViewModel.reset()
        stopRtc()
        showConsent = false
        showBilling = false
        consentMatchIntentId = null
        showVideo = false
        videoConsentId = null
        showModeration = false
        moderationTargetUserId = null
        moderationSessionId = null
        moderationReturnsToConsent = false
        if (sessionId != null) profileViewModel.load()
    }

    if (session == null) {
        LoginScreen(
            activity = activity,
            viewModel = authViewModel,
            googleSignInConfigured = isGoogleServerClientIdConfigured(BuildConfig.GOOGLE_SERVER_CLIENT_ID),
        )
    } else {
        val profileState by profileViewModel.state
        val consentState by consentViewModel.state
        val selectedConsentMatchIntentId = consentMatchIntentId
        val selectedVideoConsentId = videoConsentId
        val selectedModerationTargetUserId = moderationTargetUserId
        val videoOtherParticipantId = consentState.consent?.let { consent ->
            when (session.userId) {
                consent.userAId -> consent.userBId
                consent.userBId -> consent.userAId
                else -> null
            }
        }
        when {
            showBilling -> {
                BillingScreen(
                    activity = activity,
                    viewModel = billingViewModel,
                    onClose = {
                        billingViewModel.reset()
                        showBilling = false
                    },
                    onLogout = {
                        billingViewModel.reset()
                        stopRtc()
                        onLogout()
                    },
                )
            }
            showProfile ||
                !profileState.hasLoaded ||
                profileState.profileIncomplete ||
                profileState.gate != ProfileGate.READY -> {
                ProfileScreen(
                    viewModel = profileViewModel,
                    accountDeletionViewModel = accountDeletionViewModel,
                    onClose = { showProfile = false },
                    onLogout = {
                        billingViewModel.reset()
                        stopRtc()
                        profileViewModel.reset()
                        matchIntentViewModel.reset()
                        chatViewModel.clearConversation()
                        phoneViewModel.reset()
                        onLogout()
                    },
                )
            }
            !session.phoneVerified -> {
                PhoneVerificationScreen(
                    viewModel = phoneViewModel,
                    accountDeletionViewModel = accountDeletionViewModel,
                    onLogout = {
                        billingViewModel.reset()
                        stopRtc()
                        phoneViewModel.reset()
                        matchIntentViewModel.reset()
                        chatViewModel.clearConversation()
                        onLogout()
                    },
                )
            }
            showModeration && selectedModerationTargetUserId != null -> {
                ModerationScreen(
                    viewModel = moderationViewModel,
                    targetUserId = selectedModerationTargetUserId,
                    sessionId = moderationSessionId,
                    onClose = {
                        showModeration = false
                        moderationTargetUserId = null
                        moderationSessionId = null
                        moderationViewModel.reset()
                        if (moderationReturnsToConsent) {
                            showConsent = true
                        } else {
                            showMatchIntents = true
                        }
                        moderationReturnsToConsent = false
                    },
                    onLogout = {
                        billingViewModel.reset()
                        stopRtc()
                        moderationViewModel.reset()
                        consentViewModel.reset()
                        matchIntentViewModel.reset()
                        chatViewModel.clearConversation()
                        phoneViewModel.reset()
                        onLogout()
                    },
                )
            }
            showVideo && selectedVideoConsentId != null -> {
                VideoSessionScreen(
                    viewModel = videoViewModel,
                    rtcViewModel = rtcRoomViewModel,
                    liveKitUrl = BuildConfig.LIVEKIT_URL,
                    consentId = selectedVideoConsentId,
                    onOpenModeration = {
                        stopRtc()
                        val targetUserId = videoOtherParticipantId
                        if (targetUserId != null) {
                            moderationViewModel.reset()
                            moderationTargetUserId = targetUserId
                            moderationSessionId = videoViewModel.state.value.session?.id
                            moderationReturnsToConsent = false
                            showVideo = false
                            showModeration = true
                        }
                    },
                    onClose = {
                        stopRtc()
                        showVideo = false
                        videoConsentId = null
                        showConsent = true
                    },
                    onLogout = {
                        billingViewModel.reset()
                        stopRtc()
                        videoViewModel.reset()
                        consentViewModel.reset()
                        matchIntentViewModel.reset()
                        chatViewModel.clearConversation()
                        phoneViewModel.reset()
                        onLogout()
                    },
                )
            }
            showConsent && selectedConsentMatchIntentId != null -> {
                ConsentScreen(
                    viewModel = consentViewModel,
                    matchIntentId = selectedConsentMatchIntentId,
                    currentUserId = session.userId,
                    onOpenModeration = { targetUserId ->
                        moderationViewModel.reset()
                        moderationTargetUserId = targetUserId
                        moderationReturnsToConsent = true
                        showConsent = false
                        showModeration = true
                    },
                    onOpenVideo = { consentId ->
                        videoConsentId = consentId
                        showConsent = false
                        showVideo = true
                    },
                    onClose = {
                        showConsent = false
                        consentMatchIntentId = null
                        showMatchIntents = true
                    },
                    onLogout = {
                        billingViewModel.reset()
                        stopRtc()
                        consentViewModel.reset()
                        matchIntentViewModel.reset()
                        chatViewModel.clearConversation()
                        phoneViewModel.reset()
                        onLogout()
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
                        billingViewModel.reset()
                        stopRtc()
                        matchIntentViewModel.reset()
                        consentViewModel.reset()
                        chatViewModel.clearConversation()
                        phoneViewModel.reset()
                        onLogout()
                    },
                )
            }
            else -> {
                ChatScreen(
                    viewModel = chatViewModel,
                    accountDeletionViewModel = accountDeletionViewModel,
                    isSigningOut = authState.isLoading,
                    onLogout = {
                        billingViewModel.reset()
                        stopRtc()
                        chatViewModel.clearConversation()
                        matchIntentViewModel.reset()
                        phoneViewModel.reset()
                        onLogout()
                    },
                    onOpenProfile = { showProfile = true },
                    onOpenBilling = { showBilling = true },
                    onOpenMatchIntents = { showMatchIntents = true },
                )
            }
        }
    }
}

@Composable
private fun LoginScreen(
    activity: Activity,
    viewModel: AuthViewModel,
    googleSignInConfigured: Boolean,
) {
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
                enabled = googleSignInConfigured && !state.isLoading,
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
            if (!googleSignInConfigured && state.errorMessage == null) {
                Spacer(modifier = Modifier.height(16.dp))
                ErrorBanner(
                    "Login Google indisponível neste build. Configure GOOGLE_SERVER_CLIENT_ID e gere o APK novamente.",
                ) {}
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
    accountDeletionViewModel: AccountDeletionViewModel,
    isSigningOut: Boolean,
    onLogout: () -> Unit,
    onOpenProfile: () -> Unit,
    onOpenBilling: () -> Unit,
    onOpenMatchIntents: () -> Unit,
) {
    val state by viewModel.state
    val deletionState by accountDeletionViewModel.state
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
                isDeletingAccount = deletionState.isDeleting,
                onLogout = onLogout,
                onDeleteAccount = accountDeletionViewModel::requestDeletion,
                onOpenProfile = onOpenProfile,
                onOpenBilling = onOpenBilling,
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
            deletionState.errorMessage?.let { error ->
                ErrorBanner(error) { accountDeletionViewModel.clearError() }
            }
            Composer(
                draft = draft,
                isSending = state.isSending,
                enabled = !isSigningOut && !deletionState.isDeleting,
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
    isDeletingAccount: Boolean,
    onLogout: () -> Unit,
    onDeleteAccount: () -> Unit,
    onOpenProfile: () -> Unit,
    onOpenBilling: () -> Unit,
    onOpenMatchIntents: () -> Unit,
) {
    var menuExpanded by remember { mutableStateOf(false) }
    var showDeleteConfirmation by remember { mutableStateOf(false) }
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
                text = if (isDeletingAccount) "Solicitando exclusão da conta…" else "Sessão segura ativa",
                style = MaterialTheme.typography.bodySmall,
                color = Color(0xFF72717D),
            )
        }
        Box {
            IconButton(
                onClick = { menuExpanded = true },
                enabled = !isSigningOut && !isDeletingAccount,
            ) {
                Icon(
                    imageVector = Icons.Default.MoreVert,
                    contentDescription = "Mais opções",
                    tint = VibePurple,
                )
            }
            DropdownMenu(
                expanded = menuExpanded,
                onDismissRequest = { menuExpanded = false },
            ) {
                DropdownMenuItem(
                    text = { Text("Perfil") },
                    onClick = {
                        menuExpanded = false
                        onOpenProfile()
                    },
                )
                DropdownMenuItem(
                    text = { Text("Premium") },
                    onClick = {
                        menuExpanded = false
                        onOpenBilling()
                    },
                )
                DropdownMenuItem(
                    text = { Text("Solicitações") },
                    onClick = {
                        menuExpanded = false
                        onOpenMatchIntents()
                    },
                )
                DropdownMenuItem(
                    text = { Text("Excluir conta", color = Color(0xFF9E2D2D)) },
                    onClick = {
                        menuExpanded = false
                        showDeleteConfirmation = true
                    },
                )
            }
        }
        TextButton(onClick = onLogout, enabled = !isSigningOut && !isDeletingAccount) {
            Text("Sair", color = VibePurple)
        }
    }
    if (showDeleteConfirmation) {
        AlertDialog(
            onDismissRequest = {
                if (!isDeletingAccount) showDeleteConfirmation = false
            },
            title = { Text("Excluir sua conta?") },
            text = {
                Text(
                    "O servidor encerrará sua sessão e iniciará a exclusão da conta. " +
                        "Solicitações, consentimentos e vídeo ativos serão revogados imediatamente.",
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showDeleteConfirmation = false
                        onDeleteAccount()
                    },
                    enabled = !isDeletingAccount,
                ) {
                    Text("Excluir conta", color = Color(0xFF9E2D2D))
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { showDeleteConfirmation = false },
                    enabled = !isDeletingAccount,
                ) {
                    Text("Cancelar")
                }
            },
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

@Composable
private fun ProfileScreen(
    viewModel: ProfileViewModel,
    accountDeletionViewModel: AccountDeletionViewModel,
    onClose: () -> Unit,
    onLogout: () -> Unit,
) {
    val state by viewModel.state
    val lifecycleOwner = LocalLifecycleOwner.current
    val verificationLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) {
        viewModel.refreshAgeAssurance()
    }
    val canClose = !state.profileIncomplete && state.gate == ProfileGate.READY

    DisposableEffect(lifecycleOwner, state.gate, state.hasLoaded) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME && state.gate == ProfileGate.AGE_PENDING) {
                viewModel.refreshAgeAssurance()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

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
            AccountDeletionAction(
                viewModel = accountDeletionViewModel,
                modifier = Modifier.padding(horizontal = 20.dp),
            )

            if (state.isLoading || !state.hasLoaded) {
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
            } else if (state.gate != ProfileGate.READY) {
                ProfileGateCard(
                    modifier = Modifier.weight(1f),
                    gate = state.gate,
                    state = state,
                    onStartAgeAssurance = viewModel::startAgeAssurance,
                    onRefreshAgeAssurance = viewModel::refreshAgeAssurance,
                    onOpenVerification = { url ->
                        val uri = runCatching { Uri.parse(url) }.getOrNull()
                        if (uri?.scheme == "https") {
                            runCatching {
                                verificationLauncher.launch(Intent(Intent.ACTION_VIEW, uri))
                            }.onFailure { viewModel.clearError() }
                        }
                    },
                    onClearError = viewModel::clearError,
                )
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
private fun ModerationScreen(
    viewModel: ModerationViewModel,
    targetUserId: String,
    sessionId: String?,
    onClose: () -> Unit,
    onLogout: () -> Unit,
) {
    val state by viewModel.state
    val isBusy = state.isBlocking || state.isReporting

    LaunchedEffect(state.blockCompleted) {
        if (state.blockCompleted) onClose()
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = VibeBackground,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
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
                Text(
                    text = "Proteção da comunidade",
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                )
                TextButton(onClick = onLogout, enabled = !isBusy) {
                    Text("Sair", color = VibePurple)
                }
            }
            Text(
                text = "Você pode bloquear esta pessoa ou registrar uma denúncia. O backend fará a validação e o encaminhamento operacional; o app não decide punições localmente.",
                style = MaterialTheme.typography.bodyMedium,
                color = VibeInk,
            )
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
            Button(
                onClick = { viewModel.block(targetUserId) },
                enabled = !isBusy && !state.blockCompleted,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF8A3D4A)),
                shape = RoundedCornerShape(14.dp),
            ) {
                if (state.isBlocking) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        color = Color.White,
                        strokeWidth = 2.dp,
                    )
                } else {
                    Text("Bloquear esta pessoa")
                }
            }
            Text(
                text = "Denunciar por categoria",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = "Selecione o motivo que melhor descreve a situação. A severidade e a necessidade de revisão humana são calculadas pelo backend.",
                style = MaterialTheme.typography.bodySmall,
                color = Color(0xFF72717D),
            )
            ReportCategory.values().forEach { category ->
                FilterChip(
                    selected = state.selectedCategory == category,
                    onClick = { viewModel.selectCategory(category) },
                    label = { Text(reportCategoryLabel(category)) },
                    enabled = !isBusy,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Button(
                onClick = { viewModel.report(targetUserId, sessionId) },
                enabled = !isBusy && !state.reportCompleted && !state.blockCompleted,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = VibePurple),
                shape = RoundedCornerShape(14.dp),
            ) {
                if (state.isReporting) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        color = Color.White,
                        strokeWidth = 2.dp,
                    )
                } else if (state.reportCompleted) {
                    Text("Denúncia registrada")
                } else {
                    Text("Enviar denúncia")
                }
            }
        }
    }
}

private fun reportCategoryLabel(category: ReportCategory): String = when (category) {
    ReportCategory.HARASSMENT -> "Assédio"
    ReportCategory.HATE -> "Discurso de ódio"
    ReportCategory.SEXUAL_CONTENT -> "Conteúdo sexual"
    ReportCategory.SCAM -> "Golpe ou fraude"
    ReportCategory.SPAM -> "Spam"
    ReportCategory.OTHER -> "Outro motivo"
}

@Composable
private fun VideoSessionScreen(
    viewModel: VideoSessionViewModel,
    rtcViewModel: RtcRoomViewModel,
    liveKitUrl: String,
    consentId: String,
    onOpenModeration: () -> Unit,
    onClose: () -> Unit,
    onLogout: () -> Unit,
) {
    val state by viewModel.state
    val rtcState by rtcViewModel.state.collectAsState()
    val session = state.session
    val isBusy = state.isCreating || state.isIssuingToken
    val requestedPermissions = remember {
        arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA)
    }
    val hasRtcPermissions = requestedPermissions.all { permission ->
        ContextCompat.checkSelfPermission(
            LocalContext.current,
            permission,
        ) == PackageManager.PERMISSION_GRANTED
    }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { grants ->
        if (requestedPermissions.all { grants[it] == true }) {
            rtcViewModel.connectWithPendingJitToken(liveKitUrl)
        } else {
            rtcViewModel.markPermissionDenied()
        }
    }

    LaunchedEffect(consentId) {
        viewModel.reset()
        rtcViewModel.disconnect()
        viewModel.create(consentId)
    }
    DisposableEffect(consentId) {
        onDispose {
            rtcViewModel.disconnect()
            rtcViewModel.discardPendingJitToken()
        }
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
                        text = "Sessão de vídeo",
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                    )
                    Text(
                        text = "Autorização sob demanda",
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
            rtcState.errorMessage?.let { error ->
                ErrorBanner(error) { rtcViewModel.disconnect() }
            }
            when {
                state.isCreating -> {
                    Box(
                        modifier = Modifier.fillMaxWidth().weight(1f),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator(color = VibePurple)
                    }
                }
                state.session == null -> {
                    Column(
                        modifier = Modifier.fillMaxWidth().weight(1f),
                        verticalArrangement = Arrangement.Center,
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(
                            text = "A sessão de vídeo não foi autorizada.",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            textAlign = TextAlign.Center,
                        )
                        Text(
                            text = "Nenhuma câmera ou conexão de vídeo foi iniciada.",
                            modifier = Modifier.padding(top = 8.dp),
                            style = MaterialTheme.typography.bodyMedium,
                            color = Color(0xFF72717D),
                            textAlign = TextAlign.Center,
                        )
                        if (!state.sessionExpired && !state.ageBlocked && !state.phoneBlocked) {
                            TextButton(
                                onClick = { viewModel.create(consentId) },
                                enabled = !isBusy,
                            ) {
                                Text("Tentar autorização novamente", color = VibePurple)
                            }
                        }
                    }
                }
                rtcState.status == RtcRoomStatus.CONNECTED ||
                    rtcState.status == RtcRoomStatus.RECONNECTING -> {
                    RtcCallPanel(
                        modifier = Modifier.weight(1f),
                        state = rtcState,
                        rtcViewModel = rtcViewModel,
                        onHangup = rtcViewModel::disconnect,
                        onOpenModeration = onOpenModeration,
                    )
                }
                else -> {
                    if (session != null) {
                        VideoSessionCard(
                            modifier = Modifier.weight(1f),
                            session = session,
                            isIssuingToken = state.isIssuingToken,
                            tokenIssued = state.tokenIssued,
                            rtcTokenReady = rtcState.jitTokenReady,
                            rtcStatus = rtcState.status,
                            onIssueToken = viewModel::issueToken,
                            onConnectRtc = {
                                if (liveKitUrl.isBlank()) {
                                    rtcViewModel.connectWithPendingJitToken(liveKitUrl)
                                } else if (hasRtcPermissions) {
                                    rtcViewModel.connectWithPendingJitToken(liveKitUrl)
                                } else {
                                    permissionLauncher.launch(requestedPermissions)
                                }
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun RtcCallPanel(
    modifier: Modifier = Modifier,
    state: RtcRoomUiState,
    rtcViewModel: RtcRoomViewModel,
    onHangup: () -> Unit,
    onOpenModeration: () -> Unit,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = Color.Black,
        shape = RoundedCornerShape(20.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                AndroidView(
                    factory = { context -> SurfaceViewRenderer(context) },
                    update = rtcViewModel::attachRemoteRenderer,
                    onRelease = rtcViewModel::detachRemoteRenderer,
                    modifier = Modifier
                        .weight(1f)
                        .height(250.dp),
                )
                AndroidView(
                    factory = { context -> SurfaceViewRenderer(context) },
                    update = rtcViewModel::attachLocalRenderer,
                    onRelease = rtcViewModel::detachLocalRenderer,
                    modifier = Modifier
                        .weight(1f)
                        .height(250.dp),
                )
            }
            Text(
                text = if (state.status == RtcRoomStatus.RECONNECTING) {
                    "Reconectando com segurança…"
                } else {
                    "Conectado • ${state.remoteParticipantCount} participante(s) remoto(s)"
                },
                color = Color.White,
                style = MaterialTheme.typography.bodyMedium,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(
                    onClick = { rtcViewModel.setMicrophoneEnabled(!state.microphoneEnabled) },
                    enabled = state.status == RtcRoomStatus.CONNECTED,
                    modifier = Modifier.weight(1f),
                ) {
                    Text(if (state.microphoneEnabled) "Silenciar" else "Ativar áudio")
                }
                OutlinedButton(
                    onClick = { rtcViewModel.setCameraEnabled(!state.localVideoEnabled) },
                    enabled = state.status == RtcRoomStatus.CONNECTED,
                    modifier = Modifier.weight(1f),
                ) {
                    Text(if (state.localVideoEnabled) "Desligar câmera" else "Ativar câmera")
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                TextButton(
                    onClick = onOpenModeration,
                    modifier = Modifier.weight(1f),
                ) {
                    Text("Bloquear/denunciar", color = Color.White)
                }
                Button(
                    onClick = onHangup,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF8A3D4A)),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    Text("Encerrar")
                }
            }
        }
    }
}

@Composable
private fun VideoSessionCard(
    modifier: Modifier = Modifier,
    session: VideoSession,
    isIssuingToken: Boolean,
    tokenIssued: Boolean,
    rtcTokenReady: Boolean,
    rtcStatus: RtcRoomStatus,
    onIssueToken: () -> Unit,
    onConnectRtc: () -> Unit,
) {
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
                text = "Sessão autorizada pelo backend",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = "Status: ${videoSessionStatusLabel(session.status)}",
                style = MaterialTheme.typography.bodyMedium,
                color = VibeInk,
            )
            Text(
                text = if (session.revocationPending) {
                    "Esta sessão está pendente de revogação. O servidor deve ser consultado novamente."
                } else {
                    "A autorização foi revalidada no servidor. Solicite uma credencial apenas se for continuar para a próxima etapa."
                },
                style = MaterialTheme.typography.bodyMedium,
                color = Color(0xFF72717D),
            )
            Button(
                onClick = onIssueToken,
                enabled = !isIssuingToken && !rtcTokenReady && session.status != VideoSessionStatus.ENDED,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = VibePurple),
                shape = RoundedCornerShape(14.dp),
            ) {
                if (isIssuingToken) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        color = Color.White,
                        strokeWidth = 2.dp,
                    )
                } else if (tokenIssued && rtcTokenReady) {
                    Text("Credencial JIT emitida")
                } else if (tokenIssued) {
                    Text("Solicitar nova credencial JIT")
                } else {
                    Text("Solicitar credencial JIT")
                }
            }
            if (rtcTokenReady) {
                Button(
                    onClick = onConnectRtc,
                    enabled = rtcStatus != RtcRoomStatus.CONNECTED &&
                        rtcStatus != RtcRoomStatus.CONNECTING &&
                        rtcStatus != RtcRoomStatus.RECONNECTING,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2F7D4A)),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    Text(
                        if (rtcStatus == RtcRoomStatus.PERMISSION_DENIED) {
                            "Tentar permissões novamente"
                        } else {
                            "Entrar na chamada"
                        },
                    )
                }
            }
            Text(
                text = "A credencial não é exibida nem persistida pelo app. O LiveKit só é conectado após token JIT novo, permissões aprovadas e ação explícita do usuário.",
                style = MaterialTheme.typography.bodySmall,
                color = Color(0xFF72717D),
            )
        }
    }
}

private fun videoSessionStatusLabel(status: VideoSessionStatus): String = when (status) {
    VideoSessionStatus.CREATED -> "criada"
    VideoSessionStatus.ACTIVE -> "ativa"
    VideoSessionStatus.ENDED -> "encerrada"
    VideoSessionStatus.UNKNOWN -> "indisponível"
}

@Composable
private fun ConsentScreen(
    viewModel: com.vibematch.app.consent.ConsentViewModel,
    matchIntentId: String,
    currentUserId: String,
    onOpenModeration: (String) -> Unit,
    onOpenVideo: (String) -> Unit,
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
                        Text(
                            text = "O servidor não confirmou um consentimento utilizável para esta solicitação.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = Color(0xFF72717D),
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(top = 8.dp),
                        )
                        TextButton(
                            onClick = { viewModel.create(matchIntentId) },
                            enabled = !isBusy,
                        ) {
                            Text("Tentar novamente", color = VibePurple)
                        }
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
                            onOpenModeration = onOpenModeration,
                            onOpenVideo = {
                                if (consent.status == ConsentStatus.ACCEPTED_BOTH) {
                                    onOpenVideo(consent.id)
                                }
                            },
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
    onOpenModeration: (String) -> Unit,
    onOpenVideo: () -> Unit,
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
    val otherParticipantId = when (currentUserId) {
        consent.userAId -> consent.userBId
        consent.userBId -> consent.userAId
        else -> null
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
            if (consent.status == ConsentStatus.ACCEPTED_BOTH) {
                Button(
                    onClick = onOpenVideo,
                    enabled = !isDeciding,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = VibePurple),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    Text("Preparar vídeo com o servidor")
                }
            }
            if (otherParticipantId != null) {
                TextButton(
                    onClick = { onOpenModeration(otherParticipantId) },
                    enabled = !isDeciding,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Bloquear ou denunciar", color = Color(0xFF8A3D4A))
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
                        TextButton(
                            onClick = { viewModel.load(refresh = true) },
                            enabled = !state.isLoading,
                        ) {
                            Text("Atualizar solicitações", color = VibePurple)
                        }
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
    accountDeletionViewModel: AccountDeletionViewModel,
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
            AccountDeletionAction(viewModel = accountDeletionViewModel)

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
private fun ProfileGateCard(
    modifier: Modifier = Modifier,
    gate: ProfileGate,
    state: com.vibematch.app.profile.ProfileUiState,
    onStartAgeAssurance: () -> Unit,
    onRefreshAgeAssurance: () -> Unit,
    onOpenVerification: (String) -> Unit,
    onClearError: () -> Unit,
) {
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
        state.errorMessage?.let { error ->
            ErrorBanner(error, onClearError)
        }
        state.infoMessage?.let { message ->
            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                color = Color(0xFF2F7D4A),
                textAlign = TextAlign.Center,
            )
        }
        when (gate) {
            ProfileGate.AGE_NOT_STARTED -> {
                Button(
                    onClick = onStartAgeAssurance,
                    enabled = !state.isStartingAgeAssurance && !state.isRefreshingAgeAssurance,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = VibePurple),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    if (state.isStartingAgeAssurance) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            color = Color.White,
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Text("Iniciar verificação segura")
                    }
                }
            }
            ProfileGate.AGE_PENDING -> {
                state.ageVerificationUrl?.let { url ->
                    OutlinedButton(
                        onClick = { onOpenVerification(url) },
                        enabled = !state.isStartingAgeAssurance && !state.isRefreshingAgeAssurance,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Abrir verificação")
                    }
                }
                Button(
                    onClick = onRefreshAgeAssurance,
                    enabled = !state.isStartingAgeAssurance && !state.isRefreshingAgeAssurance,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = VibePurple),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    if (state.isRefreshingAgeAssurance) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            color = Color.White,
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Text("Atualizar status")
                    }
                }
            }
            ProfileGate.AGE_REJECTED,
            ProfileGate.AGE_UNAVAILABLE,
            -> {
                Button(
                    onClick = onRefreshAgeAssurance,
                    enabled = !state.isStartingAgeAssurance && !state.isRefreshingAgeAssurance,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = VibePurple),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    if (state.isRefreshingAgeAssurance) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            color = Color.White,
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Text("Tentar novamente")
                    }
                }
            }
            ProfileGate.BLOCKED,
            ProfileGate.SUSPENDED,
            ProfileGate.READY,
            -> Unit
        }
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

@Composable
private fun BillingScreen(
    activity: Activity,
    viewModel: BillingViewModel,
    onClose: () -> Unit,
    onLogout: () -> Unit,
) {
    val state by viewModel.state
    LaunchedEffect(Unit) { viewModel.start() }
    val busy = state.status == BillingUiStatus.CONNECTING ||
        state.status == BillingUiStatus.PURCHASING ||
        state.status == BillingUiStatus.RESTORING ||
        state.status == BillingUiStatus.VALIDATING ||
        state.status == BillingUiStatus.WAITING_FOR_PURCHASE

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = VibeBackground,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 20.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Premium",
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        text = "Compra e restauração seguras",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color(0xFF72717D),
                    )
                }
                TextButton(onClick = onClose, enabled = !busy) {
                    Text("Voltar", color = VibePurple)
                }
            }
            Spacer(modifier = Modifier.height(20.dp))
            Text(
                text = "O Google Play inicia a transação. O VibeMatch só libera o acesso depois que o backend validar o purchase token e retornar o entitlement.",
                style = MaterialTheme.typography.bodyLarge,
                color = VibeInk,
            )
            Spacer(modifier = Modifier.height(20.dp))
            state.productTitle?.let { title ->
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    color = Color.White,
                    tonalElevation = 2.dp,
                ) {
                    Column(modifier = Modifier.padding(18.dp)) {
                        Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        state.productDescription?.let { description ->
                            Spacer(modifier = Modifier.height(6.dp))
                            Text(description, style = MaterialTheme.typography.bodyMedium)
                        }
                        state.formattedPrice?.takeIf { it.isNotBlank() }?.let { price ->
                            Spacer(modifier = Modifier.height(10.dp))
                            Text(price, style = MaterialTheme.typography.titleMedium, color = VibePurple)
                        }
                    }
                }
                Spacer(modifier = Modifier.height(16.dp))
            }
            Button(
                onClick = { viewModel.purchase(activity) },
                enabled = state.status == BillingUiStatus.READY && !busy,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = VibePurple),
                shape = RoundedCornerShape(14.dp),
            ) {
                if (state.status == BillingUiStatus.PURCHASING) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        color = Color.White,
                        strokeWidth = 2.dp,
                    )
                } else {
                    Text("Comprar Premium")
                }
            }
            Spacer(modifier = Modifier.height(10.dp))
            OutlinedButton(
                onClick = viewModel::restore,
                enabled = !busy && state.status != BillingUiStatus.NOT_CONFIGURED,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(14.dp),
            ) {
                if (state.status == BillingUiStatus.RESTORING) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                } else {
                    Text("Restaurar compras")
                }
            }
            if (busy) {
                Spacer(modifier = Modifier.height(16.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    Spacer(modifier = Modifier.width(10.dp))
                    Text(
                        text = state.infoMessage ?: "Processando com segurança...",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
            state.infoMessage?.takeIf { !busy }?.let { info ->
                Spacer(modifier = Modifier.height(16.dp))
                Text(info, style = MaterialTheme.typography.bodyMedium, color = Color(0xFF4D4D59))
            }
            if (state.status == BillingUiStatus.SUCCESS && state.entitlementActive) {
                Spacer(modifier = Modifier.height(18.dp))
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    color = Color(0xFFE9F7EF),
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text("Premium confirmado pelo servidor", fontWeight = FontWeight.Bold, color = Color(0xFF176B3A))
                        state.entitlementPlan?.let { plan ->
                            Text("Plano: $plan", style = MaterialTheme.typography.bodyMedium)
                        }
                        state.entitlementExpiresAt?.let { expiresAt ->
                            Text("Válido até: $expiresAt", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            }
            state.errorMessage?.let { error ->
                Spacer(modifier = Modifier.height(16.dp))
                ErrorBanner(error) { viewModel.clearMessages() }
                if (state.status == BillingUiStatus.ERROR) {
                    TextButton(
                        onClick = viewModel::start,
                        enabled = !busy,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Tentar novamente", color = VibePurple)
                    }
                }
            }
            if (state.status == BillingUiStatus.NOT_CONFIGURED) {
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    text = "Nenhum produto está configurado neste ambiente. Nenhum acesso Premium foi concedido.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color(0xFF72717D),
                )
            }
            Spacer(modifier = Modifier.height(28.dp))
            TextButton(onClick = onLogout, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                Text("Sair da conta", color = Color(0xFF9E2D2D))
            }
        }
    }
}
