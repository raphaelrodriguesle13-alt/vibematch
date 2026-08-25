# Notas de integração com a OpenAI

A documentação oficial consultada em 25/08/2026 confirma que a Responses API é a interface atual para gerar respostas de modelos, aceita entradas de texto e imagem, produz texto e pode manter estado ou usar ferramentas. Para Node.js server-side, o quickstart oficial usa o SDK `openai`, a variável `OPENAI_API_KEY` no ambiente e `client.responses.create({ model, input })`, lendo o resultado em `response.output_text`.

Fontes consultadas:

- https://developers.openai.com/api/reference/responses/overview
- https://developers.openai.com/api/docs/quickstart

Decisão para este repositório: manter a chave exclusivamente no backend, encapsular o fornecedor atrás de uma interface própria em `backend/src/shared/providers`, usar timeout e tratamento explícito de erros, e não colocar a chave no cliente Android ou em commits.
