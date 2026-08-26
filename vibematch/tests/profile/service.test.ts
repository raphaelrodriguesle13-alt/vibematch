import {
  ProfileError,
  ProfileService,
  type ProfileRepositoryPort,
  type UpdateProfileInput,
  type UserProfile,
} from '../../backend/src/profile/service';

class FakeProfileRepository implements ProfileRepositoryPort {
  lastUpdate: { userId: string; input: UpdateProfileInput } | null = null;

  getProfile(): Promise<UserProfile | null> {
    return Promise.resolve(null);
  }

  listActiveInterests(): Promise<Array<{ id: string; label: string }>> {
    return Promise.resolve([]);
  }

  upsertProfile(userId: string, input: UpdateProfileInput): Promise<UserProfile> {
    this.lastUpdate = { userId, input };
    return Promise.resolve({
      userId,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl ?? null,
      language: input.language,
      region: input.region,
      interests: [],
    });
  }
}

const validInput = (): UpdateProfileInput => ({
  displayName: ' Rapha ',
  avatarUrl: ' https://example.com/avatar.png ',
  language: 'pt-BR',
  region: 'BR-SP',
  interestIds: ['11111111-1111-4111-8111-111111111111'],
});

describe('ProfileService', () => {
  test('normalizes profile input before persistence', async () => {
    const repository = new FakeProfileRepository();
    const service = new ProfileService(repository);

    await service.update('user-1', validInput());

    expect(repository.lastUpdate).toEqual({
      userId: 'user-1',
      input: {
        displayName: 'Rapha',
        avatarUrl: 'https://example.com/avatar.png',
        language: 'pt-BR',
        region: 'BR-SP',
        interestIds: ['11111111-1111-4111-8111-111111111111'],
      },
    });
  });

  test('rejects non-HTTPS avatar URLs', async () => {
    const service = new ProfileService(new FakeProfileRepository());
    const input = validInput();
    input.avatarUrl = 'http://example.com/avatar.png';

    await expect(service.update('user-1', input)).rejects.toMatchObject<ProfileError>({
      code: 'INVALID_PROFILE',
    });
  });

  test('rejects malformed interest ids', async () => {
    const service = new ProfileService(new FakeProfileRepository());
    const input = validInput();
    input.interestIds = ['not-a-uuid'];

    await expect(service.update('user-1', input)).rejects.toMatchObject<ProfileError>({
      code: 'INVALID_INTERESTS',
    });
  });
});
