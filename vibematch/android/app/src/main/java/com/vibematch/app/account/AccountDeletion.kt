package com.vibematch.app.account

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

enum class AccountDeletionStatus {
    PENDING_DELETION,
    DELETED,
}

class AccountDeletionApiException(
    val statusCode: Int,
    message: String,
) : IOException(message)

interface AccountDeletionGateway {
    suspend fun requestDeletion(accessToken: String): AccountDeletionStatus
}

class AccountDeletionApiClient(
    baseUrl: String,
    private val httpClient: OkHttpClient = defaultHttpClient(),
) : AccountDeletionGateway {
    private val baseUrl = baseUrl.trimEnd('/')

    override suspend fun requestDeletion(accessToken: String): AccountDeletionStatus {
        val request = Request.Builder()
            .url("$baseUrl/api/account")
            .header("Authorization", "Bearer $accessToken")
            .header("Accept", "application/json")
            .delete()
            .build()
        val response = withContext(Dispatchers.IO) {
            httpClient.newCall(request).execute()
        }
        response.use {
            if (!it.isSuccessful) {
                throw AccountDeletionApiException(it.code, publicDeletionError(it.code))
            }
            return when (it.code) {
                202 -> AccountDeletionStatus.PENDING_DELETION
                200, 204 -> AccountDeletionStatus.DELETED
                else -> throw AccountDeletionApiException(
                    it.code,
                    "A resposta de exclusão da conta foi inválida.",
                )
            }
        }
    }

    private fun publicDeletionError(statusCode: Int): String = when (statusCode) {
        401 -> "Sua sessão expirou. Entre novamente para excluir a conta."
        403 -> "Esta conta não pode solicitar exclusão por este caminho."
        429 -> "Muitas solicitações. Aguarde antes de tentar novamente."
        else -> "Não foi possível solicitar a exclusão da conta agora."
    }

    private companion object {
        fun defaultHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .build()
    }
}
