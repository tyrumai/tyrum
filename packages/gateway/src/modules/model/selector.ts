import type { AuthProfileDal, AuthProfileRow } from "./auth-profile-dal.js";

export interface ModelSelection {
  profile: AuthProfileRow;
  provider: string;
}

export class ModelSelector {
  private sessionPinning = new Map<string, string>();

  constructor(private readonly profileDal: AuthProfileDal) {}

  /** Select the best profile for a provider, optionally pinned to a session. */
  async select(provider: string, sessionId?: string): Promise<ModelSelection | null> {
    // Check session pin first
    if (sessionId) {
      const pinnedId = this.sessionPinning.get(sessionId);
      if (pinnedId) {
        const profile = await this.profileDal.getById(pinnedId);
        if (profile?.is_active) {
          return { profile, provider };
        }
        // Pinned profile no longer active — clear pin
        this.sessionPinning.delete(sessionId);
      }
    }

    // Get active profiles sorted by priority and failure count
    const profiles = await this.profileDal.listByProvider(provider);
    if (profiles.length === 0) return null;

    const selected = profiles[0]!;

    // Pin to session if provided
    if (sessionId) {
      this.sessionPinning.set(sessionId, selected.profile_id);
    }

    return { profile: selected, provider };
  }

  /** Report a failure for a profile and try to failover. */
  async failover(profileId: string, provider: string): Promise<ModelSelection | null> {
    await this.profileDal.recordFailure(profileId);

    // Get next available profile
    const profiles = await this.profileDal.listByProvider(provider);
    const next = profiles.find(p => p.profile_id !== profileId && p.is_active);
    if (!next) return null;

    return { profile: next, provider };
  }

  /** Record successful usage of a profile. */
  async recordSuccess(profileId: string): Promise<void> {
    await this.profileDal.recordUsage(profileId);
    await this.profileDal.resetFailures(profileId);
  }

  /** Clear session pin. */
  clearSessionPin(sessionId: string): void {
    this.sessionPinning.delete(sessionId);
  }
}
