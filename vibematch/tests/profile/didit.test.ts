import { jest } from '@jest/globals';
import { DiditAgeAssuranceProvider } from '../../backend/src/profile/providers/didit';

const response = (payload: unknown, ok = true, status = 200): Response =>
  ({ ok, status, json: () => Promise.resolve(payload) }) as Response;

const WORKFLOW_A = '11111111-2222-3333-4444-555555555555';
const WORKFLOW_B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const WORKFLOW_KYB = '12345678-1234-1234-1234-123456789abc';

describe('DiditAgeAssuranceProvider', () => {
  test('creates a hosted verification session directly when a workflow UUID is configured', async () => {
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
      workflowId: WORKFLOW_A,
      fetchImpl,
    });

    await expect(provider.start('user-1')).resolves.toEqual({
      sessionRef: 'session-123',
      verificationUrl: 'https://verify.didit.me/session/session-123',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://verification.didit.me/v3/session/',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ workflow_id: WORKFLOW_A, vendor_data: 'user-1' }),
      }),
    );
  });

  test('auto-discovers the only published KYC workflow from the current list API', async () => {
    const fetchImpl: typeof fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response([
          {
            uuid: WORKFLOW_A,
            workflow_type: 'kyc',
            is_default: true,
            is_archived: false,
          },
          {
            uuid: WORKFLOW_KYB,
            workflow_type: 'kyb',
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
    const provider = new DiditAgeAssuranceProvider({ apiKey: 'server-only-key', fetchImpl });

    await provider.start('user-1');

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
        body: JSON.stringify({ workflow_id: WORKFLOW_A, vendor_data: 'user-1' }),
      }),
    );
  });

  test('prefers adaptive age verification when both age and KYC workflows are published', async () => {
    const fetchImpl: typeof fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response([
          {
            uuid: WORKFLOW_A,
            workflow_type: 'kyc',
            is_default: true,
            is_archived: false,
          },
          {
            uuid: WORKFLOW_B,
            workflow_type: 'adaptive_age_verification',
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

  test('accepts a public workflow URL as an operator-friendly selector', async () => {
    const publicUrl = 'https://verify.didit.me/u/example-public-workflow';
    const fetchImpl: typeof fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response([
          {
            uuid: WORKFLOW_A,
            workflow_url: publicUrl,
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

  test('fails closed when eligible workflow discovery is ambiguous', async () => {
    const fetchImpl: typeof fetch = jest.fn(() =>
      Promise.resolve(
        response([
          {
            uuid: WORKFLOW_A,
            workflow_type: 'kyc',
            is_default: false,
            is_archived: false,
          },
          {
            uuid: WORKFLOW_B,
            workflow_type: 'kyc',
            is_default: false,
            is_archived: false,
          },
        ]),
      ),
    );
    const provider = new DiditAgeAssuranceProvider({ apiKey: 'server-only-key', fetchImpl });

    await expect(provider.start('user-1')).rejects.toThrow('Didit workflow_selection failed');
  });

  test.each([
    ['Approved', 'APPROVED'],
    ['Declined', 'REJECTED'],
    ['Abandoned', 'REJECTED'],
    ['Expired', 'REJECTED'],
    ['Kyc Expired', 'REJECTED'],
    ['In Progress', 'PENDING'],
    ['In Review', 'PENDING'],
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

  test('surfaces the safe HTTP status for workflow authentication failures', async () => {
    const fetchImpl: typeof fetch = jest.fn(() => Promise.resolve(response({}, false, 401)));
    const provider = new DiditAgeAssuranceProvider({ apiKey: 'server-only-key', fetchImpl });

    await expect(provider.start('user-1')).rejects.toThrow(
      'Didit workflow_discovery failed with 401',
    );
  });

  test('rejects an insecure hosted verification URL', async () => {
    const fetchImpl: typeof fetch = jest.fn(() =>
      Promise.resolve(response({ session_id: 'session-123', url: 'http://unsafe.example/session' })),
    );
    const provider = new DiditAgeAssuranceProvider({
      apiKey: 'server-only-key',
      workflowId: WORKFLOW_A,
      fetchImpl,
    });

    await expect(provider.start('user-1')).rejects.toThrow('must use HTTPS');
  });
});
