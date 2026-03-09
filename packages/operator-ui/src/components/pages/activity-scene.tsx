import type { ActivityRoom, ActivityState } from "@tyrum/operator-core";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn.js";
import { useMediaQuery } from "../../hooks/use-media-query.js";
import { RoomFurniture } from "./activity-scene-furniture.js";
import {
  PALETTE_COLORS,
  actorColors,
  attentionRing,
  renderMascot,
} from "./activity-scene-mascot.js";
import { deriveActivityScene } from "./activity-scene-model.js";

interface ActivitySceneProps {
  activity: ActivityState;
  selectedWorkstreamId: string | null;
  onSelectWorkstream: (workstreamId: string) => void;
}

function useVisibilityState(): DocumentVisibilityState {
  const [visibilityState, setVisibilityState] = useState<DocumentVisibilityState>(() => {
    if (typeof document === "undefined") return "visible";
    return document.visibilityState;
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleChange = () => {
      setVisibilityState(document.visibilityState);
    };
    document.addEventListener("visibilitychange", handleChange);
    return () => {
      document.removeEventListener("visibilitychange", handleChange);
    };
  }, []);

  return visibilityState;
}

const ROOM_AMBIENT: Record<ActivityRoom, string> = {
  "terminal-lab": "rgba(77, 138, 97, 0.10)",
  "approval-desk": "rgba(179, 130, 60, 0.08)",
  "mail-room": "rgba(123, 107, 82, 0.07)",
  archive: "rgba(138, 136, 127, 0.06)",
  library: "rgba(170, 140, 70, 0.08)",
  "strategy-desk": "rgba(123, 107, 82, 0.06)",
  lounge: "rgba(160, 120, 80, 0.07)",
};

function idleAnimParams(roomId: ActivityRoom): { duration: number; keyframes: Keyframe[] } {
  switch (roomId) {
    case "terminal-lab":
      return {
        duration: 1400,
        keyframes: [
          { transform: "translateY(0px) scale(1)" },
          { transform: "translateY(-2px) scale(1.01)" },
          { transform: "translateY(1px) scale(0.995)" },
        ],
      };
    case "lounge":
      return {
        duration: 3200,
        keyframes: [
          { transform: "translateY(0px) scale(1)" },
          { transform: "translateY(-3px) scale(1.01)" },
          { transform: "translateY(1px) scale(0.99)" },
        ],
      };
    default:
      return {
        duration: 2200,
        keyframes: [
          { transform: "translateY(0px) scale(1)" },
          { transform: "translateY(-5px) scale(1.02)" },
          { transform: "translateY(1px) scale(0.99)" },
        ],
      };
  }
}

