package com.vibematch.app.profile

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

class ProfileApiClient(
    baseUrl: String,
    private val httpClient: OkHttpClient = defaultHttpClient(),
) : ProfileGateway {
    private val baseUrl = baseUrl.trimEnd('/')
    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun getProfile(accessToken: String): UserProfile? {
        val response = execute(
            Request.Builder()
                .url("$baseUrl/api/profile")
                .header("Authorization", "Bearer $accessToken")
                .header("Accept", "application/json")
                .get()
                .build(),
        )
        response.use {
            val body = it.body?.string().orEmpty()
            if (it.code == 404) return null
            ensureSuccess(it.code, it.isSuccessful, body)
            val envelope = decode<ProfileEnvelope>(body, it.code)
            return envelope.data.toDomain()
        }
    }

    override suspend fun listInterests(accessToken: String): List<ProfileInterest> {
        val response = execute(
            Request.Builder()
                .url("$baseUrl/api/interests")
                .header("Authorization", "Bearer $accessToken")
                .header("Accept", "application/json")
                .get()
                .build(),
        )
        response.use {
            val body = it.body?.string().orEmpty()
            ensureSuccess(it.code, it.isSuccessful, body)
            val envelope = decode<InterestsEnvelope>(body, it.code)
            return envelope.data.map { interest -> interest.toDomain() }
        }
    }

    override suspend fun getAgeAssuranceStatus(accessToken: String): AgeAssuranceStatus {
        val response = execute(
            Request.Builder()
                .url("$baseUrl/api/age-assurance/status")
                .header("Authorization", "Bearer $accessToken")
                .header("Accept", "application/json")
                .get()
                .build(),
        )
        response.use {
            val body = it.body?.string().orEmpty()
            if (it.code == 404) return AgeAssuranceStatus.UNKNOWN
            ensureSuccess(it.code, it.isSuccessful, body)
            val envelope = decode<AgeAssuranceEnvelope>(body, it.code)
            return parseAgeAssuranceStatus(envelope.data.status)
        }
    }

    override suspend fun startAgeAssurance(accessToken: String): AgeAssuranceStart {
        val response = execute(
            Request.Builder()
                .url("$baseUrl/api/age-assurance/start")
                .header("Authorization", "Bearer $accessToken")
                .header("Accept", "application/json")
                .post("{}".toRequestBody("application/json; charset=utf-8".toMediaType()))
                .build(),
        )
        response.use {
            val body = it.body?.string().orEmpty()
            ensureSuccess(it.code, it.isSuccessful, body)
            val data = decode<AgeAssuranceEnvelope>(body, it.code).data
            val status = parseAgeAssuranceStatus(data.status)
            val verificationUrl = data.verificationUrl
                ?.takeIf { url -> url.startsWith("https://") }
            if (status != AgeAssuranceStatus.PENDING || verificationUrl == null) {
                throw ProfileApiException(
                    it.code,
                    "INVALID_RESPONSE",
                    "O provedor de verificação não retornou um link seguro.",
                )
            }
            return AgeAssuranceStart(status, verificationUrl)
        }
    }

    override suspend fun refreshAgeAssurance(accessToken: String): AgeAssuranceStatus {
        val response = execute(
            Request.Builder()
                .url("$baseUrl/api/age-assurance/refresh")
                .header("Authorization", "Bearer $accessToken")
                .header("Accept", "application/json")
                .post("{}".toRequestBody("application/json; charset=utf-8".toMediaType()))
                .build(),
        )
        response.use {
            val body = it.body?.string().orEmpty()
            ensureSuccess(it.code, it.isSuccessful, body)
            return parseAgeAssuranceStatus(decode<AgeAssuranceEnvelope>(body, it.code).data.status)
        }
    }

    override suspend fun updateProfile(accessToken: String, draft: ProfileDraft): UserProfile {
        val requestBody = buildProfileUpdateRequestBody(json, draft)
            .toRequestBody("application/json; charset=utf-8".toMediaType())
        val response = execute(
            Request.Builder()
                .url("$baseUrl/api/profile")
                .header("Authorization", "Bearer $accessToken")
                .header("Accept", "application/json")
                .put(requestBody)
                .build(),
        )
        response.use {
            val body = it.body?.string().orEmpty()
            ensureSuccess(it.code, it.isSuccessful, body)
            val envelope = decode<ProfileEnvelope>(body, it.code)
            return envelope.data.toDomain()
        }
    }

    private suspend fun execute(request: Request) = withContext(Dispatchers.IO) {
        httpClient.newCall(request).execute()
    }

    private fun ensureSuccess(statusCode: Int, successful: Boolean, body: String) {
        if (successful) return
        val errorCode = runCatching {
            json.parseToJsonElement(body).jsonObject["error"]?.jsonPrimitive?.content
        }.getOrNull()
        throw ProfileApiException(statusCode, errorCode, publicError(statusCode, errorCode))
    }

    private inline fun <reified T> decode(body: String, statusCode: Int): T = try {
        if (body.isBlank()) throw IllegalArgumentException("empty body")
        json.decodeFromString<T>(body)
    } catch (_: Exception) {
        throw ProfileApiException(statusCode, "INVALID_RESPONSE", "A resposta de perfil era inválida.")
    }

    private fun publicError(statusCode: Int, errorCode: String?): String = when {
        statusCode == 401 -> "Sua sessão expirou. Entre novamente para continuar."
        statusCode == 403 -> "Esta conta não está autorizada a iniciar esta verificação."
        statusCode == 409 -> "A verificação já está em andamento. Atualize o status antes de tentar novamente."
        statusCode == 429 -> "Muitas tentativas. Aguarde antes de tentar novamente."
        errorCode == "AGE_PROVIDER_UNAVAILABLE" || statusCode >= 500 ->
            "O serviço de verificação está temporariamente indisponível."
        errorCode == "PROFILE_NOT_CONFIGURED" -> "O perfil ainda não está disponível."
        errorCode == "INVALID_PROFILE" || errorCode == "INVALID_INTERESTS" ->
            "Revise os dados do perfil e tente novamente."
        statusCode >= 500 -> "O perfil está temporariamente indisponível."
        else -> "Não foi possível carregar o perfil agora."
    }

    private companion object {
        fun defaultHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .build()
    }
}

