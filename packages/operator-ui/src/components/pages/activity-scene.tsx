import type { ActivityAttentionLevel, ActivityState } from "@tyrum/operator-core";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn.js";
import { useMediaQuery } from "../../hooks/use-media-query.js";
import { ACTIVITY_ROOM_LABELS, deriveActivityScene } from "./activity-scene-model.js";

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

function hashAgentId(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360;
  }
  return hash;
}

function actorColors(agentId: string) {
  const hue = hashAgentId(agentId);
  return {
    shell: `hsl(${String(hue)} 45% 62%)`,
    shellDark: `hsl(${String(hue)} 42% 46%)`,
    shellLight: `hsl(${String(hue)} 56% 78%)`,
  };
}

function attentionRing(attentionLevel: ActivityAttentionLevel) {
  if (attentionLevel === "critical") return "rgba(197, 106, 95, 0.88)";
  if (attentionLevel === "high") return "rgba(179, 130, 60, 0.82)";
  if (attentionLevel === "medium") return "rgba(123, 107, 82, 0.82)";
  return "rgba(138, 136, 127, 0.5)";
}

function roomTint(roomId: keyof typeof ACTIVITY_ROOM_LABELS): string {
  switch (roomId) {
    case "terminal-lab":
      return "rgba(77, 138, 97, 0.12)";
    case "approval-desk":
      return "rgba(179, 130, 60, 0.12)";
    case "mail-room":
      return "rgba(123, 107, 82, 0.12)";
    case "archive":
      return "rgba(138, 136, 127, 0.12)";
    default:
      return "rgba(123, 107, 82, 0.08)";
  }
}

