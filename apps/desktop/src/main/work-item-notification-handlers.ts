type WorkItemSummary = {
  work_item_id: string;
  title?: string;
};

type WorkItemLifecycleEvent = {
  payload: {
    item: WorkItemSummary;
  };
};

export type WorkItemNotification = {
  title: string;
  body: string;
  onClick: () => void;
};

export type WorkItemNotificationPublisher = (notification: WorkItemNotification) => void;

export function buildWorkItemDrilldownDeepLinkUrl(workItemId: string): string {
  return `tyrum://work?work_item_id=${encodeURIComponent(workItemId)}`;
}

export function registerWorkItemNotificationHandlers(
  client: {
    on: (type: string, handler: (event: WorkItemLifecycleEvent) => void) => void;
    off: (type: string, handler: (event: WorkItemLifecycleEvent) => void) => void;
  },
  deps: {
    notify: WorkItemNotificationPublisher;
    openDeepLink: (rawUrl: string) => void;
  },
): () => void {
  const notifyWorkItem = (verb: "done" | "blocked" | "failed", item: WorkItemSummary): void => {
    const title = `Work item ${verb}`;
    const body =
      typeof item.title === "string" && item.title.trim().length > 0
        ? item.title
        : item.work_item_id;
    const onClick = (): void => {
      deps.openDeepLink(buildWorkItemDrilldownDeepLinkUrl(item.work_item_id));
    };
    deps.notify({ title, body, onClick });
  };

  const onCompleted = (event: WorkItemLifecycleEvent): void => {
    notifyWorkItem("done", event.payload.item);
  };
  const onBlocked = (event: WorkItemLifecycleEvent): void => {
    notifyWorkItem("blocked", event.payload.item);
  };
  const onFailed = (event: WorkItemLifecycleEvent): void => {
    notifyWorkItem("failed", event.payload.item);
  };

  client.on("work.item.completed", onCompleted);
  client.on("work.item.blocked", onBlocked);
  client.on("work.item.failed", onFailed);

  return () => {
    client.off("work.item.completed", onCompleted);
    client.off("work.item.blocked", onBlocked);
    client.off("work.item.failed", onFailed);
  };
}
