import { describe, expect, it, vi } from "vitest";

import { registerWorkItemNotificationHandlers } from "../src/main/work-item-notification-handlers.js";

describe("work item completion/blocker notifications", () => {
  it("notifies and deep links on work.item.completed", () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const client = {
      on: vi.fn((type: string, handler: (event: unknown) => void) => {
        listeners.set(type, handler);
      }),
      off: vi.fn(),
    };

    const notify = vi.fn();
    const openDeepLink = vi.fn();

    registerWorkItemNotificationHandlers(client as never, { notify, openDeepLink });

    const handler = listeners.get("work.item.completed");
    expect(handler).toBeTypeOf("function");
    handler?.({
      payload: {
        item: {
          work_item_id: "w-1",
          title: "One",
        },
      },
    });

    expect(notify).toHaveBeenCalledTimes(1);
    const notification = notify.mock.calls[0]?.[0] as {
      title: string;
      body: string;
      onClick: () => void;
    };
    expect(notification.title).toBe("Work item done");
    expect(notification.body).toBe("One");

    notification.onClick();
    expect(openDeepLink).toHaveBeenCalledWith("tyrum://work?work_item_id=w-1");
  });

  it("notifies and deep links on work.item.blocked", () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const client = {
      on: vi.fn((type: string, handler: (event: unknown) => void) => {
        listeners.set(type, handler);
      }),
      off: vi.fn(),
    };

    const notify = vi.fn();
    const openDeepLink = vi.fn();

    registerWorkItemNotificationHandlers(client as never, { notify, openDeepLink });

    const handler = listeners.get("work.item.blocked");
    expect(handler).toBeTypeOf("function");
    handler?.({
      payload: {
        item: {
          work_item_id: "w-2",
          title: "Two",
        },
      },
    });

    expect(notify).toHaveBeenCalledTimes(1);
    const notification = notify.mock.calls[0]?.[0] as {
      title: string;
      body: string;
      onClick: () => void;
    };
    expect(notification.title).toBe("Work item blocked");
    expect(notification.body).toBe("Two");

    notification.onClick();
    expect(openDeepLink).toHaveBeenCalledWith("tyrum://work?work_item_id=w-2");
  });

  it("notifies and deep links on work.item.failed", () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const client = {
      on: vi.fn((type: string, handler: (event: unknown) => void) => {
        listeners.set(type, handler);
      }),
      off: vi.fn(),
    };

    const notify = vi.fn();
    const openDeepLink = vi.fn();

    registerWorkItemNotificationHandlers(client as never, { notify, openDeepLink });

    const handler = listeners.get("work.item.failed");
    expect(handler).toBeTypeOf("function");
    handler?.({
      payload: {
        item: {
          work_item_id: "w-3",
          title: "Three",
        },
      },
    });

    expect(notify).toHaveBeenCalledTimes(1);
    const notification = notify.mock.calls[0]?.[0] as {
      title: string;
      body: string;
      onClick: () => void;
    };
    expect(notification.title).toBe("Work item failed");
    expect(notification.body).toBe("Three");

    notification.onClick();
    expect(openDeepLink).toHaveBeenCalledWith("tyrum://work?work_item_id=w-3");
  });
});
