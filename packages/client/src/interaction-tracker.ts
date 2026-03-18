/**
 * Tracks user interaction timestamps within the Tyrum client.
 *
 * Each platform wires up the appropriate UI event listeners and calls
 * {@link recordInteraction} when the user intentionally interacts with
 * the Tyrum application.  The resulting {@link lastInputSeconds} value
 * is included in presence beacons so agents can determine which device
 * the operator is actively using.
 *
 * Only interactions within the Tyrum client UI count — OS-level activity
 * (e.g. mouse-mover apps keeping a screen awake) must NOT trigger this.
 */
export class InteractionTracker {
  private lastInteractionAt = Date.now();

  /** Record that the user interacted with the Tyrum client right now. */
  recordInteraction(): void {
    this.lastInteractionAt = Date.now();
  }

  /**
   * Seconds since the last recorded Tyrum interaction.
   * Suitable for the `last_input_seconds` field on `PresenceBeacon`.
   */
  get lastInputSeconds(): number {
    return Math.floor((Date.now() - this.lastInteractionAt) / 1000);
  }
}
