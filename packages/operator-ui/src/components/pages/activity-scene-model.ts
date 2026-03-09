import type { ActivityRoom, ActivityState } from "@tyrum/operator-core";

const SCENE_WIDTH = 960;
const SCENE_HEIGHT = 920;

type RoomSpec = {
  id: ActivityRoom;
  x: number;
  y: number;
  width: number;
  height: number;
  columns: number;
};

const ROOM_SPECS: readonly RoomSpec[] = [
  { id: "lounge", x: 48, y: 50, width: 246, height: 240, columns: 2 },
  { id: "strategy-desk", x: 324, y: 50, width: 246, height: 240, columns: 2 },
  { id: "approval-desk", x: 600, y: 50, width: 312, height: 240, columns: 3 },
  { id: "library", x: 48, y: 310, width: 246, height: 260, columns: 2 },
  { id: "terminal-lab", x: 324, y: 310, width: 246, height: 260, columns: 2 },
  { id: "mail-room", x: 600, y: 310, width: 312, height: 260, columns: 3 },
  { id: "archive", x: 324, y: 590, width: 246, height: 140, columns: 2 },
] as const;

export const ACTIVITY_ROOM_LABELS: Record<ActivityRoom, string> = {
  lounge: "Lounge",
  "strategy-desk": "Strategy desk",
  library: "Library",
  "terminal-lab": "Terminal lab",
  archive: "Archive",
  "mail-room": "Mail room",
  "approval-desk": "Approval desk",
};

export type ActivitySceneRoom = {
  id: ActivityRoom;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ActivitySceneActor = {
  id: string;
  workstreamId: string;
  agentId: string;
  identityId: string;
  name: string;
  roomId: ActivityRoom;
  roomLabel: string;
  slotId: string;
  x: number;
  y: number;
  badgeLabel: string;
  keyLabel: string;
  laneLabel: string;
  bubbleText: string | null;
  attentionLevel: ActivityState["workstreamsById"][string]["attentionLevel"];
  selected: boolean;
};

export type ActivitySceneModel = {
  width: number;
  height: number;
  rooms: ActivitySceneRoom[];
  actors: ActivitySceneActor[];
};

export function compactWorkstreamKey(key: string): string {
  const parts = key.split(":").filter((part) => part.length > 0);
  if (parts.length <= 2) return key;
  return parts.slice(-2).join(":");
}

export function formatLaneLabel(lane: string): string {
  return lane === "main" ? "Main" : lane.charAt(0).toUpperCase() + lane.slice(1);
}

function resolveRoomSlot(room: RoomSpec, slotIndex: number) {
  const column = slotIndex % room.columns;
  const row = Math.floor(slotIndex / room.columns);
  const leftInset = room.columns === 3 ? 48 : 56;
  const rightInset = leftInset;
  const usableWidth = room.width - leftInset - rightInset;
  const xStep = room.columns === 1 ? 0 : usableWidth / Math.max(room.columns - 1, 1);
  const yStep = room.id === "archive" ? 50 : 70;
  const topInset = room.id === "archive" ? 60 : 100;
  return {
    slotId: `${room.id}:${row}:${column}`,
    x: room.x + leftInset + column * xStep,
    y: room.y + topInset + row * yStep,
  };
}

export function deriveActivityScene(
  activity: ActivityState,
  selectedWorkstreamId: string | null,
): ActivitySceneModel {
  const rooms = ROOM_SPECS.map((room) => ({ ...room, label: ACTIVITY_ROOM_LABELS[room.id] }));
  const roomAssignments = new Map<ActivityRoom, number>();

  const actors = activity.workstreamIds.flatMap((workstreamId) => {
    const workstream = activity.workstreamsById[workstreamId];
    if (!workstream) return [];

    const room = ROOM_SPECS.find((entry) => entry.id === workstream.currentRoom);
    if (!room) return [];

    const nextSlotIndex = roomAssignments.get(room.id) ?? 0;
    roomAssignments.set(room.id, nextSlotIndex + 1);

    const slot = resolveRoomSlot(room, nextSlotIndex);
    const keyLabel = compactWorkstreamKey(workstream.key);
    const laneLabel = formatLaneLabel(workstream.lane);
    return [
      {
        id: `actor:${workstream.id}`,
        workstreamId: workstream.id,
        agentId: workstream.agentId,
        identityId: `identity:${workstream.agentId}`,
        name: workstream.persona.name,
        roomId: room.id,
        roomLabel: ACTIVITY_ROOM_LABELS[room.id],
        slotId: slot.slotId,
        x: slot.x,
        y: slot.y,
        badgeLabel: `${laneLabel} · ${keyLabel}`,
        keyLabel,
        laneLabel,
        bubbleText: workstream.bubbleText,
        attentionLevel: workstream.attentionLevel,
        selected: workstream.id === selectedWorkstreamId,
      } satisfies ActivitySceneActor,
    ];
  });

  return { width: SCENE_WIDTH, height: SCENE_HEIGHT, rooms, actors };
}
