package com.vibematch.app

import com.vibematch.app.moderation.Block
import com.vibematch.app.moderation.ModerationApiException
import com.vibematch.app.moderation.ModerationGateway
import com.vibematch.app.moderation.ModerationViewModel
import com.vibematch.app.moderation.Report
import com.vibematch.app.moderation.ReportCategory
import com.vibematch.app.moderation.ReportSeverity
import com.vibematch.app.moderation.ReportStatus
import com.vibematch.app.moderation.buildBlockRequestBody
import com.vibematch.app.moderation.buildReportRequestBody
import com.vibematch.app.moderation.parseReportSeverity
import com.vibematch.app.moderation.parseReportStatus
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ModerationTest {
    private val dispatcher = UnconfinedTestDispatcher()
    private val json = Json { ignoreUnknownKeys = true }
    private lateinit var gateway: FakeModerationGateway

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        gateway = FakeModerationGateway()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `serializes block and report requests using public snake case contract`() {
        val block = json.parseToJsonElement(
            buildBlockRequestBody(json, "target-user"),
        ).jsonObject
        val report = json.parseToJsonElement(
            buildReportRequestBody(
                json,
                reportedId = "target-user",
                sessionId = "video-session",
                category = ReportCategory.HARASSMENT,
            ),
        ).jsonObject

        assertEquals("target-user", block.getValue("blocked_id").jsonPrimitive.content)
        assertEquals("target-user", report.getValue("reported_id").jsonPrimitive.content)
        assertEquals("video-session", report.getValue("session_id").jsonPrimitive.content)
        assertEquals("HARASSMENT", report.getValue("category").jsonPrimitive.content)
    }

    @Test
    fun `unknown moderation states fail closed`() {
        assertEquals(ReportSeverity.UNKNOWN, parseReportSeverity("FUTURE"))
        assertEquals(ReportStatus.UNKNOWN, parseReportStatus("FUTURE"))
    }

    @Test
    fun `blocks target only after server confirms action`() = runTest {
        var closed = false
        val viewModel = ModerationViewModel(
            gateway = gateway,
            accessTokenProvider = { "session-jwt" },
            onBlocked = { closed = true },
        )

        viewModel.block("target-user")

        assertEquals("target-user", gateway.lastBlockedId)
        assertTrue(viewModel.state.value.blockCompleted)
        assertTrue(closed)
        assertFalse(viewModel.state.value.isBlocking)
    }

    @Test
    fun `reports selected category and optional session to backend`() = runTest {
        val viewModel = ModerationViewModel(gateway, { "session-jwt" })
        viewModel.selectCategory(ReportCategory.SCAM)

        viewModel.report("target-user", "video-session")

        assertEquals("target-user", gateway.lastReportedId)
        assertEquals("video-session", gateway.lastSessionId)
        assertEquals(ReportCategory.SCAM, gateway.lastCategory)
        assertTrue(viewModel.state.value.reportCompleted)
    }

    @Test
    fun `returns to authentication on expired moderation session`() = runTest {
        var expired = false
        gateway.blockError = ModerationApiException(401, "UNAUTHORIZED", "expired")
        val viewModel = ModerationViewModel(
            gateway = gateway,
            accessTokenProvider = { "session-jwt" },
            onSessionExpired = { expired = true },
        )

        viewModel.block("target-user")

        assertTrue(expired)
        assertTrue(viewModel.state.value.sessionExpired)
        assertFalse(viewModel.state.value.blockCompleted)
    }

    @Test
    fun `maps rate limit as a recoverable public error`() = runTest {
        gateway.reportError = ModerationApiException(429, "RATE_LIMITED", "too many")
        val viewModel = ModerationViewModel(gateway, { "session-jwt" })

        viewModel.report("target-user")

        assertEquals(
            "Muitas solicitações de moderação. Aguarde antes de tentar novamente.",
            viewModel.state.value.errorMessage,
        )
        assertFalse(viewModel.state.value.reportCompleted)
    }

    private class FakeModerationGateway : ModerationGateway {
        var lastBlockedId: String? = null
        var lastReportedId: String? = null
        var lastSessionId: String? = null
        var lastCategory: ReportCategory? = null
        var blockError: Exception? = null
        var reportError: Exception? = null

        override suspend fun block(accessToken: String, blockedId: String): Block {
            blockError?.let { throw it }
            lastBlockedId = blockedId
            return Block(
                id = "block-1",
                blockerId = "current-user",
                blockedId = blockedId,
                createdAt = Instant.parse("2026-08-26T18:00:00Z"),
            )
        }

        override suspend fun report(
            accessToken: String,
            reportedId: String,
            sessionId: String?,
            category: ReportCategory,
        ): Report {
            reportError?.let { throw it }
            lastReportedId = reportedId
            lastSessionId = sessionId
            lastCategory = category
            return Report(
                id = "report-1",
                reporterId = "current-user",
                reportedId = reportedId,
                sessionId = sessionId,
                category = category,
                severity = ReportSeverity.HIGH,
                status = ReportStatus.OPEN,
                createdAt = Instant.parse("2026-08-26T18:00:00Z"),
            )
        }
    }
}
