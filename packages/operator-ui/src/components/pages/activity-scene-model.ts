import type { ActivityRoom, ActivityState } from "@tyrum/operator-core";

const SCENE_WIDTH = 960;
const SCENE_HEIGHT = 720;
const HOME_BAY_Y = 590;
const HOME_BAY_HEIGHT = 90;
const HOME_BAY_MARGIN = 56;
const HOME_BAY_GAP = 18;

type RoomSpec = {
  id: ActivityRoom;
  x: number;
  y: number;
  width: number;
  height: number;
  columns: number;
};

const ROOM_SPECS: readonly RoomSpec[] = [
  { id: "lounge", x: 48, y: 84, width: 246, height: 154, columns: 2 },
  { id: "strategy-desk", x: 324, y: 84, width: 246, height: 154, columns: 2 },
  { id: "approval-desk", x: 600, y: 84, width: 312, height: 154, columns: 3 },
  { id: "library", x: 48, y: 266, width: 246, height: 174, columns: 2 },
  { id: "terminal-lab", x: 324, y: 266, width: 246, height: 174, columns: 2 },
  { id: "mail-room", x: 600, y: 266, width: 312, height: 174, columns: 3 },
  { id: "archive", x: 324, y: 470, width: 246, height: 84, columns: 2 },
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

export type ActivitySceneBay = {
  id: string;
  agentId: string;
  label: string;
  state: "merged" | "split";
  workstreamCount: number;
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
  bayId: string;
  bayX: number;
  bayY: number;
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
  bays: ActivitySceneBay[];
  actors: ActivitySceneActor[];
};

function compactWorkstreamKey(key: string): string {
  const parts = key.split(":").filter((part) => part.length > 0);
  if (parts.length <= 2) return key;
  return parts.slice(-2).join(":");
}

function formatLaneLabel(lane: string): string {
  return lane === "main" ? "Main" : lane.charAt(0).toUpperCase() + lane.slice(1);
}

function resolveRoomSlot(room: RoomSpec, slotIndex: number) {
  const column = slotIndex % room.columns;
  const row = Math.floor(slotIndex / room.columns);
  const leftInset = room.columns === 3 ? 48 : 56;
  const rightInset = leftInset;
  const usableWidth = room.width - leftInset - rightInset;
  const xStep = room.columns === 1 ? 0 : usableWidth / Math.max(room.columns - 1, 1);
  const yStep = room.id === "archive" ? 42 : 58;
  return {
    slotId: `${room.id}:${row}:${column}`,
    x: room.x + leftInset + column * xStep,
    y: room.y + 68 + row * yStep,
  };
}

function createSceneBay(
  activity: ActivityState,
  agentId: string,
  index: number,
  count: number,
): ActivitySceneBay {
  const totalGap = HOME_BAY_GAP * Math.max(count - 1, 0);
  const bayWidth = (SCENE_WIDTH - HOME_BAY_MARGIN * 2 - totalGap) / Math.max(count, 1);
  const x = HOME_BAY_MARGIN + index * (bayWidth + HOME_BAY_GAP);
  const workstreamCount = activity.agentsById[agentId]?.workstreamIds.length ?? 0;
  const label = activity.agentsById[agentId]?.persona.name ?? agentId;
  return {
    id: `bay:${agentId}`,
    agentId,
    label,
    state: workstreamCount > 1 ? "split" : "merged",
    workstreamCount,
    x,
    y: HOME_BAY_Y,
    width: bayWidth,
    height: HOME_BAY_HEIGHT,
  };
}

export function deriveActivityScene(
  activity: ActivityState,
  selectedWorkstreamId: string | null,
): ActivitySceneModel {
  const rooms = ROOM_SPECS.map((room) => ({ ...room, label: ACTIVITY_ROOM_LABELS[room.id] }));
  const bays = activity.agentIds.map((agentId, index) =>
    createSceneBay(activity, agentId, index, activity.agentIds.length),
  );
  const roomAssignments = new Map<ActivityRoom, number>();

  const actors = activity.workstreamIds.flatMap((workstreamId) => {
    const workstream = activity.workstreamsById[workstreamId];
    if (!workstream) return [];

    const room = ROOM_SPECS.find((entry) => entry.id === workstream.currentRoom);
    if (!room) return [];

    const nextSlotIndex = roomAssignments.get(room.id) ?? 0;
    roomAssignments.set(room.id, nextSlotIndex + 1);

    const slot = resolveRoomSlot(room, nextSlotIndex);
    const bay = bays.find((entry) => entry.agentId === workstream.agentId);
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
        bayId: bay?.id ?? `bay:${workstream.agentId}`,
        bayX: (bay?.x ?? 0) + (bay?.width ?? 0) / 2,
        bayY: bay?.y ?? HOME_BAY_Y,
        badgeLabel: `${laneLabel} · ${keyLabel}`,
        keyLabel,
        laneLabel,
        bubbleText: workstream.bubbleText,
        attentionLevel: workstream.attentionLevel,
        selected: workstream.id === selectedWorkstreamId,
      } satisfies ActivitySceneActor,
    ];
  });

  return {
    width: SCENE_WIDTH,
    height: SCENE_HEIGHT,
    rooms,
    bays,
    actors,
  };
}
