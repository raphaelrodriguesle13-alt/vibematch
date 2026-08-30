package com.vibematch.app

import com.vibematch.app.profile.AgeAssuranceStart
import com.vibematch.app.profile.AgeAssuranceStatus
import com.vibematch.app.profile.ProfileDraft
import com.vibematch.app.profile.ProfileGateway
import com.vibematch.app.profile.ProfileInterest
import com.vibematch.app.profile.ProfileViewModel
import com.vibematch.app.profile.UserProfile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ProfileLoadingResilienceTest {
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
    fun `profile network failure terminates loading state instead of spinning forever`() = runTest {
        val viewModel = ProfileViewModel(FailingGateway(), { "session-jwt" })

        viewModel.load()

        assertFalse(viewModel.state.value.isLoading)
        assertTrue(viewModel.state.value.hasLoaded)
        assertTrue(viewModel.state.value.profileIncomplete)
        assertNotNull(viewModel.state.value.errorMessage)
    }

    @Test
    fun `retry re-enters loading pipeline after terminal failure`() = runTest {
        val gateway = RecoveringGateway()
        val viewModel = ProfileViewModel(gateway, { "session-jwt" })

        viewModel.load()
        assertTrue(viewModel.state.value.hasLoaded)
        assertNotNull(viewModel.state.value.errorMessage)

        gateway.fail = false
        viewModel.retryLoad()

        assertFalse(viewModel.state.value.isLoading)
        assertTrue(viewModel.state.value.hasLoaded)
        assertTrue(viewModel.state.value.errorMessage == null)
    }

    private class FailingGateway : ProfileGateway {
        override suspend fun listInterests(accessToken: String): List<ProfileInterest> =
            throw IllegalStateException("network unavailable")

        override suspend fun getProfile(accessToken: String): UserProfile? = null
        override suspend fun getAgeAssuranceStatus(accessToken: String) = AgeAssuranceStatus.APPROVED
        override suspend fun startAgeAssurance(accessToken: String) =
            AgeAssuranceStart(AgeAssuranceStatus.PENDING, "https://example.test")
        override suspend fun refreshAgeAssurance(accessToken: String) = AgeAssuranceStatus.APPROVED
        override suspend fun updateProfile(accessToken: String, draft: ProfileDraft): UserProfile =
            error("not used")
    }

    private class RecoveringGateway : ProfileGateway {
        var fail = true

        override suspend fun listInterests(accessToken: String): List<ProfileInterest> {
            if (fail) throw IllegalStateException("temporary failure")
            return emptyList()
        }

        override suspend fun getProfile(accessToken: String): UserProfile? = null
        override suspend fun getAgeAssuranceStatus(accessToken: String) = AgeAssuranceStatus.APPROVED
        override suspend fun startAgeAssurance(accessToken: String) =
            AgeAssuranceStart(AgeAssuranceStatus.PENDING, "https://example.test")
        override suspend fun refreshAgeAssurance(accessToken: String) = AgeAssuranceStatus.APPROVED
        override suspend fun updateProfile(accessToken: String, draft: ProfileDraft): UserProfile =
            error("not used")
    }
}
