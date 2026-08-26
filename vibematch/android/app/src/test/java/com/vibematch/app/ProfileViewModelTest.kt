package com.vibematch.app

import com.vibematch.app.profile.AgeAssuranceStatus
import com.vibematch.app.profile.ProfileDraft
import com.vibematch.app.profile.ProfileGateway
import com.vibematch.app.profile.ProfileGate
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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ProfileViewModelTest {
    private val dispatcher = UnconfinedTestDispatcher()
    private lateinit var gateway: FakeProfileGateway

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        gateway = FakeProfileGateway()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `loads interests and marks missing profile as incomplete`() = runTest {
        val viewModel = ProfileViewModel(gateway, { "session-jwt" })

        viewModel.load()

        assertTrue(viewModel.state.value.hasLoaded)
        assertTrue(viewModel.state.value.profileIncomplete)
        assertEquals(2, viewModel.state.value.availableInterests.size)
        assertTrue(viewModel.state.value.draft.language.isNotBlank())
    }

    @Test
    fun `saves normalized profile draft with selected interests`() = runTest {
        val viewModel = ProfileViewModel(gateway, { "session-jwt" })
        viewModel.load()
        viewModel.updateDisplayName("  Rapha  ")
        viewModel.updateLanguage("pt-BR")
        viewModel.updateRegion("BR-SP")
        viewModel.toggleInterest("interest-1")

        viewModel.save()

        assertEquals("Rapha", gateway.lastDraft?.displayName)
        assertEquals(setOf("interest-1"), gateway.lastDraft?.interestIds)
        assertFalse(viewModel.state.value.profileIncomplete)
        assertTrue(viewModel.state.value.saved)
    }

    @Test
    fun `blocks restricted flow when age assurance is pending`() = runTest {
        gateway.ageStatus = AgeAssuranceStatus.PENDING
        val viewModel = ProfileViewModel(gateway, { "session-jwt" })

        viewModel.load()

        assertEquals(ProfileGate.AGE_PENDING, viewModel.state.value.gate)
        assertTrue(viewModel.state.value.hasLoaded)
    }

    @Test
    fun `unknown age assurance status fails closed`() = runTest {
        gateway.ageStatus = AgeAssuranceStatus.UNKNOWN
        val viewModel = ProfileViewModel(gateway, { "session-jwt" })

        viewModel.load()

        assertEquals(ProfileGate.AGE_UNAVAILABLE, viewModel.state.value.gate)
    }

    @Test
    fun `does not select more than ten interests`() = runTest {
        gateway.interests = (1..11).map { ProfileInterest("interest-$it", "Interest $it") }
        val viewModel = ProfileViewModel(gateway, { "session-jwt" })
        viewModel.load()

        gateway.interests.forEach { viewModel.toggleInterest(it.id) }

        assertEquals(10, viewModel.state.value.draft.interestIds.size)
        assertEquals("Você pode selecionar até 10 interesses.", viewModel.state.value.errorMessage)
    }

    @Test
    fun `returns to authentication when session is missing`() = runTest {
        var sessionExpired = false
        val viewModel = ProfileViewModel(gateway, { null }) { sessionExpired = true }

        viewModel.load()

        assertTrue(sessionExpired)
        assertTrue(viewModel.state.value.sessionExpired)
        assertFalse(viewModel.state.value.hasLoaded)
    }

    private class FakeProfileGateway : ProfileGateway {
        var interests = listOf(
            ProfileInterest("interest-1", "Música"),
            ProfileInterest("interest-2", "Viagens"),
        )
        var lastDraft: ProfileDraft? = null
        var ageStatus = AgeAssuranceStatus.APPROVED

        override suspend fun getProfile(accessToken: String): UserProfile? = null

        override suspend fun getAgeAssuranceStatus(accessToken: String): AgeAssuranceStatus = ageStatus

        override suspend fun listInterests(accessToken: String): List<ProfileInterest> = interests

        override suspend fun updateProfile(
            accessToken: String,
            draft: ProfileDraft,
        ): UserProfile {
            lastDraft = draft
            return UserProfile(
                userId = "user-1",
                displayName = draft.displayName,
                avatarUrl = draft.avatarUrl.ifBlank { null },
                language = draft.language,
                region = draft.region,
                interests = interests.filter { it.id in draft.interestIds },
            )
        }
    }
}
