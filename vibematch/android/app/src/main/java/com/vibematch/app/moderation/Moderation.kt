package com.vibematch.app.moderation

import java.io.IOException
import java.time.Instant
import java.util.concurrent.TimeUnit
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

enum class ReportCategory {
    HARASSMENT,
    HATE,
    SEXUAL_CONTENT,
    SCAM,
    SPAM,
    OTHER,
}

enum class ReportSeverity {
    LOW,
    MEDIUM,
    HIGH,
    CRITICAL,
    UNKNOWN,
}

enum class ReportStatus {
    OPEN,
    IN_REVIEW,
    RESOLVED,
    ESCALATED,
    UNKNOWN,
}

data class Block(
    val id: String,
    val blockerId: String,
    val blockedId: String,
    val createdAt: Instant,
)

data class Report(
    val id: String,
    val reporterId: String,
    val reportedId: String,
    val sessionId: String?,
    val category: ReportCategory,
    val severity: ReportSeverity,
    val status: ReportStatus,
    val createdAt: Instant,
)

interface ModerationGateway {
    suspend fun block(accessToken: String, blockedId: String): Block
    suspend fun report(
        accessToken: String,
        reportedId: String,
        sessionId: String?,
        category: ReportCategory,
    ): Report
}

class ModerationApiException(
    val statusCode: Int,
    val errorCode: String?,
    message: String,
) : IOException(message)

class ModerationApiClient(
    baseUrl: String,
    private val httpClient: OkHttpClient = defaultHttpClient(),
) : ModerationGateway {
    private val baseUrl = baseUrl.trimEnd('/')
    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun block(accessToken: String, blockedId: String): Block {
        val body = buildBlockRequestBody(json, blockedId)
            .toRequestBody(JSON_MEDIA_TYPE)
        val response = execute(
            Request.Builder()
                .url("$baseUrl/api/blocks")
                .header("Authorization", "Bearer $accessToken")
                .header("Accept", "application/json")
                .post(body)
                .build(),
        )
        return response.use { parseBlockResponse(it) }
    }

    override suspend fun report(
        accessToken: String,
        reportedId: String,
        sessionId: String?,
        category: ReportCategory,
    ): Report {
        val body = buildReportRequestBody(json, reportedId, sessionId, category)
            .toRequestBody(JSON_MEDIA_TYPE)
        val response = execute(
            Request.Builder()
                .url("$baseUrl/api/reports")
                .header("Authorization", "Bearer $accessToken")
                .header("Accept", "application/json")
                .post(body)
                .build(),
        )
        return response.use { parseReportResponse(it) }
    }

    private suspend fun execute(request: Request) = withContext(Dispatchers.IO) {
        httpClient.newCall(request).execute()
    }

    private fun parseBlockResponse(response: okhttp3.Response): Block {
        val body = response.body?.string().orEmpty()
        ensureSuccess(response.code, response.isSuccessful, body)
        return try {
            val data = json.decodeFromString<BlockResponse>(body).data
            Block(
                id = data.id,
                blockerId = data.blockerId,
                blockedId = data.blockedId,
                createdAt = Instant.parse(data.createdAt),
            )
        } catch (error: ModerationApiException) {
            throw error
        } catch (_: Exception) {
            throw invalidResponse(response.code)
        }
    }

    private fun parseReportResponse(response: okhttp3.Response): Report {
        val body = response.body?.string().orEmpty()
        ensureSuccess(response.code, response.isSuccessful, body)
        return try {
            val data = json.decodeFromString<ReportResponse>(body).data
            Report(
                id = data.id,
                reporterId = data.reporterId,
                reportedId = data.reportedId,
                sessionId = data.sessionId,
                category = parseReportCategory(data.category),
                severity = parseReportSeverity(data.severity),
                status = parseReportStatus(data.status),
                createdAt = Instant.parse(data.createdAt),
            )
        } catch (error: ModerationApiException) {
            throw error
        } catch (_: Exception) {
            throw invalidResponse(response.code)
        }
    }

    private fun ensureSuccess(statusCode: Int, successful: Boolean, body: String) {
        if (successful) return
        val errorCode = runCatching {
            json.parseToJsonElement(body).jsonObject["error"]?.jsonPrimitive?.contentOrNull
        }.getOrNull()
        throw ModerationApiException(statusCode, errorCode, publicError(statusCode, errorCode))
    }

    private fun invalidResponse(statusCode: Int) = ModerationApiException(
        statusCode,
        "INVALID_RESPONSE",
        "A resposta de moderação era inválida.",
    )

    private fun publicError(statusCode: Int, errorCode: String?): String = when {
        statusCode == 401 -> "Sua sessão expirou. Entre novamente para continuar."
        statusCode == 429 -> "Muitas solicitações de moderação. Aguarde antes de tentar novamente."
        errorCode == "BLOCK_NOT_AVAILABLE" -> "Não foi possível bloquear esta conta agora."
        errorCode == "REPORT_NOT_AVAILABLE" -> "Não foi possível registrar a denúncia agora."
        errorCode == "INVALID_MODERATION_REQUEST" -> "Os dados de moderação são inválidos."
        statusCode >= 500 -> "A moderação está temporariamente indisponível."
        else -> "Não foi possível concluir esta ação agora."
    }

    private companion object {
        val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

        fun defaultHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .build()
    }
}

