# Integração com ChatGPT

## Escopo implementado

O backend agora possui um adaptador próprio para a **OpenAI Responses API** e um endpoint HTTP mínimo para o futuro cliente Android. A aplicação não importa SDK de fornecedor no domínio: `ChatService` depende somente do contrato `ChatGptProvider`, enquanto `OpenAiChatGptProvider` concentra a comunicação externa.

A chave permanece exclusivamente no processo do backend. O cliente nunca deve receber `OPENAI_API_KEY`, chamar a OpenAI diretamente ou decidir o modelo usado pelo servidor.

## Configuração local

Copie o arquivo de exemplo e preencha a chave apenas no arquivo local:

```bash
cp .env.example .env
# edite OPENAI_API_KEY no .env; não faça commit desse arquivo
```

Os valores opcionais são `OPENAI_BASE_URL`, `OPENAI_MODEL` e `OPENAI_TIMEOUT_MS`. O valor padrão do endpoint é `https://api.openai.com/v1`, o modelo padrão é `gpt-5.6` e o timeout padrão é de 30 segundos. Em produção, o projeto deve resolver o segredo por um gerenciador de segredos, sem armazená-lo no repositório.

## Executar o backend

Após instalar as dependências do projeto:

```bash
npm run build
NODE_ENV=development PORT=3000 npm start
```

O health check não chama o fornecedor:

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

## Contrato HTTP

### `POST /api/chat`

Entrada mínima:

```json
{
  "message": "Como funciona o VibeMatch?"
}
```

Entrada com histórico limitado:

```json
{
  "message": "E como o consentimento é tratado?",
  "history": [
    { "role": "user", "content": "Explique o produto." },
    { "role": "assistant", "content": "O VibeMatch conecta pessoas por interesses." }
  ]
}
```

Resposta de sucesso:

```json
{
  "data": {
    "requestId": "resp_...",
    "model": "gpt-5.6",
    "text": "..."
  }
}
```

O backend aceita no máximo 4.000 caracteres na mensagem atual e em cada item do histórico, além de 20 itens de histórico. O corpo HTTP inteiro é limitado a 128 KiB.
O servidor acrescenta a instrução de desenvolvedor controlada pelo backend e não aceita que o cliente injete papéis `system` ou `developer` no histórico.

| Situação | HTTP | Código público |
|---|---:|---|
| JSON inválido | 400 | `INVALID_JSON` |
| Corpo ou mensagem inválida | 400 | `INVALID_REQUEST` |
| Corpo acima do limite | 413 | `PAYLOAD_TOO_LARGE` |
| Fornecedor excedeu o timeout | 504 | `CHAT_PROVIDER_TIMEOUT` |
| Falha ou resposta inválida do fornecedor | 502 | `CHAT_PROVIDER_UNAVAILABLE` |
| Rota inexistente | 404 | `NOT_FOUND` |

As mensagens públicas de erro não incluem a chave, o corpo enviado ao fornecedor ou detalhes sensíveis de configuração. Detalhes operacionais ficam apenas nos logs server-side.

## Próxima etapa do app

O cliente Android deve chamar apenas o backend autenticado, persistir localmente o mínimo necessário e enviar o token de autenticação conforme o contrato de sessão que será implementado na Etapa 2. A integração atual não substitui autenticação, autorização, rate limiting, observabilidade ou persistência de conversas; esses itens continuam sendo etapas posteriores do Blueprint V1.2.

## Fontes oficiais

A implementação segue a [visão geral da Responses API](https://developers.openai.com/api/reference/responses/overview) e o [guia oficial de início rápido para Node.js](https://developers.openai.com/api/docs/quickstart).
