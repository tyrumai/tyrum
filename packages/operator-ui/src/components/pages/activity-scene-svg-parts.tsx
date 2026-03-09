const PIPE_COLOR = "rgba(130,125,115,0.35)";
const RIVET_COLOR = "rgba(138,136,127,0.30)";
const LIGHT_GLOW = "rgba(240,220,160,0.22)";
const LIGHT_BULB = "rgba(250,235,180,0.45)";

export function PipeSegment({
  x,
  y,
  length,
  vertical,
}: {
  x: number;
  y: number;
  length: number;
  vertical?: boolean;
}) {
  if (vertical) {
    return (
      <g>
        <rect x={x} y={y} width={6} height={length} rx={3} fill={PIPE_COLOR} />
        <circle cx={x + 3} cy={y + 8} r={4} fill="none" stroke={RIVET_COLOR} strokeWidth="1.2" />
        <circle
          cx={x + 3}
          cy={y + length - 8}
          r={4}
          fill="none"
          stroke={RIVET_COLOR}
          strokeWidth="1.2"
        />
      </g>
    );
  }
  return (
    <g>
      <rect x={x} y={y} width={length} height={6} rx={3} fill={PIPE_COLOR} />
      <circle cx={x + 10} cy={y + 3} r={4} fill="none" stroke={RIVET_COLOR} strokeWidth="1.2" />
      {length > 60 && (
        <circle
          cx={x + length - 10}
          cy={y + 3}
          r={4}
          fill="none"
          stroke={RIVET_COLOR}
          strokeWidth="1.2"
        />
      )}
    </g>
  );
}

export function Rivet({ cx, cy }: { cx: number; cy: number }) {
  return <circle cx={cx} cy={cy} r="2" fill={RIVET_COLOR} />;
}

export function CeilingLight({ cx, y }: { cx: number; y: number }) {
  return (
    <g>
      <rect x={cx - 1} y={y} width={2} height={14} rx={1} fill="rgba(140,135,125,0.4)" />
      <rect x={cx - 6} y={y + 12} width={12} height={4} rx={2} fill="rgba(180,175,160,0.35)" />
      <circle cx={cx} cy={y + 16} r={2.5} fill={LIGHT_BULB} />
      <ellipse cx={cx} cy={y + 20} rx={18} ry={10} fill={LIGHT_GLOW} />
    </g>
  );
}

export function LightPool({ cx, cy, rx }: { cx: number; cy: number; rx?: number }) {
  return <ellipse cx={cx} cy={cy} rx={rx ?? 30} ry={8} fill="rgba(240,220,160,0.08)" />;
}

export function CableRun({ x, y, length }: { x: number; y: number; length: number }) {
  return (
    <path
      d={`M${x} ${y}q${length * 0.25} 6 ${length * 0.5} 2t${length * 0.5} 3`}
      fill="none"
      stroke="rgba(60,60,55,0.3)"
      strokeWidth="1.5"
    />
  );
}

