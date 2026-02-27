import { vi } from "vitest";

vi.mock("../src/main/work-item-notifications.js", () => ({
  WorkItemNotificationService: class WorkItemNotificationService {
    constructor(_openDeepLink: unknown) {}

    start(): Promise<void> {
      return Promise.resolve();
    }

    stop(): void {}
  },
}));

