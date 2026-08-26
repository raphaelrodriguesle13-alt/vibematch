export type ProfileInterest = {
  id: string;
  label: string;
};

export type UserProfile = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  language: string;
  region: string;
  interests: ProfileInterest[];
};

export type UpdateProfileInput = {
  displayName: string;
  avatarUrl?: string | null;
  language: string;
  region: string;
  interestIds?: string[];
};

export interface ProfileRepositoryPort {
  getProfile(userId: string): Promise<UserProfile | null>;
  listActiveInterests(): Promise<ProfileInterest[]>;
  upsertProfile(userId: string, input: UpdateProfileInput): Promise<UserProfile>;
}

export type ProfileErrorCode = 'INVALID_PROFILE' | 'PROFILE_NOT_FOUND' | 'INVALID_INTERESTS';

export class ProfileError extends Error {
  constructor(
    readonly code: ProfileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProfileError';
  }
}

const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const REGION = /^[A-Za-z0-9][A-Za-z0-9_-]{1,15}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ProfileService {
  constructor(private readonly repository: ProfileRepositoryPort) {}

  get(userId: string): Promise<UserProfile | null> {
    return this.repository.getProfile(userId);
  }

  listInterests(): Promise<ProfileInterest[]> {
    return this.repository.listActiveInterests();
  }

  async update(userId: string, input: UpdateProfileInput): Promise<UserProfile> {
    const displayName = input.displayName.trim();
    const language = input.language.trim();
    const region = input.region.trim();
    const avatarUrl = input.avatarUrl?.trim() || null;
    const interestIds = [...new Set(input.interestIds ?? [])];

    if (displayName.length < 2 || displayName.length > 50) {
      throw new ProfileError('INVALID_PROFILE', 'Display name must be 2-50 characters');
    }
    if (!LANGUAGE.test(language) || !REGION.test(region)) {
      throw new ProfileError('INVALID_PROFILE', 'Language or region is invalid');
    }
    if (avatarUrl && !this.isHttpsUrl(avatarUrl)) {
      throw new ProfileError('INVALID_PROFILE', 'Avatar URL must use HTTPS');
    }
    if (interestIds.length > 10 || interestIds.some((id) => !UUID.test(id))) {
      throw new ProfileError('INVALID_INTERESTS', 'Interest selection is invalid');
    }

    return this.repository.upsertProfile(userId, {
      displayName,
      avatarUrl,
      language,
      region,
      interestIds,
    });
  }

  private isHttpsUrl(value: string): boolean {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }
}
