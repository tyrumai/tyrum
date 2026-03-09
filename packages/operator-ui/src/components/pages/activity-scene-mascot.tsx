import type { ActivityAttentionLevel, ActivityRoom } from "@tyrum/operator-core";
import type { AgentPersona } from "@tyrum/schemas";

export const PALETTE_COLORS: Record<
  string,
  { shell: string; shellDark: string; shellLight: string }
> = {
  graphite: {
    shell: "hsl(220 12% 52%)",
    shellDark: "hsl(220 14% 38%)",
    shellLight: "hsl(220 16% 68%)",
  },
  moss: {
    shell: "hsl(145 32% 48%)",
    shellDark: "hsl(145 34% 34%)",
    shellLight: "hsl(145 36% 64%)",
  },
  ember: { shell: "hsl(28 55% 52%)", shellDark: "hsl(28 50% 38%)", shellLight: "hsl(28 60% 68%)" },
  ocean: {
    shell: "hsl(195 50% 48%)",
    shellDark: "hsl(195 52% 34%)",
    shellLight: "hsl(195 54% 64%)",
  },
  linen: { shell: "hsl(35 35% 58%)", shellDark: "hsl(35 30% 42%)", shellLight: "hsl(35 40% 72%)" },
  slate: {
    shell: "hsl(210 18% 50%)",
    shellDark: "hsl(210 20% 36%)",
    shellLight: "hsl(210 22% 66%)",
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
  const lean = roomId === "terminal-lab" ? -3 : roomId === "library" ? 2 : 0;
  return (
    <svg
      aria-hidden={true}
      viewBox="0 0 72 72"
      className="h-[4.5rem] w-[4.5rem] drop-shadow-[0_6px_14px_rgba(0,0,0,0.24)]"
      style={lean ? { transform: `rotate(${lean}deg)` } : undefined}
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
      <CharacterAccessory character={persona.character} headCx={36} headCy={22} />
    </svg>
  );
}