@Serializable
private data class AgeAssuranceEnvelope(val data: AgeAssuranceBody)

@Serializable
private data class AgeAssuranceBody(
    val status: String,
    @SerialName("verification_url") val verificationUrl: String? = null,
)

@Serializable
private data class ProfileEnvelope(val data: ProfileBody)

@Serializable
private data class InterestsEnvelope(val data: List<InterestBody>)

@Serializable
private data class ProfileBody(
    @SerialName("user_id") val userId: String,
    @SerialName("display_name") val displayName: String,
    @SerialName("avatar_url") val avatarUrl: String? = null,
    val language: String,
    val region: String,
    val interests: List<InterestBody> = emptyList(),
)

@Serializable
private data class InterestBody(
    val id: String,
    val label: String,
)

@Serializable
private data class UpdateProfileBody(
    @SerialName("display_name") val displayName: String,
    @SerialName("avatar_url") val avatarUrl: String? = null,
    val language: String,
    val region: String,
    @SerialName("interest_ids") val interestIds: List<String>,
)

private fun ProfileBody.toDomain() = UserProfile(
    userId = userId,
    displayName = displayName,
    avatarUrl = avatarUrl,
    language = language,
    region = region,
    interests = interests.map { it.toDomain() },
)

private fun InterestBody.toDomain() = ProfileInterest(id = id, label = label)

internal fun parseAgeAssuranceStatus(raw: String): AgeAssuranceStatus = when (raw) {
    "NOT_STARTED" -> AgeAssuranceStatus.NOT_STARTED
    "PENDING" -> AgeAssuranceStatus.PENDING
    "APPROVED" -> AgeAssuranceStatus.APPROVED
    "REJECTED" -> AgeAssuranceStatus.REJECTED
    else -> AgeAssuranceStatus.UNKNOWN
}

internal fun buildProfileUpdateRequestBody(
json: Json, draft: ProfileDraft): String =
    json.encodeToString(
        UpdateProfileBody(
            displayName = draft.displayName,
            avatarUrl = draft.avatarUrl.trim().ifEmpty { null },
            language = draft.language,
            region = draft.region,
            interestIds = draft.interestIds.toList(),
        ),
    )
