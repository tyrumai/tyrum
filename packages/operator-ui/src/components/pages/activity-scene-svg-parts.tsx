const LIGHT_GLOW = "rgba(245, 215, 150, 0.25)";
const LIGHT_SHADE = "rgba(220, 190, 145, 0.48)";
const LIGHT_CORD = "rgba(165, 150, 130, 0.38)";

export function CeilingLight({ cx, y }: { cx: number; y: number }) {
  return (
    <g>
      {/* Cord */}
      <rect x={cx - 0.5} y={y} width={1} height={14} fill={LIGHT_CORD} />
      {/* Lampshade */}
      <path
        d={`M${cx - 9} ${y + 18}l2-6h14l2 6z`}
        fill={LIGHT_SHADE}
        stroke="rgba(195, 170, 135, 0.30)"
        strokeWidth="0.8"
      />
      {/* Warm bulb */}
      <circle cx={cx} cy={y + 16} r={2} fill="rgba(255, 238, 175, 0.55)" />
      {/* Light cone */}
      <ellipse cx={cx} cy={y + 22} rx={16} ry={8} fill={LIGHT_GLOW} />
    </g>
  );
}

export function LightPool({ cx, cy, rx }: { cx: number; cy: number; rx?: number }) {
  return <ellipse cx={cx} cy={cy} rx={rx ?? 30} ry={8} fill="rgba(245, 220, 160, 0.09)" />;
}