function renderMascot(agentId: string, active: boolean, attentionLevel: ActivityAttentionLevel) {
  const colors = actorColors(agentId);
  return (
    <svg
      aria-hidden={true}
      viewBox="0 0 72 72"
      className="h-[4.5rem] w-[4.5rem] drop-shadow-[0_6px_14px_rgba(0,0,0,0.24)]"
    >
      <ellipse cx="36" cy="62" rx="16" ry="4.5" fill="rgba(0,0,0,0.18)" />
      <path
        d="M20 31c0-10 7.4-18 16-18s16 8 16 18v16c0 9-7.2 14-16 14S20 56 20 47z"
        fill={colors.shell}
        stroke={colors.shellDark}
        strokeWidth="2.5"
      />
      <circle cx="36" cy="22" r="12.5" fill={colors.shellLight} stroke={colors.shellDark} />
      <path d="M29 20h3.8" stroke="#201f1b" strokeLinecap="round" strokeWidth="2.8" />
      <path d="M39.2 20H43" stroke="#201f1b" strokeLinecap="round" strokeWidth="2.8" />
      <path
        d="M31 27.5c1.8 2 3.5 2.8 5 2.8s3.2-.8 5-2.8"
        stroke="#201f1b"
        strokeLinecap="round"
        strokeWidth="2.4"
      />
      <path
        d="M24 43.5h24"
        stroke={active ? attentionRing(attentionLevel) : colors.shellDark}
        strokeLinecap="round"
        strokeWidth="3"
      />
      <path d="M28 55v8" stroke={colors.shellDark} strokeLinecap="round" strokeWidth="3" />
      <path d="M44 55v8" stroke={colors.shellDark} strokeLinecap="round" strokeWidth="3" />
      <path d="M20 37l-5 4" stroke={colors.shellDark} strokeLinecap="round" strokeWidth="3" />
      <path d="M52 37l5 4" stroke={colors.shellDark} strokeLinecap="round" strokeWidth="3" />
    </svg>
  );
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
      animations.push(
        node.animate(
          [
            { transform: "translateY(0px) scale(1)" },
            { transform: "translateY(-5px) scale(1.02)" },
            { transform: "translateY(1px) scale(0.99)" },
          ],
          {
            duration: 2200 + index * 140,
            delay: index * 80,
            easing: "ease-in-out",
            iterations: Number.POSITIVE_INFINITY,
          },
        ),
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

  return (
    <div className="space-y-4">
      <div
        data-testid="activity-scene-viewport"
        data-motion-mode={prefersReducedMotion ? "reduced" : "full"}
        data-visibility-state={visibilityState}
        className="overflow-hidden rounded-[1.5rem] border border-border/70 bg-bg-card/80"
      >
        <div
          ref={sceneRef}
          className="relative"
          style={{
            aspectRatio: `${String(scene.width)} / ${String(scene.height)}`,
            background:
              "linear-gradient(180deg, rgba(123,107,82,0.14) 0%, rgba(32,35,33,0.06) 46%, rgba(22,23,22,0.02) 100%)",
          }}
        >
          <svg
            aria-label="Hybrid house-office activity building"
            className="absolute inset-0 h-full w-full"
            viewBox={`0 0 ${String(scene.width)} ${String(scene.height)}`}
          >
            <rect
              x="18"
              y="28"
              width="924"
              height="664"
              rx="28"
              fill="var(--tyrum-color-bg-card)"
              stroke="var(--tyrum-color-border)"
            />
            <path
              d="M48 88L168 28l120 60"
              fill="none"
              stroke="var(--tyrum-color-border)"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="5"
            />
            <path
              d="M600 68h312"
              fill="none"
              stroke="var(--tyrum-color-border)"
              strokeLinecap="round"
              strokeWidth="5"
            />
            <path
              d="M48 248h864M48 452h864M48 576h864"
              fill="none"
              stroke="rgba(138,136,127,0.32)"
              strokeDasharray="10 10"
              strokeWidth="2"
            />
            {scene.rooms.map((room) => (
              <g key={room.id}>
                <rect
                  x={room.x}
                  y={room.y}
                  width={room.width}
                  height={room.height}
                  rx="18"
                  fill={roomTint(room.id)}
                  stroke="var(--tyrum-color-border)"
                />
                <text
                  x={room.x + 18}
                  y={room.y + 28}
                  fill="var(--tyrum-color-fg)"
                  fontSize="18"
                  fontWeight="600"
                >
                  {room.label}
                </text>
              </g>
            ))}
            {scene.bays.map((bay) => (
              <g key={bay.id}>
                <rect
                  x={bay.x}
                  y={bay.y}
                  width={bay.width}
                  height={bay.height}
                  rx="18"
                  fill="rgba(123,107,82,0.08)"
                  stroke="var(--tyrum-color-border)"
                />
                <text x={bay.x + 18} y={bay.y + 30} fill="var(--tyrum-color-fg)" fontSize="17">
                  {bay.label}
                </text>
                <text
                  x={bay.x + 18}
                  y={bay.y + 56}
                  fill="var(--tyrum-color-fg-muted)"
                  fontSize="13"
                >
                  {bay.state === "split"
                    ? `Split into ${String(bay.workstreamCount)} streams`
                    : "Merged home bay"}
                </text>
              </g>
            ))}
            {scene.actors.map((actor) => (
              <path
                key={`path:${actor.workstreamId}`}
                d={`M ${String(actor.bayX)} ${String(actor.bayY)} Q ${String((actor.bayX + actor.x) / 2)} ${String(actor.y + 72)} ${String(actor.x)} ${String(actor.y + 26)}`}
                fill="none"
                opacity={actor.selected ? 0.9 : 0.42}
                stroke={attentionRing(actor.attentionLevel)}
                strokeDasharray={actor.selected ? "0" : "5 8"}
                strokeWidth={actor.selected ? 3.2 : 2}
              />
            ))}
          </svg>

          {scene.actors.map((actor) => (
            <button
              key={actor.id}
              type="button"
              aria-label={`${actor.name}, ${actor.badgeLabel}, ${actor.roomLabel}`}
              data-testid={`activity-workstream-${actor.workstreamId}`}
              data-active={actor.selected ? "true" : undefined}
              className={cn(
                "group absolute z-10 w-32 -translate-x-1/2 -translate-y-1/2 text-left transition-all duration-500",
                actor.selected ? "opacity-100" : "opacity-95 hover:opacity-100",
              )}
              style={{
                left: `${String((actor.x / scene.width) * 100)}%`,
                top: `${String((actor.y / scene.height) * 100)}%`,
              }}
              onClick={() => {
                onSelectWorkstream(actor.workstreamId);
              }}
            >
              {actor.bubbleText ? (
                <div
                  data-activity-motion="bubble"
                  className={cn(
                    "mx-auto mb-2 w-fit max-w-28 rounded-2xl border border-border/80 bg-bg/90 px-3 py-1.5 text-center text-[11px] leading-4 text-fg shadow-sm",
                    !shouldAnimate && "opacity-95",
                  )}
                >
                  {actor.bubbleText}
                </div>
              ) : null}
              <div
                data-activity-motion="actor"
                className="flex flex-col items-center"
                style={{
                  filter: actor.selected
                    ? `drop-shadow(0 0 0.75rem ${attentionRing(actor.attentionLevel)})`
                    : undefined,
                }}
              >
                {renderMascot(actor.agentId, actor.selected, actor.attentionLevel)}
                <span className="mt-2 rounded-full border border-border/80 bg-bg/92 px-2.5 py-1 text-center text-[11px] font-medium text-fg shadow-sm">
                  {actor.badgeLabel}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        <span className="rounded-full border border-border/70 bg-bg-subtle/40 px-2.5 py-1">
          One actor per active key plus lane
        </span>
        <span className="rounded-full border border-border/70 bg-bg-subtle/40 px-2.5 py-1">
          Same-agent streams share mascot identity
        </span>
        <span className="rounded-full border border-border/70 bg-bg-subtle/40 px-2.5 py-1">
          {prefersReducedMotion
            ? "Reduced motion: static room cues only"
            : visibilityState === "hidden"
              ? "Motion paused while the tab is hidden"
              : "WAAPI idle loops active"}
        </span>
      </div>
    </div>
  );
}
