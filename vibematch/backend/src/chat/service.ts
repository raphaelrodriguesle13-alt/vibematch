import type { ChatGptMessage, ChatGptProvider, ChatGptGenerateResult } from '../shared/providers';

export const MAX_CHAT_MESSAGE_LENGTH = 4_000;
export const MAX_CHAT_HISTORY_ITEMS = 20;

const DEFAULT_DEVELOPER_INSTRUCTION = [
  'Você é o assistente do VibeMatch. Responda em português brasileiro, seja claro, ' +
    'respeitoso e conciso.',
  'Nunca peça senhas, tokens, documentos ou dados financeiros.',
  'Não afirme ter executado ações fora desta conversa.',
].join(' ');

export interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  message: string;
  history?: ChatHistoryItem[];
}

export interface ChatResponse {
  requestId: string;
  model: string;
  text: string;
}

export class ChatRequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatRequestValidationError';
  }
}

function validateContent(content: string, field: string): string {
  const normalized = content.trim();
  if (!normalized) {
    throw new ChatRequestValidationError(`${field} must not be empty`);
  }
  if (normalized.length > MAX_CHAT_MESSAGE_LENGTH) {
    throw new ChatRequestValidationError(`${field} exceeds ${MAX_CHAT_MESSAGE_LENGTH} characters`);
  }
  return normalized;
}

function validateRequest(request: ChatRequest): ChatRequest {
  if (!request || typeof request.message !== 'string') {
    throw new ChatRequestValidationError('message must be a string');
  }

  if (request.history !== undefined) {
    if (!Array.isArray(request.history)) {
      throw new ChatRequestValidationError('history must be an array');
    }
    if (request.history.length > MAX_CHAT_HISTORY_ITEMS) {
      throw new ChatRequestValidationError(
        `history cannot contain more than ${MAX_CHAT_HISTORY_ITEMS} items`,
      );
    }

    for (const [index, item] of request.history.entries()) {
      if (
        !item ||
        (item.role !== 'user' && item.role !== 'assistant') ||
        typeof item.content !== 'string'
      ) {
        throw new ChatRequestValidationError(
          `history[${index}] must contain a valid role and content`,
        );
      }
      validateContent(item.content, `history[${index}].content`);
    }
  }

  const normalizedHistory = request.history?.map((item) => ({
    role: item.role,
    content: item.content.trim(),
  }));

  return {
    message: validateContent(request.message, 'message'),
    ...(normalizedHistory === undefined ? {} : { history: normalizedHistory }),
  };
}

function toProviderMessages(request: ChatRequest): ChatGptMessage[] {
  const history = request.history ?? [];
  return [
    { role: 'developer', content: DEFAULT_DEVELOPER_INSTRUCTION },
    ...history,
    { role: 'user', content: request.message },
  ];
}

export class ChatService {
  constructor(private readonly provider: ChatGptProvider) {}

  async respond(request: ChatRequest): Promise<ChatResponse> {
    const validRequest = validateRequest(request);
    const result: ChatGptGenerateResult = await this.provider.generate({
      messages: toProviderMessages(validRequest),
    });

    return {
      requestId: result.id,
      model: result.model,
      text: result.text,
    };
  }
}
