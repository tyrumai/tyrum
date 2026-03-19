declare module "google-auth-library" {
  export class OAuth2Client {
    verifyIdToken(input: { idToken: string; audience: string }): Promise<{
      getPayload(): { email?: string; email_verified?: boolean } | undefined;
    }>;

    verifySignedJwtWithCertsAsync(
      bearer: string,
      certs: Record<string, string>,
      audience: string,
      issuers: string[],
    ): Promise<unknown>;
  }
}
