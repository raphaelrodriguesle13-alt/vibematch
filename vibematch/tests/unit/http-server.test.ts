import { request as httpRequest, type AddressInfo, type Server } from 'node:http';

import { ChatService } from '../../backend/src/features/chat/chat-service';
import { createHttpServer } from '../../backend/src/http/server';
import { ChatGptProviderError } from '../../backend/src/shared/providers/openai';
import type {
  ChatGptGenerateParams,
  ChatGptGenerateResult,
  ChatGptProvider,
} from '../../backend/src/shared/providers';

class FakeChatGptProvider implements ChatGptProvider {
  constructor(private readonly result?: ChatGptGenerateResult) {}

  async generate(_params: ChatGptGenerateParams): Promise<ChatGptGenerateResult> {
    if (!this.result) {
      throw new ChatGptProviderError('timeout', 'timeout');
    }
    return this.result;
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function sendRequest(
  port: number,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ statusCode: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const requestOptions = {
      hostname: '127.0.0.1',
      port,
      method,
      path,
      ...(payload
        ? {
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
            },
          }
        : {}),
    };
    const request = httpRequest(requestOptions, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        resolve({
          statusCode: response.statusCode ?? 0,
          json: JSON.parse(rawBody),
        });
      });
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

describe('HTTP server', () => {
  test('returns health status', async () => {
    const server = createHttpServer(
      new ChatService(
        new FakeChatGptProvider({ id: 'unused', model: 'test', text: 'unused' }),
      ),
    );
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      await expect(sendRequest(port, 'GET', '/health')).resolves.toEqual({
        statusCode: 200,
        json: { status: 'ok' },
      });
    } finally {
      await closeServer(server);
    }
  });

  test('returns chat data for a valid request', async () => {
    const server = createHttpServer(
      new ChatService(
        new FakeChatGptProvider({
          id: 'resp_test',
          model: 'gpt-test',
          text: 'Olá do teste',
        }),
      ),
    );
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      await expect(
        sendRequest(port, 'POST', '/api/chat', { message: 'Oi' }),
      ).resolves.toEqual({
        statusCode: 200,
        json: {
          data: {
            requestId: 'resp_test',
            model: 'gpt-test',
            text: 'Olá do teste',
          },
        },
      });
    } finally {
      await closeServer(server);
    }
  });

  test('returns stable public errors for invalid requests and provider timeouts', async () => {
    const server = createHttpServer(new ChatService(new FakeChatGptProvider()));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      await expect(sendRequest(port, 'POST', '/api/chat', { message: ' ' })).resolves.toEqual({
        statusCode: 400,
        json: {
          error: {
            code: 'INVALID_REQUEST',
            message: 'message must not be empty',
          },
        },
      });
      await expect(sendRequest(port, 'POST', '/api/chat', { message: 'Oi' })).resolves.toEqual({
        statusCode: 504,
        json: {
          error: {
            code: 'CHAT_PROVIDER_TIMEOUT',
            message: 'The chat provider did not respond in time',
          },
        },
      });
    } finally {
      await closeServer(server);
    }
  });
});
