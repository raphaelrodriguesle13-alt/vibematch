package com.vibematch.app

import com.vibematch.app.account.AccountDeletionApiClient
import com.vibematch.app.account.AccountDeletionApiException
import com.vibematch.app.account.AccountDeletionGateway
import com.vibematch.app.account.AccountDeletionStatus
import com.vibematch.app.account.AccountDeletionViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AccountDeletionTest {
    private val dispatcher = UnconfinedTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `sends authenticated DELETE to account endpoint`() = runTest {
        val requests = mutableListOf<okhttp3.Request>()
        val client = AccountDeletionApiClient(
            baseUrl = "https://api.example",
            httpClient = fakeHttpClient(requests, 202),
        )

        val result = client.requestDeletion("session-jwt")

        assertEquals(AccountDeletionStatus.PENDING_DELETION, result)
        assertEquals("DELETE", requests.single().method)
        assertEquals("/api/account", requests.single().url.encodedPath)
        assertEquals("Bearer session-jwt", requests.single().header("Authorization"))
    }

    @Test
    fun `completes only after backend accepts deletion`() = runTest {
        val gateway = FakeAccountDeletionGateway()
        var localDeletionCompleted = false
        val viewModel = AccountDeletionViewModel(
            gateway = gateway,
            accessTokenProvider = { "session-jwt" },
            onAccountDeleted = { localDeletionCompleted = true },
        )

        viewModel.requestDeletion()

        assertEquals("session-jwt", gateway.lastAccessToken)
        assertTrue(localDeletionCompleted)
        assertTrue(viewModel.state.value.completed)
        assertFalse(viewModel.state.value.isDeleting)
        assertNull(viewModel.state.value.errorMessage)
    }

    @Test
    fun `keeps local authority intact when backend rejects deletion`() = runTest {
        val gateway = FakeAccountDeletionGateway().apply {
            error = AccountDeletionApiException(503, "Não foi possível solicitar a exclusão da conta agora.")
        }
        var localDeletionCompleted = false
        val viewModel = AccountDeletionViewModel(
            gateway = gateway,
            accessTokenProvider = { "session-jwt" },
            onAccountDeleted = { localDeletionCompleted = true },
        )

        viewModel.requestDeletion()

        assertFalse(localDeletionCompleted)
        assertFalse(viewModel.state.value.completed)
        assertEquals(
            "Não foi possível solicitar a exclusão da conta agora.",
            viewModel.state.value.errorMessage,
        )
    }

    @Test
    fun `unauthorized deletion returns to authentication`() = runTest {
        val gateway = FakeAccountDeletionGateway().apply {
            error = AccountDeletionApiException(401, "expired")
        }
        var expired = false
        var deleted = false
        val viewModel = AccountDeletionViewModel(
            gateway = gateway,
            accessTokenProvider = { "stale-jwt" },
            onSessionExpired = { expired = true },
            onAccountDeleted = { deleted = true },
        )

        viewModel.requestDeletion()

        assertTrue(expired)
        assertFalse(deleted)
        assertFalse(viewModel.state.value.completed)
    }

    private fun fakeHttpClient(
        requests: MutableList<okhttp3.Request>,
        statusCode: Int,
    ): OkHttpClient = OkHttpClient.Builder()
        .addInterceptor { chain ->
            requests += chain.request()
            Response.Builder()
                .request(chain.request())
                .protocol(Protocol.HTTP_1_1)
                .code(statusCode)
                .message(if (statusCode in 200..299) "OK" else "Error")
                .body("{}".toResponseBody("application/json".toMediaType()))
                .build()
        }
        .build()

    private class FakeAccountDeletionGateway : AccountDeletionGateway {
        var lastAccessToken: String? = null
        var error: Exception? = null

        override suspend fun requestDeletion(accessToken: String): AccountDeletionStatus {
            lastAccessToken = accessToken
            error?.let { throw it }
            return AccountDeletionStatus.PENDING_DELETION
        }
    }
}
