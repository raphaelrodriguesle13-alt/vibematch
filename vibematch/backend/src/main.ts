import { env } from './config/env';
import { ChatService } from './features/chat/chat-service';
import { createHttpServer } from './http/server';
import { OpenAiChatGptProvider } from './shared/providers/openai';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

const provider = new OpenAiChatGptProvider({
  apiKey: env.openAiApiKey(),
  baseUrl: env.openAiBaseUrl,
  model: env.openAiModel,
  timeoutMs: env.openAiTimeoutMs,
});
const chatService = new ChatService(provider);
const server = createHttpServer(chatService);

server.listen(port, () => {
  console.warn(`VibeMatch backend listening on port ${port}`);
});

function shutdown(signal: string): void {
  console.warn(`Received ${signal}; shutting down`);
  server.close((error) => {
    if (error) {
      console.error('Server shutdown failed', error);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
