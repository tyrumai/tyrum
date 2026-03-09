import type { ActivityRoom } from "@tyrum/operator-core";

const fc = "var(--tyrum-color-border)";
const fw = "rgba(175,140,100,0.50)";
const fwDark = "rgba(150,118,82,0.45)";
const fwLight = "rgba(200,170,130,0.40)";
const metal = "rgba(175,165,148,0.38)";
const paper = "rgba(235,228,218,0.22)";
const plantGreen = "rgba(95,148,82,0.42)";

function terminalLabFurniture(x: number, y: number, w: number, h: number) {
  const b = y + h;
  const r = x + w;
  return (
    <>
      {/* Desk station 1 (warm wood) */}
      <rect x={x + 14} y={b - 58} width={70} height={5} rx={3} fill={fw} />
      <rect x={x + 20} y={b - 53} width={4} height={40} rx={2} fill={fwDark} />
      <rect x={x + 76} y={b - 53} width={4} height={40} rx={2} fill={fwDark} />
      {/* Monitor 1 */}
      <rect
        x={x + 22}
        y={b - 86}
        width={40}
        height={26}
        rx={3}
        fill="rgba(45,48,52,0.75)"
        stroke={fc}
        strokeWidth="0.8"
      />
      <rect x={x + 25} y={b - 83} width={34} height={20} rx={1.5} fill="rgba(85,148,108,0.28)" />
      <rect x={x + 38} y={b - 60} width={8} height={3} rx={1} fill={metal} />
      {/* Keyboard 1 */}
      <rect x={x + 28} y={b - 64} width={28} height={4} rx={2} fill="rgba(65,65,62,0.38)" />
      {/* Chair 1 */}
      <ellipse cx={x + 48} cy={b - 10} rx={14} ry={3.5} fill="rgba(150,128,108,0.20)" />
      <rect x={x + 42} y={b - 26} width={12} height={14} rx={4} fill="rgba(155,132,112,0.18)" />

      {/* Desk station 2 */}
      <rect x={x + 100} y={b - 56} width={60} height={5} rx={3} fill={fw} />
      <rect x={x + 106} y={b - 51} width={4} height={38} rx={2} fill={fwDark} />
      <rect x={x + 152} y={b - 51} width={4} height={38} rx={2} fill={fwDark} />
      {/* Monitor 2 */}
      <rect
        x={x + 108}
        y={b - 82}
        width={36}
        height={24}
        rx={3}
        fill="rgba(45,48,52,0.75)"
        stroke={fc}
        strokeWidth="0.8"
      />
      <rect x={x + 111} y={b - 79} width={30} height={18} rx={1.5} fill="rgba(85,148,108,0.24)" />
      <rect x={x + 122} y={b - 58} width={8} height={3} rx={1} fill={metal} />
      {/* Keyboard 2 */}
      <rect x={x + 114} y={b - 62} width={24} height={4} rx={2} fill="rgba(65,65,62,0.38)" />
      {/* Chair 2 */}
      <ellipse cx={x + 130} cy={b - 10} rx={14} ry={3.5} fill="rgba(150,128,108,0.20)" />
      <rect x={x + 124} y={b - 26} width={12} height={14} rx={4} fill="rgba(155,132,112,0.18)" />

      {/* Small desk plant */}
      <rect x={x + 68} y={b - 70} width={7} height={8} rx={3} fill="rgba(175,128,82,0.35)" />
      <ellipse cx={x + 71} cy={b - 74} rx={6} ry={4} fill={plantGreen} />
      <ellipse cx={x + 69} cy={b - 78} rx={4} ry={3} fill="rgba(100,158,88,0.36)" />

      {/* Server rack (warm-toned frame) */}
      <rect
        x={r - 50}
        y={b - 118}
        width={28}
        height={104}
        rx={3}
        fill="rgba(55,55,52,0.60)"
        stroke={fc}
        strokeWidth="0.8"
      />
      <path
        d={`M${r - 48} ${b - 96}h24M${r - 48} ${b - 72}h24M${r - 48} ${b - 48}h24M${r - 48} ${b - 28}h24`}
        stroke="rgba(100,95,88,0.30)"
        strokeWidth="0.6"
      />
      {/* Status LEDs */}
      <circle
        data-activity-motion="led"
        cx={r - 28}
        cy={b - 108}
        r="2"
        fill="rgba(85,190,105,0.65)"
      />
      <circle cx={r - 34} cy={b - 108} r="2" fill="rgba(210,170,65,0.48)" />
      <circle
        data-activity-motion="led"
        cx={r - 28}
        cy={b - 84}
        r="2"
        fill="rgba(85,190,105,0.65)"
      />
      <circle cx={r - 34} cy={b - 84} r="2" fill="rgba(210,90,85,0.45)" />
      <circle
        data-activity-motion="led"
        cx={r - 28}
        cy={b - 60}
        r="2"
        fill="rgba(85,190,105,0.65)"
      />
      {/* Cable from rack */}
      <path
        d={`M${r - 50} ${b - 88}q-12 4-12 28`}
        fill="none"
        stroke="rgba(75,72,68,0.25)"
        strokeWidth="2"
      />

      {/* Poster on wall */}
      <rect
        x={x + 14}
        y={y + 24}
        width={38}
        height={28}
        rx={2}
        fill="rgba(105,150,175,0.10)"
        stroke={fw}
        strokeWidth="0.8"
      />
      <rect x={x + 18} y={y + 28} width={30} height={20} rx={1} fill="rgba(115,160,185,0.08)" />
      {/* Wall screen */}
      <rect
        data-activity-motion="screen"
        x={x + 68}
        y={y + 26}
        width={50}
        height={32}
        rx={3}
        fill="rgba(45,48,52,0.55)"
        stroke={fc}
        strokeWidth="0.6"
      />
      <rect x={x + 71} y={y + 29} width={44} height={26} rx={1.5} fill="rgba(85,148,108,0.18)" />
    </>
  );
}