export function SceneStructure({ W, H }: { W: number; H: number }) {
  const fc = "var(--tyrum-color-border)";
  const wallFill = "rgba(85,80,72,0.55)";
  const floorFill = "rgba(105,100,92,0.45)";
  return (
    <>
      <rect x={0} y={H - 160} width={W} height={160} fill="rgba(75,62,42,0.22)" />
      <rect x={0} y={H - 160} width={W} height={40} fill="rgba(95,78,52,0.14)" />
      <path d={`M0 ${H - 160}h${W}`} stroke="rgba(90,75,50,0.35)" strokeWidth="2" />
      {[40, 180, 360, 540, 720, 880].map((gx) => (
        <path
          key={`grass-${gx}`}
          d={`M${gx} ${H - 160}c1-10 4-14 7-8c2-10 5-14 8-6`}
          stroke="rgba(90,120,70,0.30)"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
      ))}
      <ellipse cx={120} cy={H - 100} rx={16} ry={8} fill="rgba(120,115,105,0.15)" />
      <ellipse cx={460} cy={H - 110} rx={12} ry={6} fill="rgba(130,120,108,0.12)" />
      <ellipse cx={780} cy={H - 95} rx={14} ry={7} fill="rgba(118,112,102,0.15)" />
      <path
        d={`M240 ${H - 155}q12 14 6 40`}
        stroke="rgba(115,85,50,0.15)"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d={`M680 ${H - 155}q-10 18 4 36`}
        stroke="rgba(115,85,50,0.15)"
        strokeWidth="1.5"
        fill="none"
      />
      <rect
        x={20}
        y={36}
        width={W - 40}
        height={H - 196}
        rx={2}
        fill="none"
        stroke={wallFill}
        strokeWidth={14}
      />
      <rect x={13} y={28} width={W - 26} height={14} rx={2} fill={floorFill} />
      <rect
        x={80}
        y={8}
        width={22}
        height={22}
        rx={2}
        fill="rgba(100,96,88,0.3)"
        stroke={fc}
        strokeWidth="0.8"
      />
      <rect x={76} y={4} width={30} height={6} rx={2} fill="rgba(110,105,95,0.35)" />
      <rect x={89} y={30} width={4} height={4} rx={1} fill={fc} />
      <rect x={200} y={12} width={5} height={20} rx={2} fill={fc} />
      <rect x={196} y={8} width={13} height={5} rx={1} fill={fc} />
      <rect
        x={W - 180}
        y={6}
        width={20}
        height={24}
        rx={2}
        fill="rgba(100,96,88,0.3)"
        stroke={fc}
        strokeWidth="0.8"
      />
      <circle
        data-activity-motion="fan"
        cx={W - 170}
        cy={18}
        r={8}
        fill="none"
        stroke={fc}
        strokeWidth="1.2"
      />
      <path d={`M${W - 174} 14l8 8M${W - 166} 14l-8 8`} stroke={fc} strokeWidth="0.8" />
      <rect x={300} y={18} width={200} height={4} rx={2} fill="rgba(130,125,115,0.25)" />
      <rect
        x={W - 100}
        y={10}
        width={24}
        height={14}
        rx={2}
        fill="none"
        stroke={fc}
        strokeWidth="1.2"
      />
      <rect x={W - 96} y={14} width={6} height={6} rx={1} fill={fc} opacity="0.35" />
      <rect x={560} y={6} width={4} height={24} rx={2} fill={fc} />
      <rect x={556} y={2} width={12} height={6} rx={1} fill={fc} />
      {[292, 572].map((fy) => (
        <g key={`floor-${fy}`}>
          <rect x={27} y={fy} width={W - 54} height={14} rx={2} fill={floorFill} />
          {[100, 250, 400, 550, 700, 850].map((rx) => (
            <circle
              key={`rivet-${fy}-${rx}`}
              cx={rx}
              cy={fy + 7}
              r="2"
              fill="rgba(138,136,127,0.25)"
            />
          ))}
        </g>
      ))}
      <rect x={20} y={732} width={W - 40} height={22} rx={2} fill={wallFill} />
      {[80, 200, 340, 480, 620, 760, 880].map((rx) => (
        <circle key={`fnd-${rx}`} cx={rx} cy={743} r="2.5" fill="rgba(138,136,127,0.2)" />
      ))}
      <rect x={293} y={43} width={12} height={116} fill={wallFill} />
      <rect x={293} y={200} width={12} height={92} fill={wallFill} />
      <rect x={569} y={43} width={12} height={116} fill={wallFill} />
      <rect x={569} y={200} width={12} height={92} fill={wallFill} />
      <rect x={293} y={306} width={12} height={124} fill={wallFill} />
      <rect x={293} y={470} width={12} height={102} fill={wallFill} />
      <rect x={569} y={306} width={12} height={124} fill={wallFill} />
      <rect x={569} y={470} width={12} height={102} fill={wallFill} />
      <PipeSegment x={60} y={294} length={100} />
      <PipeSegment x={420} y={295} length={80} />
      <PipeSegment x={720} y={294} length={110} />
      <PipeSegment x={380} y={574} length={90} />
      <PipeSegment x={28} y={100} length={640} vertical />
      <PipeSegment x={W - 34} y={100} length={640} vertical />
      {Array.from({ length: 14 }, (_, i) => (
        <g key={`earth-${i}`}>
          <path
            d={`M20 ${50 + i * 50}l-10 18`}
            stroke="rgba(115,95,65,0.2)"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d={`M${W - 20} ${50 + i * 50}l10 18`}
            stroke="rgba(115,95,65,0.2)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </g>
      ))}
    </>
  );
}
