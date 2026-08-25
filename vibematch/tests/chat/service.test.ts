import {
  ChatRequestValidationError,
  ChatService,
  MAX_CHAT_HISTORY_ITEMS,
  MAX_CHAT_MESSAGE_LENGTH,
} from '../../backend/src/chat/service';
import type {
  ChatGptGenerateParams,
  ChatGptGenerateResult,
  ChatGptProvider,
} from '../../backend/src/shared/providers';

class FakeChatProvider implements ChatGptProvider {
  public calls: ChatGptGenerateParams[] = [];

  generate(params: ChatGptGenerateParams): Promise<ChatGptGenerateResult> {
    this.calls.push(params);
    return Promise.resolve({
      id: 'resp_test',
      model: 'gpt-test',
      text: 'Resposta de teste',
    });
  }
}

describe('ChatService', () => {
  test('normalizes the message and adds a controlled developer instruction', async () => {
    const provider = new FakeChatProvider();
    const service = new ChatService(provider);

    await expect(
      service.respond({
        message: '  Como funciona o VibeMatch?  ',
        history: [{ role: 'assistant', content: '  Posso ajudar. ' }],
      }),
    ).resolves.toEqual({
      requestId: 'resp_test',
      model: 'gpt-test',
      text: 'Resposta de teste',
    });

    expect(provider.calls[0]?.messages).toEqual([
      expect.objectContaining({ role: 'developer' }),
      { role: 'assistant', content: 'Posso ajudar.' },
      { role: 'user', content: 'Como funciona o VibeMatch?' },
    ]);
  });

  test.each([
    ['empty message', { message: '   ' }],
    ['missing message', {}],
    ['message with wrong type', { message: 123 }],
    ['history with wrong type', { message: 'oi', history: 'nope' }],
    [
      'history with invalid role',
      { message: 'oi', history: [{ role: 'developer', content: 'x' }] },
    ],
  ])('rejects %s', async (_label, request) => {
    const service = new ChatService(new FakeChatProvider());

    await expect(service.respond(request as never)).rejects.toBeInstanceOf(
      ChatRequestValidationError,
    );
  });

  test('rejects oversized messages and histories', async () => {
    const service = new ChatService(new FakeChatProvider());
    const oversizedMessage = 'x'.repeat(MAX_CHAT_MESSAGE_LENGTH + 1);
    const oversizedHistory = Array.from({ length: MAX_CHAT_HISTORY_ITEMS + 1 }, () => ({
      role: 'user' as const,
      content: 'x',
    }));

    await expect(service.respond({ message: oversizedMessage })).rejects.toThrow(
      `${MAX_CHAT_MESSAGE_LENGTH} characters`,
    );
    await expect(service.respond({ message: 'oi', history: oversizedHistory })).rejects.toThrow(
      `${MAX_CHAT_HISTORY_ITEMS} items`,
    );
  });
});