function mailRoomFurniture(x: number, y: number, w: number, h: number) {
  const b = y + h;
  const r = x + w;
  return (
    <>
      {/* Wooden sorting shelf */}
      <rect
        x={x + 12}
        y={y + 20}
        width={100}
        height={h - 32}
        rx={3}
        fill={fwLight}
        stroke={fc}
        strokeWidth="0.6"
      />
      {[0, 1, 2, 3].map((row) =>
        [0, 1, 2, 3, 4].map((col) => (
          <rect
            key={`cubby-${row}-${col}`}
            x={x + 16 + col * 19}
            y={y + 24 + row * ((h - 40) / 4)}
            width={16}
            height={(h - 48) / 4}
            rx={1.5}
            fill="rgba(215,205,190,0.08)"
            stroke={fwDark}
            strokeWidth="0.3"
          />
        )),
      )}
      {/* Letters in cubbies */}
      <rect x={x + 18} y={y + 28} width={10} height={5} rx={0.5} fill={paper} />
      <rect
        x={x + 56}
        y={y + 28 + (h - 40) / 4}
        width={10}
        height={5}
        rx={0.5}
        fill="rgba(230,222,210,0.20)"
      />
      <rect x={x + 94} y={y + 28} width={10} height={5} rx={0.5} fill="rgba(215,200,165,0.20)" />
      <rect
        x={x + 36}
        y={y + 28 + ((h - 40) / 4) * 2}
        width={10}
        height={5}
        rx={0.5}
        fill={paper}
      />
      <rect
        x={x + 74}
        y={y + 28 + ((h - 40) / 4) * 3}
        width={10}
        height={5}
        rx={0.5}
        fill="rgba(230,222,210,0.18)"
      />

      {/* Counter */}
      <rect x={r - 100} y={b - 50} width={70} height={5} rx={3} fill={fw} />
      <rect x={r - 94} y={b - 45} width={4} height={32} rx={2} fill={fwDark} />
      <rect x={r - 38} y={b - 45} width={4} height={32} rx={2} fill={fwDark} />
      {/* Scale */}
      <rect
        x={r - 80}
        y={b - 60}
        width={18}
        height={10}
        rx={2.5}
        fill="rgba(195,175,130,0.28)"
        stroke={fc}
        strokeWidth="0.5"
      />
      <rect x={r - 76} y={b - 62} width={10} height={3} rx={1.5} fill="rgba(195,175,130,0.22)" />
      {/* In/out trays on counter */}
      <path
        d={`M${r - 56} ${b - 58}h24l2-6h-28l2 6z`}
        fill="rgba(195,185,170,0.18)"
        stroke={fc}
        strokeWidth="0.4"
      />
      <path
        d={`M${r - 56} ${b - 68}h24l2-6h-28l2 6z`}
        fill="rgba(195,185,170,0.14)"
        stroke={fc}
        strokeWidth="0.4"
      />

      {/* Packages on floor */}
      <rect
        x={r - 38}
        y={b - 28}
        width={20}
        height={16}
        rx={2.5}
        fill="rgba(185,158,120,0.28)"
        stroke={fc}
        strokeWidth="0.5"
      />
      <rect
        x={r - 34}
        y={b - 42}
        width={16}
        height={14}
        rx={2.5}
        fill="rgba(185,158,120,0.22)"
        stroke={fc}
        strokeWidth="0.5"
      />
      <rect
        x={r - 30}
        y={b - 52}
        width={12}
        height={10}
        rx={2.5}
        fill="rgba(185,158,120,0.18)"
        stroke={fc}
        strokeWidth="0.5"
      />

      {/* Mail cart */}
      <rect x={x + 120} y={b - 36} width={24} height={3} rx={2} fill={metal} />
      <rect x={x + 142} y={b - 58} width={2} height={24} rx={0.5} fill={metal} />
      <circle cx={x + 124} cy={b - 12} r="4" fill="none" stroke={metal} strokeWidth="1" />
      <circle cx={x + 140} cy={b - 12} r="4" fill="none" stroke={metal} strokeWidth="1" />
      <rect
        x={x + 122}
        y={b - 32}
        width={18}
        height={12}
        rx={2}
        fill="rgba(185,158,120,0.18)"
        stroke={fc}
        strokeWidth="0.3"
      />

      {/* Bulletin board */}
      <rect
        x={r - 88}
        y={y + 22}
        width={46}
        height={34}
        rx={3}
        fill="rgba(195,165,125,0.12)"
        stroke={fw}
        strokeWidth="0.8"
      />
      <circle cx={r - 76} cy={y + 32} r="2" fill="rgba(215,100,90,0.42)" />
      <circle cx={r - 62} cy={y + 36} r="2" fill="rgba(90,150,210,0.42)" />
      <circle cx={r - 50} cy={y + 30} r="2" fill="rgba(225,190,70,0.42)" />
      <rect x={r - 80} y={y + 40} width={12} height={8} rx={1} fill={paper} />
      <rect x={r - 64} y={y + 42} width={12} height={6} rx={1} fill="rgba(215,235,220,0.15)" />

      {/* Umbrella stand */}
      <rect
        x={x + 160}
        y={b - 34}
        width={14}
        height={22}
        rx={4}
        fill="rgba(145,130,115,0.20)"
        stroke={fc}
        strokeWidth="0.4"
      />
      <line
        x1={x + 164}
        y1={b - 34}
        x2={x + 162}
        y2={b - 48}
        stroke="rgba(95,90,140,0.30)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <line
        x1={x + 170}
        y1={b - 34}
        x2={x + 172}
        y2={b - 46}
        stroke="rgba(145,100,80,0.30)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </>
  );
}

