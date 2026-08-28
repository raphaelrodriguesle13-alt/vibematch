package com.vibematch.app.account

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

private val Destructive = Color(0xFF9E2D2D)

@Composable
fun AccountDeletionAction(
    viewModel: AccountDeletionViewModel,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state
    var showConfirmation by remember { mutableStateOf(false) }

    Column(modifier = modifier) {
        state.errorMessage?.let { error ->
            Text(
                text = error,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp),
                style = MaterialTheme.typography.bodySmall,
                color = Destructive,
            )
        }
        TextButton(
            onClick = { showConfirmation = true },
            enabled = !state.isDeleting,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                if (state.isDeleting) "Solicitando exclusão…" else "Excluir conta",
                color = Destructive,
            )
        }
    }

    if (showConfirmation) {
        AlertDialog(
            onDismissRequest = {
                if (!state.isDeleting) showConfirmation = false
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
                        showConfirmation = false
                        viewModel.requestDeletion()
                    },
                    enabled = !state.isDeleting,
                ) {
                    Text("Excluir conta", color = Destructive)
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { showConfirmation = false },
                    enabled = !state.isDeleting,
                ) {
                    Text("Cancelar")
                }
            },
        )
    }
}
