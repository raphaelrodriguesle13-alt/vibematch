import type { AuthSession } from '../../backend/src/auth/repository';
import { ChatService } from '../../backend/src/chat/service';
import {
  type ChatGptGenerateParams,
  type ChatGptGenerateResult,
  type ChatGptProvider,
  type SessionTokenClaims,
  type SessionTokenVerifier,
} from '../../backend/src/shared/providers';
import { ChatGptProviderError } from '../../backend/src/shared/providers/openai';
import {
  buildApp,
  type ActiveSessionStore,
  type AuthHttpDependencies,
} from '../../backend/src/http/app';

class FakeChatProvider implements ChatGptProvider {
  public calls: ChatGptGenerateParams[] = [];
  public error: ChatGptProviderError | null = null;

  generate(params: ChatGptGenerateParams): Promise<ChatGptGenerateResult> {
    this.calls.push(params);
    if (this.error) return Promise.reject(this.error);
    return Promise.resolve({ id: 'resp_test', model: 'gpt-test', text: 'Resposta do chat' });
  }
}

class FakeSessionTokenVerifier implements SessionTokenVerifier {
  public token: string | null = null;

  verify(token: string): Promise<SessionTokenClaims> {
    this.token = token;
    return Promise.resolve({ userId: 'user-1', sessionId: 'session-1', phoneVerified: true });
  }
}

class FakeActiveSessionStore implements ActiveSessionStore {
  public touched: { userId: string; sessionId: string } | null = null;
  private readonly session: AuthSession = {
    id: 'session-1',
    userId: 'user-1',
    expiresAt: new Date('2026-08-26T00:00:00.000Z'),
    revokedAt: null,
  };

  findActiveSession(): Promise<AuthSession> {
    return Promise.resolve(this.session);
  }

  touchSession(userId: string, sessionId: string): Promise<void> {
    this.touched = { userId, sessionId };
    return Promise.resolve();
  }
}

function createSubject(chatService: ChatService) {
  const verifier = new FakeSessionTokenVerifier();
  const sessionStore = new FakeActiveSessionStore();
  const deps: AuthHttpDependencies = {
    authService: {
      loginWithGoogle: () => Promise.reject(new Error('not used in chat tests')),
      logout: () => Promise.resolve({ ok: true }),
    },
    sessionTokenVerifier: verifier,
    activeSessionStore: sessionStore,
    chatService,
  };
  return { app: buildApp(deps), verifier, sessionStore };
}

describe('Authenticated chat HTTP API', () => {
  test('requires a valid session before calling ChatGPT', async () => {
    const provider = new FakeChatProvider();
    const { app } = createSubject(new ChatService(provider));

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { message: 'Oi' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'UNAUTHORIZED' });
    expect(provider.calls).toHaveLength(0);
    await app.close();
  });

  test('authenticates, forwards the request and returns the chat response', async () => {
    const provider = new FakeChatProvider();
    const { app, verifier, sessionStore } = createSubject(new ChatService(provider));

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { authorization: 'Bearer session-jwt' },
      payload: {
        message: '  Como funciona? ',
        history: [{ role: 'assistant', content: 'Posso ajudar.' }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        request_id: 'resp_test',
        model: 'gpt-test',
        text: 'Resposta do chat',
      },
    });
    expect(verifier.token).toBe('session-jwt');
    expect(sessionStore.touched).toEqual({ userId: 'user-1', sessionId: 'session-1' });
    expect(provider.calls[0]?.messages.at(-1)).toEqual({
      role: 'user',
      content: 'Como funciona?',
    });
    await app.close();
  });

  test('maps validation and timeout errors to stable public errors', async () => {
    const provider = new FakeChatProvider();
    const subject = createSubject(new ChatService(provider));

    const invalid = await subject.app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { authorization: 'Bearer session-jwt' },
      payload: { message: ' ' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: 'INVALID_REQUEST' });

    provider.error = new ChatGptProviderError('timeout', 'timeout');
    const timeout = await subject.app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: { authorization: 'Bearer session-jwt' },
      payload: { message: 'Oi' },
    });
    expect(timeout.statusCode).toBe(504);
    expect(timeout.json()).toEqual({ error: 'CHAT_PROVIDER_TIMEOUT' });
    await subject.app.close();
  });
});