function archiveFurniture(x: number, y: number, _w: number, h: number) {
  const b = y + h;
  const r = x + _w;
  return (
    <>
      {/* Wooden filing cabinets */}
      {[0, 1, 2, 3].map((cab) => (
        <g key={`cabinet-${cab}`}>
          <rect
            x={x + 12 + cab * 34}
            y={y + 8}
            width={28}
            height={h - 20}
            rx={3}
            fill={fwLight}
            stroke={fc}
            strokeWidth="0.5"
          />
          {[0, 1, 2].map((drawer) => (
            <g key={`drawer-${cab}-${drawer}`}>
              <path
                d={`M${x + 14 + cab * 34} ${y + 14 + drawer * ((h - 26) / 3)}h24`}
                stroke={fwDark}
                strokeWidth="0.5"
              />
              {/* Brass handle */}
              <circle
                cx={x + 26 + cab * 34}
                cy={y + 10 + drawer * ((h - 26) / 3) + (h - 26) / 6}
                r="1.8"
                fill="rgba(195,175,130,0.42)"
              />
            </g>
          ))}
          <rect x={x + 18 + cab * 34} y={y + 12} width={12} height={4} rx={1} fill={paper} />
        </g>
      ))}

      {/* Cardboard boxes */}
      <rect
        x={r - 52}
        y={b - 30}
        width={20}
        height={16}
        rx={2.5}
        fill="rgba(185,158,120,0.28)"
        stroke={fc}
        strokeWidth="0.5"
      />
      <rect
        x={r - 48}
        y={b - 44}
        width={16}
        height={14}
        rx={2.5}
        fill="rgba(185,158,120,0.22)"
        stroke={fc}
        strokeWidth="0.5"
      />
      <rect
        x={r - 44}
        y={b - 54}
        width={12}
        height={10}
        rx={2.5}
        fill="rgba(185,158,120,0.16)"
        stroke={fc}
        strokeWidth="0.5"
      />

      {/* Old picture frame leaning against wall */}
      <rect
        x={x + 152}
        y={b - 42}
        width={18}
        height={24}
        rx={1.5}
        fill="rgba(175,155,130,0.10)"
        stroke={fw}
        strokeWidth="0.8"
        transform={`rotate(8 ${x + 161} ${b - 30})`}
      />

      {/* Small stool */}
      <rect x={x + 180} y={b - 20} width={22} height={3} rx={2} fill={fw} />
      <rect x={x + 184} y={b - 17} width={3} height={12} rx={1} fill={fwDark} />
      <rect x={x + 195} y={b - 17} width={3} height={12} rx={1} fill={fwDark} />

      {/* Cobweb detail */}
      <path
        d={`M${x + 10} ${y + 6}q8 4 4 12`}
        stroke="rgba(190,185,175,0.14)"
        strokeWidth="0.5"
        fill="none"
      />
      <path
        d={`M${x + 10} ${y + 6}q12 2 10 10`}
        stroke="rgba(190,185,175,0.10)"
        strokeWidth="0.4"
        fill="none"
      />
      <path
        d={`M${r - 14} ${y + 6}q-6 6-2 14`}
        stroke="rgba(190,185,175,0.14)"
        strokeWidth="0.5"
        fill="none"
      />

      {/* Bare lightbulb on cord (charming detail) */}
      <line
        x1={x + _w / 2}
        y1={y}
        x2={x + _w / 2}
        y2={y + 14}
        stroke="rgba(165,150,130,0.35)"
        strokeWidth="0.8"
      />
      <circle cx={x + _w / 2} cy={y + 16} r={3} fill="rgba(255,238,175,0.35)" />
      <ellipse cx={x + _w / 2} cy={y + 20} rx={12} ry={6} fill="rgba(245,220,160,0.08)" />
    </>
  );
}

export function LowerRoomFurniture({
  roomId,
  x,
  y,
  w,
  h,
}: {
  roomId: ActivityRoom;
  x: number;
  y: number;
  w: number;
  h: number;
}) {
  switch (roomId) {
    case "terminal-lab":
      return <g opacity="0.88">{terminalLabFurniture(x, y, w, h)}</g>;
    case "mail-room":
      return <g opacity="0.88">{mailRoomFurniture(x, y, w, h)}</g>;
    case "archive":
      return <g opacity="0.88">{archiveFurniture(x, y, w, h)}</g>;
    default:
      return null;
  }
}
