import { jest } from '@jest/globals';
import { VideoRevocationService } from '../../backend/src/video/revocation-service';

describe('VideoRevocationService', () => {
  it('marks a session revoked only after provider room termination succeeds', async () => {
    const events: string[] = [];
    const repository = {
      listPending: jest.fn(() => [
        {
          sessionId: '11111111-1111-4111-8111-111111111111',
          roomName: 'vibematch-room-1',
          endReason: 'BLOCK' as const,
        },
      ]),
      markRevoked: jest.fn(() => {
        events.push('marked');
      }),
    };
    const roomTerminator = {
      terminateRoom: jest.fn(() => {
        events.push('terminated');
        return Promise.resolve();
      }),
    };

    const service = new VideoRevocationService(
      repository as never,
      roomTerminator,
      () => new Date('2026-08-26T22:00:00.000Z'),
    );

    await expect(service.reconcile()).resolves.toEqual({ revoked: 1, failed: 0 });
    expect(events).toEqual(['terminated', 'marked']);
    expect(repository.markRevoked).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'BLOCK',
      new Date('2026-08-26T22:00:00.000Z'),
    );
  });

  it('keeps revocation pending when LiveKit termination fails', async () => {
    const repository = {
      listPending: jest.fn(() => [
        {
          sessionId: '11111111-1111-4111-8111-111111111111',
          roomName: 'vibematch-room-1',
          endReason: 'MODERATION' as const,
        },
      ]),
      markRevoked: jest.fn(),
    };
    const roomTerminator = {
      terminateRoom: jest.fn(() => Promise.reject(new Error('provider unavailable'))),
    };

    const service = new VideoRevocationService(repository as never, roomTerminator);

    await expect(service.reconcile()).resolves.toEqual({ revoked: 0, failed: 1 });
    expect(repository.markRevoked).not.toHaveBeenCalled();
  });
});
