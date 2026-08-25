import {
  ChatGptProviderError,
  type HttpFetch,
  OpenAiChatGptProvider,
} from '../../backend/src/shared/providers/openai';

function response(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(payload),
  };
}

describe('OpenAiChatGptProvider', () => {
  test('sends a Responses API request and extracts output_text', async () => {
    let receivedUrl = '';
    let receivedInit: Parameters<HttpFetch>[1] | undefined;
    const fetchImpl: HttpFetch = (url, init) => {
      receivedUrl = url;
      receivedInit = init;
      return Promise.resolve(
        response(200, {
          id: 'resp_123',
          model: 'gpt-test',
          output_text: '  Olá!  ',
        }),
      );
    };
    const provider = new OpenAiChatGptProvider({
      apiKey: 'secret-for-test',
      baseUrl: 'https://api.openai.test/v1/',
      model: 'gpt-test',
      timeoutMs: 1000,
      fetchImpl,
    });

    await expect(
      provider.generate({
        messages: [
          { role: 'developer', content: 'Be concise.' },
          { role: 'user', content: 'Oi' },
        ],
      }),
    ).resolves.toEqual({ id: 'resp_123', model: 'gpt-test', text: 'Olá!' });

    expect(receivedUrl).toBe('https://api.openai.test/v1/responses');
    expect(receivedInit?.method).toBe('POST');
    expect(receivedInit?.headers.Authorization).toBe('Bearer secret-for-test');
    expect(JSON.parse(receivedInit?.body ?? '{}')).toEqual({
      model: 'gpt-test',
      input: [
        {
          role: 'developer',
          content: [{ type: 'input_text', text: 'Be concise.' }],
        },
        { role: 'user', content: [{ type: 'input_text', text: 'Oi' }] },
      ],
    });
  });

  test('falls back to output content when output_text is absent', async () => {
    const fetchImpl: HttpFetch = () =>
      Promise.resolve(
        response(200, {
          id: 'resp_456',
          output: [
            { type: 'message', content: [{ type: 'output_text', text: 'Parte 1' }] },
            { type: 'message', content: [{ type: 'output_text', text: ' e parte 2' }] },
          ],
        }),
      );
    const provider = new OpenAiChatGptProvider({
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.test/v1',
      model: 'gpt-test',
      timeoutMs: 1000,
      fetchImpl,
    });

    await expect(
      provider.generate({ messages: [{ role: 'user', content: 'Oi' }] }),
    ).resolves.toEqual({
      id: 'resp_456',
      model: 'gpt-test',
      text: 'Parte 1 e parte 2',
    });
  });

  test('maps upstream failures without exposing the API key', async () => {
    const fetchImpl: HttpFetch = () =>
      Promise.resolve(response(429, { error: { message: 'rate limited' } }));
    const provider = new OpenAiChatGptProvider({
      apiKey: 'never-return-this-key',
      baseUrl: 'https://api.openai.test/v1',
      model: 'gpt-test',
      timeoutMs: 1000,
      fetchImpl,
    });

    await expect(
      provider.generate({ messages: [{ role: 'user', content: 'Oi' }] }),
    ).rejects.toMatchObject({ kind: 'upstream', statusCode: 429 });
    await expect(
      provider.generate({ messages: [{ role: 'user', content: 'Oi' }] }),
    ).rejects.not.toThrow('never-return-this-key');
  });

  test('maps an aborted request to a timeout error', async () => {
    const fetchImpl: HttpFetch = async (_url, init) => {
      await new Promise<void>((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
      return response(200, {});
    };
    const provider = new OpenAiChatGptProvider({
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.test/v1',
      model: 'gpt-test',
      timeoutMs: 1,
      fetchImpl,
    });

    await expect(
      provider.generate({ messages: [{ role: 'user', content: 'Oi' }] }),
    ).rejects.toMatchObject<Partial<ChatGptProviderError>>({ kind: 'timeout' });
  });
});
