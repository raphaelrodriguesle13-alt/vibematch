package com.vibematch.app

import com.vibematch.app.chat.ChatMessage
import com.vibematch.app.chat.ChatViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ChatViewModelTest {
    private val dispatcher = UnconfinedTestDispatcher()
    private lateinit var gateway: FakeGateway

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        gateway = FakeGateway()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `does not send without an access token`() = runTest {
        val viewModel = ChatViewModel(gateway) { null }

        viewModel.send("Oi")

        assertTrue(gateway.calls.isEmpty())
        assertEquals(
            "Entre novamente para conversar com o backend.",
            viewModel.state.value.errorMessage,
        )
    }

    @Test
    fun `adds user and assistant messages after a successful response`() = runTest {
        val viewModel = ChatViewModel(gateway) { "session-jwt" }

        viewModel.send("Como funciona?")

        assertFalse(viewModel.state.value.isSending)
        assertEquals(2, viewModel.state.value.messages.size)
        assertEquals("Como funciona?", viewModel.state.value.messages[0].text)
        assertEquals("Resposta de teste", viewModel.state.value.messages[1].text)
        assertEquals("session-jwt", gateway.lastAccessToken)
    }

    private class FakeGateway : ChatGateway {
        val calls = mutableListOf<String>()
        var lastAccessToken: String? = null

        override suspend fun send(
            accessToken: String,
            message: String,
            history: List<ChatMessage>,
        ): ChatReply {
            lastAccessToken = accessToken
            calls += message
            assertEquals(0, history.size)
            return ChatReply("resp_test", "gpt-test", "Resposta de teste")
        }
    }
}
