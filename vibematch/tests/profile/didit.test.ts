import { jest } from '@jest/globals';
import { DiditAgeAssuranceProvider } from '../../backend/src/profile/providers/didit';

const response = (payload: unknown, ok = true, status = 200): Response =>
  ({ ok, status, json: () => Promise.resolve(payload) }) as Response;

const WORKFLOW_A = '11111111-2222-3333-4444-555555555555';
const WORKFLOW_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const WORKFLOW_KYB = '12345678-1234-1234-1234-123456789abc';

describe('DiditAgeAssuranceProvider', () => {
  test('creates a hosted verification session using a configured workflow id', async () => {
    const fetchImpl: typeof fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          count: 1,
          next: null,
          previous: null,
          results: [
            {
              uuid: WORKFLOW_A,
              workflow_id: WORKFLOW_A,
              workflow_type: 'kyc',
              status: 'published',
              is_default: true,
              is_archived: false,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response({
          session_id: 'session-123',
          url: 'https://verify.didit.me/session/session-123',
        }),
      );
    const provider = new DiditAgeAssuranceProvider({
      apiKey: 'server-only-key',
      workflowId: WORKFLOW_A,
      fetchImpl,
    });

    await expect(provider.start('user-1')).resolves.toEqual({
      sessionRef: 'session-123',
      verificationUrl: 'https://verify.didit.me/session/session-123',
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(2, 'https://verification.didit.me/v3/session/',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ workflow_id: WORKFLOW_A, vendor_data: 'user-1' }),
      }),
    );
  });

  test('auto-discovers the only published KYC workflow from the current paginated API', async () => {
    const fetchImpl: typeof fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          count: 2,
          next: null,
          previous: null,
          results: [
            {
              uuid: WORKFLOW_A,
              workflow_id: WORKFLOW_A,
              workflow_type: 'kyc',
              status: 'published',
              is_default: true,
              is_archived: false,
            },
            {
              uuid: WORKFLOW_B,
              workflow_id: WORKFLOW_B,
              workflow_type: 'kyc',
              status: 'draft',
              is_default: false,
              is_archived: false,
            },
          ],
        }),
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
        body: JSON.stringify({ workflow_id: WORKFLOW_A, vendor_data: 'user-1' }),
      }),
    );
  });

  test('accepts the public workflow URL as an operator-friendly selector', async () => {
    const publicUrl = 'https://verify.didit.me/u/E2MfLNonSAu3b9sKxm9hTQ';
    const fetchImpl: typeof fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          count: 1,
          next: null,
          previous: null,
          results: [
            {
              uuid: WORKFLOW_A,
              workflow_id: WORKFLOW_A,
              workflow_url: publicUrl,
              workflow_type: 'kyc',
              status: 'published',
              is_default: true,
              is_archived: false,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response({
          session_id: 'session-123',
          url: 'https://verify.didit.me/session/session-123',
        }),
      );
    const provider = new DiditAgeAssuranceProvider({
      apiKey: 'server-only-key',
      workflowId: publicUrl,
      fetchImpl,
    });

    await provider.start('user-1');

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://verification.didit.me/v3/session/',
      expect.objectContaining({
        body: JSON.stringify({ workflow_id: WORKFLOW_A, vendor_data: 'user-1' }),
      }),
    );
  });

  test('prefers the single default published KYC workflow when multiple exist', async () => {
    const fetchImpl: typeof fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          count: 3,
          next: null,
          previous: null,
          results: [
            {
              uuid: WORKFLOW_A,
              workflow_id: WORKFLOW_A,
              workflow_type: 'kyc',
              status: 'published',
              is_default: false,
              is_archived: false,
            },
            {
              uuid: WORKFLOW_B,
              workflow_id: WORKFLOW_B,
              workflow_type: 'kyc',
              status: 'published',
              is_default: true,
              is_archived: false,
            },
            {
              uuid: WORKFLOW_KYB,
              workflow_id: WORKFLOW_KYB,
              workflow_type: 'kyb',
              status: 'published',
              is_default: true,
              is_archived: false,
            },
          ],
        }),
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
        body: JSON.stringify({ workflow_id: WORKFLOW_B, vendor_data: 'user-1' }),
      }),
    );
  });

  test('fails closed when published KYC workflow discovery is ambiguous', async () => {
    const fetchImpl: typeof fetch = jest.fn(() =>
      Promise.resolve(
        response({
          count: 2,
          next: null,
          previous: null,
          results: [
            {
              uuid: WORKFLOW_A,
              workflow_id: WORKFLOW_A,
              workflow_type: 'kyc',
              status: 'published',
              is_default: false,
              is_archived: false,
            },
            {
              uuid: WORKFLOW_B,
              workflow_id: WORKFLOW_B,
              workflow_type: 'kyc',
              status: 'published',
              is_default: false,
              is_archived: false,
            },
          ],
        }),
      ),
    );
    const provider = new DiditAgeAssuranceProvider({ apiKey: 'server-only-key', fetchImpl });

    await expect(provider.start('user-1')).rejects.toThrow(
      'workflow id must be configured when published KYC workflow selection is ambiguous',
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
      workflowId: WORKFLOW_A,
      fetchImpl,
    });

    await expect(provider.getResult('session-123')).resolves.toMatchObject({ decision: expected });
  });

  test('rejects an insecure hosted verification URL', async () => {
    const fetchImpl: typeof fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          count: 1,
          next: null,
          previous: null,
          results: [
            {
              uuid: WORKFLOW_A,
              workflow_id: WORKFLOW_A,
              workflow_type: 'kyc',
              status: 'published',
              is_default: true,
              is_archived: false,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response({ session_id: 'session-123', url: 'http://unsafe.example/session' }),
      );
    const provider = new DiditAgeAssuranceProvider({
      apiKey: 'server-only-key',
      workflowId: WORKFLOW_A,
      fetchImpl,
    });

    await expect(provider.start('user-1')).rejects.toThrow('must use HTTPS');
  });
});
