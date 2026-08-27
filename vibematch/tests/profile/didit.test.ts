import { jest } from '@jest/globals';
import { DiditAgeAssuranceProvider } from '../../backend/src/profile/providers/didit';

const response = (payload: unknown, ok = true, status = 200): Response =>
  ({ ok, status, json: () => Promise.resolve(payload) }) as Response;

describe('DiditAgeAssuranceProvider', () => {
  test('creates a hosted verification session using backend-only credentials', async () => {
    const fetchImpl: typeof fetch = jest.fn(() =>
      Promise.resolve(
        response({
          session_id: 'session-123',
          url: 'https://verify.didit.me/session/session-123',
        }),
      ),
    );
    const provider = new DiditAgeAssuranceProvider({
      apiKey: 'server-only-key',
      workflowId: 'workflow-123',
      fetchImpl,
    });

    await expect(provider.start('user-1')).resolves.toEqual({
      sessionRef: 'session-123',
      verificationUrl: 'https://verify.didit.me/session/session-123',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://verification.didit.me/v3/session/',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  test.each([
    ['Approved', 'APPROVED'],
    ['Declined', 'REJECTED'],
    ['In Progress', 'PENDING'],
  ] as const)('maps provider status %s to %s', async (providerStatus, expected) => {
    const fetchImpl: typeof fetch = jest.fn(() =>
      Promise.resolve(response({ session_id: 'session-123', status: providerStatus })),
    );
    const provider = new DiditAgeAssuranceProvider({
      apiKey: 'server-only-key',
      workflowId: 'workflow-123',
      fetchImpl,
    });

    await expect(provider.getResult('session-123')).resolves.toMatchObject({ decision: expected });
  });

  test('rejects an insecure hosted verification URL', async () => {
    const fetchImpl: typeof fetch = jest.fn(() =>
      Promise.resolve(
        response({ session_id: 'session-123', url: 'http://unsafe.example/session' }),
      ),
    );
    const provider = new DiditAgeAssuranceProvider({
      apiKey: 'server-only-key',
      workflowId: 'workflow-123',
      fetchImpl,
    });

    await expect(provider.start('user-1')).rejects.toThrow('must use HTTPS');
  });
});
