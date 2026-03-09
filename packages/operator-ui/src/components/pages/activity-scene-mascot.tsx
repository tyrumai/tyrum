import type { ActivityAttentionLevel, ActivityRoom } from "@tyrum/operator-core";
import type { AgentPersona } from "@tyrum/schemas";

export const PALETTE_COLORS: Record<
  string,
  { shell: string; shellDark: string; shellLight: string }
> = {
  graphite: {
    shell: "hsl(220 14% 56%)",
    shellDark: "hsl(220 16% 40%)",
    shellLight: "hsl(220 18% 72%)",
  },
  moss: {
    shell: "hsl(145 36% 52%)",
    shellDark: "hsl(145 38% 36%)",
    shellLight: "hsl(145 40% 68%)",
  },
  ember: {
    shell: "hsl(28 58% 56%)",
    shellDark: "hsl(28 52% 40%)",
    shellLight: "hsl(28 62% 72%)",
  },
  ocean: {
    shell: "hsl(195 52% 52%)",
    shellDark: "hsl(195 55% 36%)",
    shellLight: "hsl(195 58% 68%)",
  },
  linen: {
    shell: "hsl(35 38% 62%)",
    shellDark: "hsl(35 32% 44%)",
    shellLight: "hsl(35 42% 76%)",
  },
  slate: {
    shell: "hsl(210 20% 54%)",
    shellDark: "hsl(210 22% 38%)",
    shellLight: "hsl(210 24% 70%)",
  },
};

export function actorColors(persona: AgentPersona) {
  return PALETTE_COLORS[persona.palette] ?? PALETTE_COLORS["graphite"]!;
}

export function attentionRing(attentionLevel: ActivityAttentionLevel) {
  if (attentionLevel === "critical") return "rgba(197, 106, 95, 0.88)";
  if (attentionLevel === "high") return "rgba(179, 130, 60, 0.82)";
  if (attentionLevel === "medium") return "rgba(123, 107, 82, 0.82)";
  return "rgba(138, 136, 127, 0.5)";
}

function CharacterAccessory({
  character,
  headCx,
  headCy,
}: {
  character: string;
  headCx: number;
  headCy: number;
}) {
  switch (character) {
    case "architect":
      return <path d={`M${headCx - 10} ${headCy - 10}h20v3h-20z`} fill="#8a7a60" opacity="0.7" />;
    case "analyst":
      return (
        <>
          <circle
            cx={headCx - 5}
            cy={headCy - 2}
            r="3.5"
            fill="none"
            stroke="#201f1b"
            strokeWidth="1.5"
          />
          <circle
            cx={headCx + 5}
            cy={headCy - 2}
            r="3.5"
            fill="none"
            stroke="#201f1b"
            strokeWidth="1.5"
          />
          <path d={`M${headCx - 1.5} ${headCy - 2}h3`} stroke="#201f1b" strokeWidth="1.2" />
        </>
      );
    case "researcher":
      return (
        <>
          <circle
            cx={headCx + 18}
            cy={headCy + 8}
            r="5"
            fill="none"
            stroke="#8a7a60"
            strokeWidth="1.8"
          />
          <path
            d={`M${headCx + 22} ${headCy + 12}l4 4`}
            stroke="#8a7a60"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </>
      );
    case "operator":
      return (
        <path
          d={`M${headCx - 12} ${headCy - 8}a14 14 0 0 1 24 0`}
          fill="none"
          stroke="#8a7a60"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      );
    case "builder":
      return (
        <path
          d={`M${headCx - 8} ${headCy + 22}h16`}
          stroke="#8a7a60"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      );
    case "navigator":
      return (
        <>
          <circle
            cx={headCx}
            cy={headCy + 18}
            r="4"
            fill="none"
            stroke="#8a7a60"
            strokeWidth="1.5"
          />
          <path
            d={`M${headCx} ${headCy + 14}v8M${headCx - 4} ${headCy + 18}h8`}
            stroke="#8a7a60"
            strokeWidth="1"
          />
        </>
      );
    default:
      return null;
  }
}

export function renderMascot(
  persona: AgentPersona,
  active: boolean,
  attentionLevel: ActivityAttentionLevel,
  roomId: ActivityRoom,
) {
  const colors = actorColors(persona);
  const lean =
    roomId === "terminal-lab"
      ? -4
      : roomId === "library"
        ? 3
        : roomId === "archive"
          ? -2
          : roomId === "strategy-desk"
            ? 2
            : 0;
  return (
    <svg
      aria-hidden={true}
      viewBox="0 0 72 72"
      className="h-[3.5rem] w-[3.5rem] drop-shadow-[0_4px_12px_rgba(0,0,0,0.18)]"
      style={lean ? { transform: `rotate(${lean}deg)` } : undefined}
    >
      <ellipse cx="36" cy="62" rx="16" ry="4.5" fill="rgba(0,0,0,0.14)" />
      <path
        d="M20 31c0-10 7.4-18 16-18s16 8 16 18v16c0 9-7.2 14-16 14S20 56 20 47z"
        fill={colors.shell}
        stroke={colors.shellDark}
        strokeWidth="2.5"
      />
      <circle cx="36" cy="22" r="12.5" fill={colors.shellLight} stroke={colors.shellDark} />
      {/* Eyes (rounder, friendlier) */}
      <circle cx="30.5" cy="20" r="2" fill="#2a2925" />
      <circle cx="41.5" cy="20" r="2" fill="#2a2925" />
      <circle cx="31" cy="19.2" r="0.7" fill="rgba(255,255,255,0.55)" />
      <circle cx="42" cy="19.2" r="0.7" fill="rgba(255,255,255,0.55)" />
      {/* Rosy cheeks */}
      <circle cx="27" cy="24" r="3.5" fill="rgba(220,150,140,0.28)" />
      <circle cx="45" cy="24" r="3.5" fill="rgba(220,150,140,0.28)" />
      {/* Friendly smile */}
      <path
        d="M31 27c1.6 2.2 3.2 3 5 3s3.4-.8 5-3"
        stroke="#2a2925"
        strokeLinecap="round"
        strokeWidth="2"
        fill="none"
      />
      {/* Belt */}
      <path
        d="M24 43.5h24"
        stroke={active ? attentionRing(attentionLevel) : colors.shellDark}
        strokeLinecap="round"
        strokeWidth="3"
      />
      {/* Legs */}
      <path d="M28 55v8" stroke={colors.shellDark} strokeLinecap="round" strokeWidth="3" />
      <path d="M44 55v8" stroke={colors.shellDark} strokeLinecap="round" strokeWidth="3" />
      {/* Arms */}
      <path d="M20 37l-5 4" stroke={colors.shellDark} strokeLinecap="round" strokeWidth="3" />
      <path d="M52 37l5 4" stroke={colors.shellDark} strokeLinecap="round" strokeWidth="3" />
      <CharacterAccessory character={persona.character} headCx={36} headCy={22} />
    </svg>
  );
}
