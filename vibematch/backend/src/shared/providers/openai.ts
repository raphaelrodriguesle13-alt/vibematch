import type { ChatGptGenerateParams, ChatGptGenerateResult, ChatGptProvider } from './index';

export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface HttpRequestInit {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}

export type HttpFetch = (url: string, init: HttpRequestInit) => Promise<HttpResponse>;

export interface OpenAiChatGptProviderOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  fetchImpl?: HttpFetch;
}

export type ChatGptProviderErrorKind =
  'configuration' | 'timeout' | 'upstream' | 'invalid_response';

export class ChatGptProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: ChatGptProviderErrorKind,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'ChatGptProviderError';
  }
}

type ResponsesApiPayload = {
  id?: unknown;
  model?: unknown;
  output_text?: unknown;
  output?: unknown;
  error?: { message?: unknown };
};

const realFetch: HttpFetch = async (url, init) => {
  const response = await fetch(url, init);
  return {
    ok: response.ok,
    status: response.status,
    json: () => response.json(),
  };
};

function asPayload(value: unknown): ResponsesApiPayload {
  if (!value || typeof value !== 'object') return {};
  return value;
}

function extractText(payload: ResponsesApiPayload): string {
  if (typeof payload.output_text === 'string') return payload.output_text.trim();
  if (!Array.isArray(payload.output)) return '';

  const textParts: string[] = [];
  for (const item of payload.output) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === 'string') textParts.push(text);
    }
  }

  return textParts.join('').trim();
}

function upstreamMessage(payload: ResponsesApiPayload): string {
  const message = payload.error?.message;
  return typeof message === 'string' && message.trim() !== ''
    ? message
    : 'OpenAI upstream request failed';
}

export class OpenAiChatGptProvider implements ChatGptProvider {
  private readonly fetchImpl: HttpFetch;

  constructor(private readonly options: OpenAiChatGptProviderOptions) {
    if (!options.apiKey.trim()) {
      throw new ChatGptProviderError('OPENAI_API_KEY is not configured', 'configuration');
    }
    if (!options.baseUrl.trim()) {
      throw new ChatGptProviderError('OPENAI_BASE_URL is not configured', 'configuration');
    }
    if (!options.model.trim()) {
      throw new ChatGptProviderError('OPENAI_MODEL is not configured', 'configuration');
    }
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new ChatGptProviderError(
        'OPENAI_TIMEOUT_MS must be a positive integer',
        'configuration',
      );
    }

    this.fetchImpl = options.fetchImpl ?? realFetch;
  }

  async generate(params: ChatGptGenerateParams): Promise<ChatGptGenerateResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const url = `${this.options.baseUrl.replace(/\/+$/, '')}/responses`;
    const body = JSON.stringify({
      model: this.options.model,
      input: params.messages.map((message) => ({
        role: message.role,
        content: [{ type: 'input_text', text: message.content }],
      })),
    });

    try {
      let response: HttpResponse;
      try {
        response = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            'Content-Type': 'application/json',
          },
          body,
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new ChatGptProviderError('OpenAI request timed out', 'timeout');
        }
        const cause = error instanceof Error ? error.message : 'network error';
        throw new ChatGptProviderError(`OpenAI request failed: ${cause}`, 'upstream');
      }

      let payload: ResponsesApiPayload;
      try {
        payload = asPayload(await response.json());
      } catch {
        throw new ChatGptProviderError(
          'OpenAI returned a non-JSON response',
          'invalid_response',
          response.status,
        );
      }

      if (!response.ok) {
        throw new ChatGptProviderError(upstreamMessage(payload), 'upstream', response.status);
      }

      const id = typeof payload.id === 'string' ? payload.id : '';
      const model = typeof payload.model === 'string' ? payload.model : this.options.model;
      const text = extractText(payload);
      if (!id || !text) {
        throw new ChatGptProviderError(
          'OpenAI returned an invalid response',
          'invalid_response',
          response.status,
        );
      }

      return { id, model, text };
    } finally {
      clearTimeout(timeout);
    }
  }
}
