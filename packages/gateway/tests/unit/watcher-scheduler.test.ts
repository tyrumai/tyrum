import { describe } from "vitest";
import { registerWatcherSchedulerAutomationTests } from "./watcher-scheduler.automation-test-support.js";
import { registerWatcherSchedulerCoreTests } from "./watcher-scheduler.core-test-support.js";
import { registerWatcherSchedulerLifecycle } from "./watcher-scheduler.test-support.js";

describe("WatcherScheduler", () => {
  const state = registerWatcherSchedulerLifecycle();

  registerWatcherSchedulerCoreTests(state);
  registerWatcherSchedulerAutomationTests(state);
});
