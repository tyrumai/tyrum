import type { ActivityRoom, ActivityState } from "@tyrum/operator-core";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn.js";
import { useMediaQuery } from "../../hooks/use-media-query.js";
import { RoomFurniture } from "./activity-scene-furniture.js";
import { attentionRing, renderMascot } from "./activity-scene-mascot.js";
import { deriveActivityScene } from "./activity-scene-model.js";
import { CeilingLight, LightPool, SceneStructure } from "./activity-scene-svg-parts.js";

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
  lounge: "rgba(210, 175, 130, 0.20)",
  "strategy-desk": "rgba(160, 180, 155, 0.18)",
  "approval-desk": "rgba(200, 170, 140, 0.18)",
  library: "rgba(195, 165, 125, 0.20)",
  "terminal-lab": "rgba(135, 180, 160, 0.20)",
  "mail-room": "rgba(200, 185, 145, 0.16)",
  archive: "rgba(170, 165, 180, 0.14)",
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
    .map((a) => `${a.workstreamId}:${a.slotId}:${a.bubbleText ? "bubble" : "quiet"}`)
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
      node.getAnimations?.().forEach((a) => a.cancel());
    }
    if (!shouldAnimate) return;

    const animations: Animation[] = [];
    for (const [index, node] of Array.from(
      root.querySelectorAll<HTMLElement>("[data-activity-motion='actor']"),
    ).entries()) {
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
    for (const [index, node] of Array.from(
      root.querySelectorAll<HTMLElement>("[data-activity-motion='bubble']"),
    ).entries()) {
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

    for (const node of Array.from(
      root.querySelectorAll<SVGElement>("[data-activity-motion='led']"),
    )) {
      if (typeof node.animate !== "function") continue;
      animations.push(
        node.animate([{ opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }], {
          duration: 1200 + Math.random() * 800,
          easing: "ease-in-out",
          iterations: Number.POSITIVE_INFINITY,
        }),
      );
    }
    for (const node of Array.from(
      root.querySelectorAll<SVGElement>("[data-activity-motion='screen']"),
    )) {
      if (typeof node.animate !== "function") continue;
      animations.push(
        node.animate([{ opacity: 1 }, { opacity: 0.85 }, { opacity: 1 }], {
          duration: 3000,
          easing: "ease-in-out",
          iterations: Number.POSITIVE_INFINITY,
        }),
      );
    }
    for (const node of Array.from(
      root.querySelectorAll<SVGElement>("[data-activity-motion='fan']"),
    )) {
      if (typeof node.animate !== "function") continue;
      animations.push(
        node.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], {
          duration: 4000,
          easing: "linear",
          iterations: Number.POSITIVE_INFINITY,
        }),
      );
    }

    return () => {
      for (const a of animations) {
        a.cancel();
      }
    };
  }, [motionSignature, shouldAnimate]);

  const W = scene.width;
  const H = scene.height;

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
              "linear-gradient(180deg, rgba(215,200,180,0.08) 0%, rgba(200,188,170,0.04) 50%, rgba(188,178,162,0.02) 100%)",
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

            <SceneStructure W={W} H={H} />

            {scene.rooms.map((room) => {
              const lightCount = room.width > 280 ? 3 : 2;
              const spacing = room.width / (lightCount + 1);
              return (
                <g key={room.id}>
                  <rect
                    x={room.x}
                    y={room.y}
                    width={room.width}
                    height={room.height}
                    fill={ROOM_AMBIENT[room.id]}
                  />
                  <rect
                    x={room.x}
                    y={room.y}
                    width={room.width}
                    height={room.height}
                    fill={`url(#ambient-${room.id})`}
                  />
                  <rect
                    x={room.x + 10}
                    y={room.y + 6}
                    width={Math.min(room.label.length * 9 + 12, room.width - 20)}
                    height="18"
                    rx="3"
                    fill="rgba(32,35,33,0.6)"
                  />
                  <text
                    x={room.x + 16}
                    y={room.y + 19}
                    fill="var(--tyrum-color-fg-muted)"
                    fontSize="11"
                    fontWeight="500"
                  >
                    {room.label}
                  </text>
                  {Array.from({ length: lightCount }, (_, i) => {
                    const lx = room.x + spacing * (i + 1);
                    return (
                      <g key={`light-${room.id}-${i}`}>
                        <CeilingLight cx={lx} y={room.y + 2} />
                        <LightPool cx={lx} cy={room.y + room.height - 14} />
                      </g>
                    );
                  })}
                  <RoomFurniture
                    roomId={room.id}
                    x={room.x}
                    y={room.y}
                    w={room.width}
                    h={room.height}
                  />
                </g>
              );
            })}
          </svg>

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
                  "group absolute z-10 w-24 -translate-x-1/2 -translate-y-1/2 text-left transition-opacity duration-300",
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
                      "mx-auto mb-1 w-fit max-w-24 rounded-md border border-border/60 bg-bg/90 px-1.5 py-0.5 text-center text-[9px] leading-[12px] text-fg shadow-sm",
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
                      ? `drop-shadow(0 0 0.5rem ${attentionRing(actor.attentionLevel)})`
                      : undefined,
                  }}
                >
                  {renderMascot(persona, actor.selected, actor.attentionLevel, actor.roomId)}
                  <span className="mt-0.5 rounded border border-border/60 bg-bg/90 px-1 py-px text-center text-[9px] font-medium text-fg shadow-sm">
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