@Serializable
private data class BlockResponse(
    val data: BlockBody,
)

@Serializable
private data class BlockBody(
    val id: String,
    @SerialName("blocker_id") val blockerId: String,
    @SerialName("blocked_id") val blockedId: String,
    @SerialName("created_at") val createdAt: String,
)

@Serializable
private data class ReportResponse(
    val data: ReportBody,
)

@Serializable
private data class ReportBody(
    val id: String,
    @SerialName("reporter_id") val reporterId: String,
    @SerialName("reported_id") val reportedId: String,
    @SerialName("session_id") val sessionId: String? = null,
    val category: String,
    val severity: String,
    val status: String,
    @SerialName("created_at") val createdAt: String,
)

@Serializable
private data class BlockRequest(
    @SerialName("blocked_id") val blockedId: String,
)

@Serializable
private data class ReportRequest(
    @SerialName("reported_id") val reportedId: String,
    @SerialName("session_id") val sessionId: String? = null,
    val category: String,
)

internal fun buildBlockRequestBody(json: Json, blockedId: String): String =
    json.encodeToString(BlockRequest(blockedId))

internal fun buildReportRequestBody(
    json: Json,
    reportedId: String,
    sessionId: String?,
    category: ReportCategory,
): String = json.encodeToString(
    ReportRequest(
        reportedId = reportedId,
        sessionId = sessionId,
        category = category.name,
    ),
)

internal fun parseReportCategory(value: String): ReportCategory = when (value) {
    "HARASSMENT" -> ReportCategory.HARASSMENT
    "HATE" -> ReportCategory.HATE
    "SEXUAL_CONTENT" -> ReportCategory.SEXUAL_CONTENT
    "SCAM" -> ReportCategory.SCAM
    "SPAM" -> ReportCategory.SPAM
    "OTHER" -> ReportCategory.OTHER
    else -> ReportCategory.OTHER
}

internal fun parseReportSeverity(value: String): ReportSeverity = when (value) {
    "LOW" -> ReportSeverity.LOW
    "MEDIUM" -> ReportSeverity.MEDIUM
    "HIGH" -> ReportSeverity.HIGH
    "CRITICAL" -> ReportSeverity.CRITICAL
    else -> ReportSeverity.UNKNOWN
}

internal fun parseReportStatus(value: String): ReportStatus = when (value) {
    "OPEN" -> ReportStatus.OPEN
    "IN_REVIEW" -> ReportStatus.IN_REVIEW
    "RESOLVED" -> ReportStatus.RESOLVED
    "ESCALATED" -> ReportStatus.ESCALATED
    else -> ReportStatus.UNKNOWN
}