export function SceneStructure({ W, H }: { W: number; H: number }) {
  const wallColor = "rgba(205, 185, 160, 0.55)";
  const woodFloor = "rgba(180, 145, 105, 0.50)";
  const roofColor = "rgba(165, 115, 80, 0.65)";
  const roofDark = "rgba(140, 95, 65, 0.45)";
  const trimColor = "rgba(225, 215, 200, 0.45)";
  const windowSky = "rgba(160, 200, 230, 0.30)";
  const windowFrame = "rgba(185, 160, 130, 0.50)";
  const roofPeakY = 8;
  const roofBaseY = 42;
  const midX = W / 2;

  return (
    <>
      {/* Sky behind roof */}
      <rect x={0} y={0} width={W} height={roofBaseY + 4} fill="rgba(165, 200, 225, 0.10)" />

      {/* === ROOF (gable with shingles) === */}
      <polygon
        points={`14,${roofBaseY} ${midX},${roofPeakY} ${W - 14},${roofBaseY}`}
        fill={roofColor}
        stroke={roofDark}
        strokeWidth="1.5"
      />
      <defs>
        <clipPath id="roof-clip">
          <polygon points={`16,${roofBaseY} ${midX},${roofPeakY + 2} ${W - 16},${roofBaseY}`} />
        </clipPath>
      </defs>
      <g clipPath="url(#roof-clip)">
        {[18, 26, 34].map((sy) => (
          <line
            key={`shingle-${sy}`}
            x1={0}
            y1={sy}
            x2={W}
            y2={sy}
            stroke={roofDark}
            strokeWidth="0.7"
          />
        ))}
      </g>

      {/* Chimney */}
      <rect
        x={W - 160}
        y={roofPeakY + 2}
        width={24}
        height={36}
        rx={2}
        fill="rgba(180, 140, 110, 0.60)"
        stroke={roofDark}
        strokeWidth="1"
      />
      <rect
        x={W - 163}
        y={roofPeakY}
        width={30}
        height={5}
        rx={2}
        fill="rgba(175, 135, 105, 0.55)"
      />
      {[0, 1, 2].map((row) => (
        <line
          key={`brick-${row}`}
          x1={W - 158}
          y1={roofPeakY + 14 + row * 10}
          x2={W - 138}
          y2={roofPeakY + 14 + row * 10}
          stroke={roofDark}
          strokeWidth="0.5"
        />
      ))}
      {/* Smoke wisps */}
      <path
        d={`M${W - 148} ${roofPeakY - 1}q-4-8 2-14`}
        fill="none"
        stroke="rgba(185,185,185,0.18)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d={`M${W - 144} ${roofPeakY - 3}q5-10-1-16`}
        fill="none"
        stroke="rgba(185,185,185,0.12)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      {/* === GARDEN PINWHEEL (rotating element) === */}
      <g transform={`translate(620 ${H - 155})`}>
        <line x1={0} y1={4} x2={0} y2={26} stroke="rgba(145,130,115,0.40)" strokeWidth="1.5" />
        <g data-activity-motion="fan">
          <path d="M0-5L-4 0H0Z" fill="rgba(225,135,135,0.45)" />
          <path d="M5 0L0-4V0Z" fill="rgba(135,185,225,0.45)" />
          <path d="M0 5L4 0H0Z" fill="rgba(225,195,105,0.45)" />
          <path d="M-5 0L0 4V0Z" fill="rgba(155,205,140,0.45)" />
        </g>
        <circle cx={0} cy={0} r={1.5} fill="rgba(145,130,115,0.50)" />
      </g>

      {/* === BUILDING WALLS (warm, thinner) === */}
      <rect
        x={20}
        y={roofBaseY}
        width={W - 40}
        height={H - roofBaseY - 168}
        rx={2}
        fill="none"
        stroke={wallColor}
        strokeWidth={10}
      />
      {/* Top trim / cornice */}
      <rect x={15} y={roofBaseY - 2} width={W - 30} height={5} rx={2} fill={trimColor} />

      {/* === FLOORS (warm wood planks) === */}
      <rect x={25} y={292} width={W - 50} height={12} rx={1.5} fill={woodFloor} />
      {[120, 280, 440, 600, 760].map((gx) => (
        <line
          key={`grain1-${gx}`}
          x1={gx}
          y1={294}
          x2={gx}
          y2={302}
          stroke="rgba(155,125,88,0.18)"
          strokeWidth="0.6"
        />
      ))}
      <rect x={25} y={572} width={W - 50} height={12} rx={1.5} fill={woodFloor} />
      {[120, 280, 440, 600, 760].map((gx) => (
        <line
          key={`grain2-${gx}`}
          x1={gx}
          y1={574}
          x2={gx}
          y2={582}
          stroke="rgba(155,125,88,0.18)"
          strokeWidth="0.6"
        />
      ))}

      {/* Foundation */}
      <rect x={20} y={732} width={W - 40} height={18} rx={2} fill={wallColor} />
      <line
        x1={25}
        y1={741}
        x2={W - 25}
        y2={741}
        stroke="rgba(180,160,135,0.20)"
        strokeWidth="0.5"
      />

      {/* === INTERIOR WALLS (warm cream dividers) === */}
      <rect x={295} y={roofBaseY + 5} width={8} height={244} fill={wallColor} />
      <rect x={571} y={roofBaseY + 5} width={8} height={244} fill={wallColor} />
      <rect x={295} y={306} width={8} height={264} fill={wallColor} />
      <rect x={571} y={306} width={8} height={264} fill={wallColor} />

      {/* === WINDOWS ON EXTERIOR WALLS === */}
      {[120, 390].map((wy) => (
        <g key={`lwin-${wy}`}>
          <rect
            x={22}
            y={wy}
            width={20}
            height={32}
            rx={1.5}
            fill={windowSky}
            stroke={windowFrame}
            strokeWidth="1.5"
          />
          <line x1={32} y1={wy} x2={32} y2={wy + 32} stroke={windowFrame} strokeWidth="0.8" />
          <line x1={22} y1={wy + 16} x2={42} y2={wy + 16} stroke={windowFrame} strokeWidth="0.8" />
          <path d={`M23 ${wy + 2}q2.5 8 0 14`} fill="rgba(215,185,160,0.22)" />
          <path d={`M41 ${wy + 2}q-2.5 8 0 14`} fill="rgba(215,185,160,0.22)" />
        </g>
      ))}
      {[120, 390].map((wy) => (
        <g key={`rwin-${wy}`}>
          <rect
            x={W - 42}
            y={wy}
            width={20}
            height={32}
            rx={1.5}
            fill={windowSky}
            stroke={windowFrame}
            strokeWidth="1.5"
          />
          <line
            x1={W - 32}
            y1={wy}
            x2={W - 32}
            y2={wy + 32}
            stroke={windowFrame}
            strokeWidth="0.8"
          />
          <line
            x1={W - 42}
            y1={wy + 16}
            x2={W - 22}
            y2={wy + 16}
            stroke={windowFrame}
            strokeWidth="0.8"
          />
          <path d={`M${W - 41} ${wy + 2}q2.5 8 0 14`} fill="rgba(215,185,160,0.22)" />
          <path d={`M${W - 23} ${wy + 2}q-2.5 8 0 14`} fill="rgba(215,185,160,0.22)" />
        </g>
      ))}

      {/* === GARDEN === */}
      <rect x={0} y={H - 168} width={W} height={168} fill="rgba(115,165,90,0.12)" />
      <rect x={0} y={H - 168} width={W} height={28} fill="rgba(100,155,82,0.10)" />
      <path d={`M0 ${H - 168}h${W}`} stroke="rgba(95,150,80,0.30)" strokeWidth="2" />

      {/* Grass tufts */}
      {[35, 140, 270, 410, 550, 690, 830, 910].map((gx) => (
        <path
          key={`grass-${gx}`}
          d={`M${gx} ${H - 168}c-1-7 2-12 3.5-9c1.5-6 3-10 5-4`}
          stroke="rgba(90,150,75,0.38)"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
      ))}

      {/* Flowers */}
      {[
        { x: 70, y: H - 150, c: "rgba(225,135,135,0.50)" },
        { x: 190, y: H - 147, c: "rgba(185,155,215,0.50)" },
        { x: 500, y: H - 152, c: "rgba(225,195,105,0.50)" },
        { x: 740, y: H - 148, c: "rgba(155,185,225,0.50)" },
        { x: 870, y: H - 150, c: "rgba(235,165,145,0.50)" },
      ].map((f) => (
        <g key={`flower-${f.x}`}>
          <line
            x1={f.x}
            y1={f.y + 7}
            x2={f.x}
            y2={f.y + 18}
            stroke="rgba(95,145,75,0.40)"
            strokeWidth="1.5"
          />
          <circle cx={f.x} cy={f.y} r={3.5} fill={f.c} />
          <circle cx={f.x} cy={f.y} r={1.5} fill="rgba(245,225,125,0.55)" />
        </g>
      ))}

      {/* Stone path */}
      {[0, 1, 2, 3].map((si) => (
        <ellipse
          key={`stone-${si}`}
          cx={W / 2 - 50 + si * 36}
          cy={H - 108 + (si % 2) * 8}
          rx={13}
          ry={6}
          fill="rgba(175,168,158,0.18)"
          stroke="rgba(160,153,143,0.12)"
          strokeWidth="0.8"
        />
      ))}

      {/* Bush */}
      <ellipse cx={155} cy={H - 112} rx={20} ry={14} fill="rgba(85,138,75,0.25)" />
      <ellipse cx={145} cy={H - 120} rx={14} ry={10} fill="rgba(95,148,82,0.28)" />
      <ellipse cx={165} cy={H - 116} rx={12} ry={9} fill="rgba(88,140,76,0.22)" />

      {/* Tree */}
      <rect x={808} y={H - 152} width={5} height={38} rx={2} fill="rgba(145,110,75,0.32)" />
      <ellipse cx={811} cy={H - 158} rx={22} ry={18} fill="rgba(80,135,72,0.28)" />
      <ellipse cx={804} cy={H - 166} rx={16} ry={13} fill="rgba(90,145,80,0.32)" />
      <ellipse cx={818} cy={H - 162} rx={14} ry={12} fill="rgba(85,140,75,0.25)" />

      {/* Picket fence */}
      {[330, 350, 370, 390, 410, 430, 450].map((fx) => (
        <g key={`fence-${fx}`}>
          <rect x={fx} y={H - 138} width={3.5} height={22} rx={0.5} fill="rgba(235,230,220,0.28)" />
          <polygon
            points={`${fx},${H - 138} ${fx + 1.75},${H - 144} ${fx + 3.5},${H - 138}`}
            fill="rgba(235,230,220,0.28)"
          />
        </g>
      ))}
      <rect x={328} y={H - 128} width={126} height={2.5} rx={1} fill="rgba(235,230,220,0.22)" />
      <rect x={328} y={H - 120} width={126} height={2.5} rx={1} fill="rgba(235,230,220,0.22)" />

      {/* Mailbox */}
      <rect x={575} y={H - 146} width={3.5} height={28} rx={1} fill="rgba(145,115,80,0.38)" />
      <rect
        x={567}
        y={H - 152}
        width={19}
        height={12}
        rx={3}
        fill="rgba(85,125,165,0.42)"
        stroke="rgba(75,110,145,0.32)"
        strokeWidth="1"
      />
      <rect x={586} y={H - 148} width={5} height={3} rx={1} fill="rgba(195,80,70,0.48)" />
    </>
  );
}
