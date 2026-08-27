package com.vibematch.app.profile

data class ProfileInterest(
    val id: String,
    val label: String,
)

data class UserProfile(
    val userId: String,
    val displayName: String,
    val avatarUrl: String?,
    val language: String,
    val region: String,
    val interests: List<ProfileInterest>,
)

enum class AgeAssuranceStatus {
    NOT_STARTED,
    PENDING,
    APPROVED,
    REJECTED,
    UNKNOWN,
}

data class AgeAssuranceStart(
    val status: AgeAssuranceStatus,
    val verificationUrl: String?,
)

data class ProfileDraft(
    val displayName: String,
    val avatarUrl: String,
    val language: String,
    val region: String,
    val interestIds: Set<String>,
)

interface ProfileGateway {
    suspend fun getProfile(accessToken: String): UserProfile?
    suspend fun listInterests(accessToken: String): List<ProfileInterest>
    suspend fun getAgeAssuranceStatus(accessToken: String): AgeAssuranceStatus
    suspend fun startAgeAssurance(accessToken: String): AgeAssuranceStart
    suspend fun refreshAgeAssurance(accessToken: String): AgeAssuranceStatus
    suspend fun updateProfile(accessToken: String, draft: ProfileDraft): UserProfile
}

class ProfileApiException(
    val statusCode: Int,
    val errorCode: String?,
    message: String,
) : Exception(message)