export function ActivityScene({
  activity,
  selectedWorkstreamId,
  onSelectWorkstream,
}: ActivitySceneProps) {
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const visibilityState = useVisibilityState();
  const shouldAnimate = !prefersReducedMotion && visibilityState === "visible";
  const scene = deriveActivityScene(activity, selectedWorkstreamId);
  const motionSignature = scene.actors
    .map(
      (actor) => `${actor.workstreamId}:${actor.slotId}:${actor.bubbleText ? "bubble" : "quiet"}`,
    )
    .join("|");
  const sceneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = sceneRef.current;
    if (!root) return;

    const motionNodes = Array.from(
      root.querySelectorAll<HTMLElement>(
        "[data-activity-motion='actor'], [data-activity-motion='bubble']",
      ),
    );
    for (const node of motionNodes) {
      node.getAnimations?.().forEach((animation) => animation.cancel());
    }
    if (!shouldAnimate) return;

    const animations: Animation[] = [];
    const actorNodes = Array.from(
      root.querySelectorAll<HTMLElement>("[data-activity-motion='actor']"),
    );
    for (const [index, node] of actorNodes.entries()) {
      if (typeof node.animate !== "function") continue;
      const roomId = (node.dataset["roomId"] ?? "lounge") as ActivityRoom;
      const params = idleAnimParams(roomId);
      animations.push(
        node.animate(params.keyframes, {
          duration: params.duration + index * 140,
          delay: index * 80,
          easing: "ease-in-out",
          iterations: Number.POSITIVE_INFINITY,
        }),
      );
    }

    const bubbleNodes = Array.from(
      root.querySelectorAll<HTMLElement>("[data-activity-motion='bubble']"),
    );
    for (const [index, node] of bubbleNodes.entries()) {
      if (typeof node.animate !== "function") continue;
      animations.push(
        node.animate([{ transform: "translateY(0px)" }, { transform: "translateY(-3px)" }], {
          duration: 1600 + index * 120,
          delay: 120,
          direction: "alternate",
          easing: "ease-in-out",
          iterations: Number.POSITIVE_INFINITY,
        }),
      );
    }

    return () => {
      for (const animation of animations) {
        animation.cancel();
      }
    };
  }, [motionSignature, shouldAnimate]);

  const W = scene.width;
  const H = scene.height;
  const WALL = 8;
  const FLOOR_H = 6;
  const fc = "var(--tyrum-color-border)";
  const wallFill = "rgba(80,76,68,0.45)";
  const floorFill = "rgba(100,96,88,0.38)";

  return (
    <div>
      <div
        data-testid="activity-scene-viewport"
        data-motion-mode={prefersReducedMotion ? "reduced" : "full"}
        data-visibility-state={visibilityState}
        className="overflow-hidden border border-border/50 bg-bg-card/80"
        style={{ borderRadius: "6px" }}
      >
        <div
          ref={sceneRef}
          className="relative"
          style={{
            aspectRatio: `${String(W)} / ${String(H)}`,
            background:
              "linear-gradient(180deg, rgba(100,96,88,0.10) 0%, rgba(32,35,33,0.04) 50%, rgba(22,23,22,0.02) 100%)",
          }}
        >
          <svg
            aria-label="Activity building cutaway"
            className="absolute inset-0 h-full w-full"
            viewBox={`0 0 ${String(W)} ${String(H)}`}
          >
            <defs>
              {scene.rooms.map((room) => (
                <radialGradient
                  key={`ambient-${room.id}`}
                  id={`ambient-${room.id}`}
                  cx="50%"
                  cy="60%"
                  r="70%"
                >
                  <stop offset="0%" stopColor={ROOM_AMBIENT[room.id]} />
                  <stop offset="100%" stopColor="rgba(0,0,0,0)" />
                </radialGradient>
              ))}
            </defs>

            {/* Building shell — outer walls */}
            <rect
              x={18}
              y={24}
              width={W - 36}
              height={H - 48}
              fill="none"
              stroke={wallFill}
              strokeWidth={WALL}
            />

            {/* Roof parapet */}
            <rect x={14} y={20} width={W - 28} height={WALL} fill={floorFill} />
            {/* Rooftop details */}
            <rect x={120} y={10} width="4" height="14" fill={fc} />
            <rect x={116} y={8} width="12" height="4" rx="1" fill={fc} />
            <rect
              x={W - 160}
              y={12}
              width="20"
              height="10"
              rx="2"
              fill="none"
              stroke={fc}
              strokeWidth="1.5"
            />
            <rect x={W - 156} y={14} width="5" height="6" rx="1" fill={fc} opacity="0.4" />

            {/* Floor slabs */}
            {[248, 452, 576].map((fy) => (
              <rect
                key={`floor-${fy}`}
                x={22}
                y={fy - FLOOR_H / 2}
                width={W - 44}
                height={FLOOR_H}
                fill={floorFill}
              />
            ))}

            {/* Foundation slab above home bays */}
            <rect x={18} y={576} width={W - 36} height={WALL + 2} fill={wallFill} />

            {/* Ground line */}
            <rect x={0} y={H - 24} width={W} height={24} fill="rgba(60,58,52,0.18)" />
            <path d={`M0 ${H - 24}h${W}`} stroke={fc} strokeWidth="1" opacity="0.4" />
            {/* Terrain marks */}
            {[60, 180, 340, 520, 680, 820].map((gx) => (
              <path
                key={`grass-${gx}`}
                d={`M${gx} ${H - 18}c2-6 6-6 8 0`}
                stroke="rgba(90,110,75,0.25)"
                strokeWidth="1.5"
                fill="none"
              />
            ))}

            {/* Rooms — walls and fills */}
            {scene.rooms.map((room) => {
              const roomSpec = room;
              return (
                <g key={room.id}>
                  {/* Room background */}
                  <rect
                    x={roomSpec.x}
                    y={roomSpec.y}
                    width={roomSpec.width}
                    height={roomSpec.height}
                    fill={ROOM_AMBIENT[room.id]}
                  />
                  {/* Ambient glow */}
                  <rect
                    x={roomSpec.x}
                    y={roomSpec.y}
                    width={roomSpec.width}
                    height={roomSpec.height}
                    fill={`url(#ambient-${room.id})`}
                  />
                  {/* Room nameplate */}
                  <rect
                    x={roomSpec.x + 10}
                    y={roomSpec.y + 6}
                    width={Math.min(roomSpec.label.length * 9 + 12, roomSpec.width - 20)}
                    height="18"
                    rx="3"
                    fill="rgba(32,35,33,0.6)"
                  />
                  <text
                    x={roomSpec.x + 16}
                    y={roomSpec.y + 19}
                    fill="var(--tyrum-color-fg-muted)"
                    fontSize="11"
                    fontWeight="500"
                  >
                    {roomSpec.label}
                  </text>

                  {/* Furniture */}
                  <RoomFurniture
                    roomId={room.id}
                    x={roomSpec.x}
                    y={roomSpec.y}
                    w={roomSpec.width}
                    h={roomSpec.height}
                  />
                </g>
              );
            })}

            {/* Vertical wall dividers — segmented with doorway gaps */}
            {/* Floor 1 left wall (lounge | strategy-desk): gap at y=170-210 */}
            <rect x={292} y={28} width={4} height={142} fill={wallFill} />
            <rect x={292} y={210} width={4} height={38} fill={wallFill} />
            {/* Floor 1 right wall (strategy-desk | approval-desk): gap at y=170-210 */}
            <rect x={568} y={28} width={4} height={142} fill={wallFill} />
            <rect x={568} y={210} width={4} height={38} fill={wallFill} />
            {/* Floor 2 left wall (library | terminal-lab): gap at y=370-410 */}
            <rect x={292} y={248} width={4} height={122} fill={wallFill} />
            <rect x={292} y={410} width={4} height={42} fill={wallFill} />
            {/* Floor 2 right wall (terminal-lab | mail-room): gap at y=370-410 */}
            <rect x={568} y={248} width={4} height={122} fill={wallFill} />
            <rect x={568} y={410} width={4} height={42} fill={wallFill} />

            {/* Cutaway hatch on left and right edges */}
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((i) => (
              <g key={`hatch-${i}`}>
                <path
                  d={`M22 ${28 + i * 40}l-6 12`}
                  stroke="rgba(138,136,127,0.18)"
                  strokeWidth="1"
                />
                <path
                  d={`M${W - 22} ${28 + i * 40}l6 12`}
                  stroke="rgba(138,136,127,0.18)"
                  strokeWidth="1"
                />
              </g>
            ))}

            {/* Home bays */}
            {scene.bays.map((bay) => (
              <g key={bay.id}>
                <rect
                  x={bay.x}
                  y={bay.y}
                  width={bay.width}
                  height={bay.height}
                  fill="rgba(60,58,52,0.12)"
                  stroke={fc}
                  strokeWidth="1"
                  strokeDasharray="4 3"
                />
                {/* Nameplate */}
                <rect
                  x={bay.x + 8}
                  y={bay.y + 6}
                  width={Math.min(bay.label.length * 7 + 10, bay.width - 16)}
                  height="16"
                  rx="2"
                  fill="rgba(32,35,33,0.5)"
                />
                <text
                  x={bay.x + 13}
                  y={bay.y + 18}
                  fill="var(--tyrum-color-fg-muted)"
                  fontSize="10"
                  fontWeight="500"
                >
                  {bay.label}
                </text>
                {/* Desk */}
                <rect
                  x={bay.x + 10}
                  y={bay.y + 30}
                  width={Math.min(bay.width - 20, 60)}
                  height="2"
                  rx="0.5"
                  fill={fc}
                  opacity="0.4"
                />
                {/* Mug */}
                <rect
                  x={bay.x + bay.width - 28}
                  y={bay.y + 24}
                  width="6"
                  height="8"
                  rx="1.5"
                  fill="none"
                  stroke={fc}
                  strokeWidth="1"
                  opacity="0.3"
                />
                {/* Plant */}
                <circle
                  cx={bay.x + bay.width - 40}
                  cy={bay.y + 26}
                  r="4"
                  fill="rgba(77,120,72,0.2)"
                />
              </g>
            ))}

            {/* Connection paths — actor to home bay */}
            {scene.actors.map((actor) => {
              const ws = activity.workstreamsById[actor.workstreamId];
              const colors = ws ? actorColors(ws.persona) : PALETTE_COLORS["graphite"]!;
              return (
                <path
                  key={`path:${actor.workstreamId}`}
                  d={`M ${String(actor.bayX)} ${String(actor.bayY)} Q ${String((actor.bayX + actor.x) / 2)} ${String(actor.y + 72)} ${String(actor.x)} ${String(actor.y + 26)}`}
                  fill="none"
                  opacity={actor.selected ? 0.6 : 0.15}
                  stroke={colors.shell}
                  strokeWidth={actor.selected ? 2 : 1.5}
                />
              );
            })}
          </svg>

          {/* Actor overlays */}
          {scene.actors.map((actor) => {
            const ws = activity.workstreamsById[actor.workstreamId];
            const persona = ws?.persona ?? {
              name: "Agent",
              description: "",
              tone: "direct",
              palette: "graphite",
              character: "operator",
            };
            return (
              <button
                key={actor.id}
                type="button"
                aria-label={`${actor.name}, ${actor.badgeLabel}, ${actor.roomLabel}`}
                data-testid={`activity-workstream-${actor.workstreamId}`}
                data-active={actor.selected ? "true" : undefined}
                className={cn(
                  "group absolute z-10 w-32 -translate-x-1/2 -translate-y-1/2 text-left transition-opacity duration-300",
                  actor.selected ? "opacity-100" : "opacity-90 hover:opacity-100",
                )}
                style={{
                  left: `${String((actor.x / W) * 100)}%`,
                  top: `${String((actor.y / H) * 100)}%`,
                }}
                onClick={() => {
                  onSelectWorkstream(actor.workstreamId);
                }}
              >
                {actor.bubbleText ? (
                  <div
                    data-activity-motion="bubble"
                    className={cn(
                      "mx-auto mb-2 w-fit max-w-28 rounded-md border border-border/60 bg-bg/90 px-2 py-1 text-center text-[10px] leading-[14px] text-fg shadow-sm",
                      !shouldAnimate && "opacity-95",
                    )}
                  >
                    {actor.bubbleText}
                  </div>
                ) : null}
                <div
                  data-activity-motion="actor"
                  data-room-id={actor.roomId}
                  className="flex flex-col items-center"
                  style={{
                    filter: actor.selected
                      ? `drop-shadow(0 0 0.6rem ${attentionRing(actor.attentionLevel)})`
                      : undefined,
                  }}
                >
                  {renderMascot(persona, actor.selected, actor.attentionLevel, actor.roomId)}
                  <span className="mt-1 rounded border border-border/60 bg-bg/90 px-1.5 py-0.5 text-center text-[10px] font-medium text-fg shadow-sm">
                    {actor.badgeLabel}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
