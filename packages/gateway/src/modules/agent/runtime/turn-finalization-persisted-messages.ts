import { randomUUID } from "node:crypto";
import type { TyrumUIMessage } from "@tyrum/contracts";
import type { GatewayContainer } from "../../../container.js";
import type { ConversationRow } from "../conversation-dal.js";
import { normalizeMessageId, resolveMessageCreatedAt } from "../conversation-dal-storage.js";
import { messagesEqualIgnoringId } from "../../ai-sdk/message-overlap.js";
import { TurnItemDal } from "../turn-item-dal.js";
import {
  extractArtifactIdFromUrl,
  getArtifactRowsByIds,
  linkArtifactLineageTx,
  rowToArtifactRef,
} from "../../artifact/dal.js";
import { emitArtifactAttachedTx } from "../../artifact/execution-artifacts.js";
import { emitTurnItemCreatedTx } from "./turn-item-events.js";

type PersistTurnMessagesDb = Pick<GatewayContainer, "db">;

function resolveMessageTurnId(message: TyrumUIMessage): string | undefined {
  const metadata = message.metadata;
  if (!metadata || typeof metadata !== "object") {
    return undefined;
  }
  const turnId =
    typeof metadata["turn_id"] === "string"
      ? metadata["turn_id"]
      : typeof metadata["turnId"] === "string"
        ? metadata["turnId"]
        : undefined;
  return turnId?.trim() ? turnId : undefined;
}

export function selectPersistedTurnMessages(input: {
  messages: readonly TyrumUIMessage[];
  turnId: string;
  fallbackCreatedAt: string;
}): TyrumUIMessage[] {
  const scopedMessages = input.messages.filter(
    (message) => resolveMessageTurnId(message) === input.turnId,
  );
  if (scopedMessages.length === 0) {
    return [];
  }

  const groups: Array<{ createdAt: string; messages: TyrumUIMessage[] }> = [];
  for (const message of scopedMessages) {
    const createdAt = resolveMessageCreatedAt(message, input.fallbackCreatedAt);
    const currentGroup = groups[groups.length - 1];
    if (currentGroup && currentGroup.createdAt === createdAt) {
      currentGroup.messages.push(message);
      continue;
    }
    groups.push({ createdAt, messages: [message] });
  }
  const firstGroup = groups[0];
  if (
    firstGroup &&
    groups.length > 1 &&
    groups.every(
      (group) =>
        group.messages.length === firstGroup.messages.length &&
        group.messages.every((message, index) =>
          messagesEqualIgnoringId(message, firstGroup.messages[index]!),
        ),
    )
  ) {
    return firstGroup.messages;
  }

  let earliestCreatedAt = resolveMessageCreatedAt(scopedMessages[0]!, input.fallbackCreatedAt);
  for (const message of scopedMessages.slice(1)) {
    const createdAt = resolveMessageCreatedAt(message, input.fallbackCreatedAt);
    if (createdAt < earliestCreatedAt) {
      earliestCreatedAt = createdAt;
    }
  }

  return scopedMessages.filter(
    (message) => resolveMessageCreatedAt(message, input.fallbackCreatedAt) === earliestCreatedAt,
  );
}

export async function persistTurnMessages(input: {
  db: PersistTurnMessagesDb["db"];
  conversation: ConversationRow;
  turnId: string;
  messages: readonly TyrumUIMessage[];
  fallbackCreatedAt: string;
}): Promise<void> {
  const turnItemDal = new TurnItemDal(input.db);
  const existingItems = await turnItemDal.listByTurnId({
    tenantId: input.conversation.tenant_id,
    turnId: input.turnId,
  });
  const highestExistingIndex = existingItems.reduce(
    (max, item) => Math.max(max, item.item_index),
    -1,
  );
  const firstMessage = input.messages[0];
  const existingUserIndex =
    firstMessage?.role === "user"
      ? existingItems.findIndex(
          (item) =>
            item.kind === "message" && messagesEqualIgnoringId(item.payload.message, firstMessage),
        )
      : -1;

  let nextItemIndex = highestExistingIndex + 1;
  let messageOffset = 0;

  async function linkTurnItemArtifacts(
    message: TyrumUIMessage,
    turnItemId: string,
    emitEvents: boolean,
  ): Promise<void> {
    const artifactIds = [
      ...new Set(
        message.parts.flatMap((part) => {
          if (part.type !== "file" || typeof part["url"] !== "string") {
            return [];
          }
          const artifactId = extractArtifactIdFromUrl(part["url"]);
          return artifactId ? [artifactId] : [];
        }),
      ),
    ];
    if (artifactIds.length === 0) {
      return;
    }

    const artifactRows = await getArtifactRowsByIds(
      input.db,
      input.conversation.tenant_id,
      artifactIds,
    );
    for (const row of artifactRows) {
      await linkArtifactLineageTx(input.db, {
        tenantId: input.conversation.tenant_id,
        artifactId: row.artifact_id,
        turnItemId,
        createdAt: resolveMessageCreatedAt(message, input.fallbackCreatedAt),
      });

      if (!emitEvents) {
        continue;
      }
      const artifact = rowToArtifactRef(row);
      if (!artifact) {
        continue;
      }
      await emitArtifactAttachedTx(input.db, input.conversation.tenant_id, {
        turnId: input.turnId,
        turnItemId,
        artifact,
      });
    }
  }

  if (firstMessage?.role === "user") {
    if (existingUserIndex >= 0) {
      messageOffset = 1;
    } else if (existingItems.length > 0) {
      await turnItemDal.shiftItemIndices({
        tenantId: input.conversation.tenant_id,
        turnId: input.turnId,
        delta: 1,
      });
      const inserted = await turnItemDal.ensureItemWithState({
        tenantId: input.conversation.tenant_id,
        turnItemId: randomUUID(),
        turnId: input.turnId,
        itemIndex: 0,
        itemKey: `message:${normalizeMessageId(firstMessage, 0)}`,
        kind: "message",
        payload: { message: firstMessage },
        createdAt: resolveMessageCreatedAt(firstMessage, input.fallbackCreatedAt),
      });
      if (inserted.inserted) {
        await emitTurnItemCreatedTx(input.db, {
          tenantId: input.conversation.tenant_id,
          turnItem: inserted.item,
        });
      }
      await linkTurnItemArtifacts(firstMessage, inserted.item.turn_item_id, inserted.inserted);
      messageOffset = 1;
      nextItemIndex = highestExistingIndex + 2;
    }
  }

  for (const [offset, message] of input.messages.slice(messageOffset).entries()) {
    const inserted = await turnItemDal.ensureItemWithState({
      tenantId: input.conversation.tenant_id,
      turnItemId: randomUUID(),
      turnId: input.turnId,
      itemIndex: nextItemIndex + offset,
      itemKey: `message:${normalizeMessageId(message, messageOffset + offset)}`,
      kind: "message",
      payload: { message },
      createdAt: resolveMessageCreatedAt(message, input.fallbackCreatedAt),
    });
    if (inserted.inserted) {
      await emitTurnItemCreatedTx(input.db, {
        tenantId: input.conversation.tenant_id,
        turnItem: inserted.item,
      });
    }
    await linkTurnItemArtifacts(message, inserted.item.turn_item_id, inserted.inserted);
  }
}
