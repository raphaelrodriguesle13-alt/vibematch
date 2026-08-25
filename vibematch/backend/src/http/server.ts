import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import {
  ChatRequestValidationError,
  ChatService,
  type ChatRequest,
} from '../features/chat/chat-service';
import { ChatGptProviderError } from '../shared/providers/openai';

const MAX_BODY_BYTES = 128 * 1024;

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    request.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        fail(new Error('request body too large'));
        return;
      }
      chunks.push(buffer);
    });

    request.on('error', (error) => fail(error));
    request.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const rawBody = Buffer.concat(chunks).toString('utf8');
        resolve(rawBody ? JSON.parse(rawBody) : {});
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
  });
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: JsonObject,
): void {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function routePath(request: IncomingMessage): string {
  const url = request.url ?? '/';
  return new URL(url, 'http://localhost').pathname;
}

function asChatRequest(value: unknown): ChatRequest {
  if (!isJsonObject(value)) {
    throw new ChatRequestValidationError('request body must be a JSON object');
  }
  return value as unknown as ChatRequest;
}

function handleError(response: ServerResponse, error: unknown): void {
  if (error instanceof ChatRequestValidationError) {
    writeJson(response, 400, {
      error: { code: 'INVALID_REQUEST', message: error.message },
    });
    return;
  }

  if (error instanceof ChatGptProviderError) {
    if (error.kind === 'timeout') {
      writeJson(response, 504, {
        error: {
          code: 'CHAT_PROVIDER_TIMEOUT',
          message: 'The chat provider did not respond in time',
        },
      });
      return;
    }

    console.error('Chat provider error', {
      kind: error.kind,
      statusCode: error.statusCode,
    });
    writeJson(response, 502, {
      error: {
        code: 'CHAT_PROVIDER_UNAVAILABLE',
        message: 'The chat provider is temporarily unavailable',
      },
    });
    return;
  }

  const message = error instanceof Error ? error.message : 'unknown error';
  if (message === 'invalid JSON body') {
    writeJson(response, 400, {
      error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' },
    });
    return;
  }
  if (message === 'request body too large') {
    writeJson(response, 413, {
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
    });
    return;
  }

  console.error('Unhandled HTTP error', error);
  writeJson(response, 500, {
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  });
}

async function handleRequest(
  chatService: ChatService,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const path = routePath(request);

    if (request.method === 'GET' && path === '/health') {
      writeJson(response, 200, { status: 'ok' });
      return;
    }

    if (request.method === 'POST' && path === '/api/chat') {
      const body = await readJsonBody(request);
      const result = await chatService.respond(asChatRequest(body));
      writeJson(response, 200, { data: result });
      return;
    }

    writeJson(response, 404, {
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    });
  } catch (error) {
    handleError(response, error);
  }
}

export function createHttpServer(chatService: ChatService): Server {
  return createServer((request, response) => {
    void handleRequest(chatService, request, response);
  });
}
