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

  test('auto-discovers the only active KYC workflow when no id is configured', async () => {
    const fetchImpl: typeof fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response([
          {
            uuid: 'workflow-live',
            workflow_type: 'kyc',
            is_default: true,
            is_archived: false,
          },
        ]),
      )
      .mockResolvedValueOnce(
        response({
          session_id: 'session-123',
          url: 'https://verify.didit.me/session/session-123',
        }),
      );
    const provider = new DiditAgeAssuranceProvider({
      apiKey: 'server-only-key',
      fetchImpl,
    });

    await expect(provider.start('user-1')).resolves.toEqual({
      sessionRef: 'session-123',
      verificationUrl: 'https://verify.didit.me/session/session-123',
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'https://verification.didit.me/v3/workflows/', {
      headers: {
        accept: 'application/json',
        'x-api-key': 'server-only-key',
      },
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://verification.didit.me/v3/session/',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ workflow_id: 'workflow-live', vendor_data: 'user-1' }),
      }),
    );
  });

  test('prefers the single default KYC workflow when multiple active KYC workflows exist', async () => {
    const fetchImpl: typeof fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response([
          { uuid: 'workflow-a', workflow_type: 'kyc', is_default: false, is_archived: false },
          { uuid: 'workflow-b', workflow_type: 'kyc', is_default: true, is_archived: false },
          { uuid: 'workflow-kyb', workflow_type: 'kyb', is_default: true, is_archived: false },
        ]),
      )
      .mockResolvedValueOnce(
        response({
          session_id: 'session-123',
          url: 'https://verify.didit.me/session/session-123',
        }),
      );
    const provider = new DiditAgeAssuranceProvider({ apiKey: 'server-only-key', fetchImpl });

    await provider.start('user-1');

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://verification.didit.me/v3/session/',
      expect.objectContaining({
        body: JSON.stringify({ workflow_id: 'workflow-b', vendor_data: 'user-1' }),
      }),
    );
  });

  test('fails closed when KYC workflow discovery is ambiguous', async () => {
    const fetchImpl: typeof fetch = jest.fn(() =>
      Promise.resolve(
        response([
          { uuid: 'workflow-a', workflow_type: 'kyc', is_default: false, is_archived: false },
          { uuid: 'workflow-b', workflow_type: 'kyc', is_default: false, is_archived: false },
        ]),
      ),
    );
    const provider = new DiditAgeAssuranceProvider({ apiKey: 'server-only-key', fetchImpl });

    await expect(provider.start('user-1')).rejects.toThrow(
      'workflow id must be configured when KYC workflow selection is ambiguous',
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
