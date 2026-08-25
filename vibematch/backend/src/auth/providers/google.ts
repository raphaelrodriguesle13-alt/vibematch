import { OAuth2Client } from 'google-auth-library';
import type { GoogleIdentity, GoogleIdentityProvider } from '../../shared/providers';

export class GoogleOidcProvider implements GoogleIdentityProvider {
  private readonly client = new OAuth2Client();

  constructor(private readonly audience: string | string[]) {
    const values = Array.isArray(audience) ? audience : [audience];
    if (values.length === 0 || values.some((value) => value.trim() === '')) {
      throw new Error('Google OAuth audience is required');
    }
  }

  async verifyIdToken(idToken: string): Promise<GoogleIdentity> {
    const ticket = await this.client.verifyIdToken({
      idToken,
      audience: this.audience,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub) throw new Error('Google ID token has no subject');

    const identity: GoogleIdentity = { subject: payload.sub };
    if (payload.email !== undefined) identity.email = payload.email;
    if (payload.email_verified !== undefined) identity.emailVerified = payload.email_verified;
    if (payload.name !== undefined) identity.displayName = payload.name;
    if (payload.picture !== undefined) identity.avatarUrl = payload.picture;
    return identity;
  }
}
