import { env } from '../config/env';
import { ChatService } from './service';
import { OpenAiChatGptProvider } from '../shared/providers/openai';

export function createChatService(): ChatService {
  return new ChatService(
    new OpenAiChatGptProvider({
      apiKey: env.openAiApiKey(),
      baseUrl: env.openAiBaseUrl,
      model: env.openAiModel,
      timeoutMs: env.openAiTimeoutMs,
    }),
  );
}
