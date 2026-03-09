import type { ActivityRoom } from "@tyrum/operator-core";

const fc = "var(--tyrum-color-border)";
const fl = "rgba(138,136,127,0.4)";

function terminalLabFurniture(x: number, y: number, w: number, h: number) {
  const b = y + h;
  const r = x + w;
  return (
    <>
      {/* Desk station 1 */}
      <rect x={x + 14} y={b - 60} width={70} height={4} rx={2} fill="rgba(160,130,90,0.4)" />
      <rect x={x + 20} y={b - 56} width={4} height={42} rx={1.5} fill={fl} />
      <rect x={x + 76} y={b - 56} width={4} height={42} rx={1.5} fill={fl} />
      {/* Monitor 1 */}
      <rect
        x={x + 22}
        y={b - 88}
        width={40}
        height={26}
        rx={2}
        fill="rgba(32,35,33,0.8)"
        stroke={fc}
        strokeWidth="0.8"
      />
      <rect x={x + 25} y={b - 85} width={34} height={20} rx={1} fill="rgba(77,138,97,0.3)" />
      <rect x={x + 38} y={b - 62} width={8} height={3} rx={1} fill={fl} />
      {/* Keyboard 1 */}
      <rect x={x + 28} y={b - 66} width={28} height={4} rx={1.5} fill="rgba(50,50,50,0.4)" />
      {/* CPU tower under desk 1 */}
      <rect
        x={x + 60}
        y={b - 54}
        width={14}
        height={38}
        rx={2}
        fill="rgba(40,42,40,0.5)"
        stroke={fc}
        strokeWidth="0.5"
      />
      {/* Chair 1 */}
      <ellipse cx={x + 48} cy={b - 10} rx={14} ry={3} fill="rgba(100,96,88,0.2)" />
      <rect x={x + 44} y={b - 26} width={8} height={14} rx={2} fill="rgba(100,96,88,0.15)" />

      {/* Desk station 2 */}
      <rect x={x + 100} y={b - 58} width={60} height={4} rx={2} fill="rgba(160,130,90,0.4)" />
      <rect x={x + 106} y={b - 54} width={4} height={40} rx={1.5} fill={fl} />
      <rect x={x + 152} y={b - 54} width={4} height={40} rx={1.5} fill={fl} />
      {/* Monitor 2 */}
      <rect
        x={x + 108}
        y={b - 84}
        width={36}
        height={24}
        rx={2}
        fill="rgba(32,35,33,0.8)"
        stroke={fc}
        strokeWidth="0.8"
      />
      <rect x={x + 111} y={b - 81} width={30} height={18} rx={1} fill="rgba(77,138,97,0.25)" />
      <rect x={x + 122} y={b - 60} width={8} height={3} rx={1} fill={fl} />
      {/* Keyboard 2 */}
      <rect x={x + 114} y={b - 64} width={24} height={4} rx={1.5} fill="rgba(50,50,50,0.4)" />
      {/* Chair 2 */}
      <ellipse cx={x + 130} cy={b - 10} rx={14} ry={3} fill="rgba(100,96,88,0.2)" />
      <rect x={x + 126} y={b - 26} width={8} height={14} rx={2} fill="rgba(100,96,88,0.15)" />

      {/* Server rack */}
      <rect
        x={r - 52}
        y={b - 120}
        width={30}
        height={106}
        rx={2}
        fill="rgba(32,35,33,0.7)"
        stroke={fc}
        strokeWidth="0.8"
      />
      <path
        d={`M${r - 50} ${b - 100}h26M${r - 50} ${b - 76}h26M${r - 50} ${b - 52}h26M${r - 50} ${b - 28}h26`}
        stroke={fl}
        strokeWidth="0.6"
      />
      {/* Status LEDs */}
      <circle
        data-activity-motion="led"
        cx={r - 28}
        cy={b - 110}
        r="2"
        fill="rgba(77,180,97,0.7)"
      />
      <circle cx={r - 34} cy={b - 110} r="2" fill="rgba(200,160,60,0.5)" />
      <circle data-activity-motion="led" cx={r - 28} cy={b - 86} r="2" fill="rgba(77,180,97,0.7)" />
      <circle cx={r - 34} cy={b - 86} r="2" fill="rgba(200,80,80,0.5)" />
      <circle data-activity-motion="led" cx={r - 28} cy={b - 62} r="2" fill="rgba(77,180,97,0.7)" />
      {/* Cable bundle from rack */}
      <path
        d={`M${r - 52} ${b - 90}q-14 4-14 30`}
        fill="none"
        stroke="rgba(60,60,55,0.3)"
        strokeWidth="2"
      />
      <path
        d={`M${r - 52} ${b - 70}q-10 6-12 24`}
        fill="none"
        stroke="rgba(60,60,55,0.25)"
        strokeWidth="1.5"
      />

      {/* Wall-mounted patch panel */}
      <rect
        x={x + 14}
        y={y + 24}
        width={44}
        height={30}
        rx={2}
        fill="rgba(32,35,33,0.6)"
        stroke={fc}
        strokeWidth="0.6"
      />
      {[0, 1, 2].map((row) =>
        [0, 1, 2, 3, 4, 5].map((col) => (
          <circle
            key={`port-${row}-${col}`}
            cx={x + 20 + col * 6}
            cy={y + 30 + row * 8}
            r="1.5"
            fill="rgba(77,138,97,0.3)"
          />
        )),
      )}
      {/* Floor cable run */}
      <path
        d={`M${x + 36} ${b - 8}q40 6 80 -2t60 4`}
        fill="none"
        stroke="rgba(60,60,55,0.2)"
        strokeWidth="2"
      />
      {/* Wall screen */}
      <rect
        data-activity-motion="screen"
        x={x + 80}
        y={y + 26}
        width={50}
        height={32}
        rx={2}
        fill="rgba(32,35,33,0.6)"
        stroke={fc}
        strokeWidth="0.6"
      />
      <rect x={x + 83} y={y + 29} width={44} height={26} rx={1} fill="rgba(77,138,97,0.2)" />
    </>
  );
}

function mailRoomFurniture(x: number, y: number, w: number, h: number) {
  const b = y + h;
  const r = x + w;
  return (
    <>
      {/* Large sorting shelf */}
      <rect
        x={x + 12}
        y={y + 22}
        width={100}
        height={h - 34}
        rx={2}
        fill="rgba(32,35,33,0.4)"
        stroke={fc}
        strokeWidth="0.6"
      />
      {[0, 1, 2, 3].map((row) =>
        [0, 1, 2, 3, 4].map((col) => (
          <rect
            key={`cubby-${row}-${col}`}
            x={x + 16 + col * 19}
            y={y + 26 + row * ((h - 42) / 4)}
            width={16}
            height={(h - 50) / 4}
            rx={1}
            fill="rgba(200,190,170,0.06)"
            stroke={fl}
            strokeWidth="0.3"
          />
        )),
      )}
      {/* Envelopes in cubbies */}
      <rect x={x + 18} y={y + 30} width={10} height={5} rx={0.5} fill="rgba(220,215,200,0.2)" />
      <rect
        x={x + 56}
        y={y + 30 + (h - 42) / 4}
        width={10}
        height={5}
        rx={0.5}
        fill="rgba(220,215,200,0.18)"
      />
      <rect x={x + 94} y={y + 30} width={10} height={5} rx={0.5} fill="rgba(200,180,140,0.2)" />
      <rect
        x={x + 36}
        y={y + 30 + ((h - 42) / 4) * 2}
        width={10}
        height={5}
        rx={0.5}
        fill="rgba(220,215,200,0.15)"
      />
      <rect
        x={x + 74}
        y={y + 30 + ((h - 42) / 4) * 3}
        width={10}
        height={5}
        rx={0.5}
        fill="rgba(220,215,200,0.18)"
      />
      {/* Counter with scale */}
      <rect x={r - 100} y={b - 52} width={70} height={4} rx={2} fill="rgba(160,130,90,0.4)" />
      <rect x={r - 94} y={b - 48} width={4} height={34} rx={1.5} fill={fl} />
      <rect x={r - 38} y={b - 48} width={4} height={34} rx={1.5} fill={fl} />
      {/* Scale on counter */}
      <rect
        x={r - 80}
        y={b - 62}
        width={18}
        height={10}
        rx={2}
        fill="rgba(138,136,127,0.25)"
        stroke={fc}
        strokeWidth="0.5"
      />
      <rect x={r - 76} y={b - 64} width={10} height={3} rx={1} fill="rgba(138,136,127,0.2)" />
      {/* Inbox/outbox trays on counter */}
      <path
        d={`M${r - 56} ${b - 60}h24l2-6h-28l2 6z`}
        fill="rgba(180,180,180,0.15)"
        stroke={fc}
        strokeWidth="0.4"
      />
      <path
        d={`M${r - 56} ${b - 70}h24l2-6h-28l2 6z`}
        fill="rgba(180,180,180,0.12)"
        stroke={fc}
        strokeWidth="0.4"
      />
      {/* Packages on floor */}
      <rect
        x={r - 40}
        y={b - 30}
        width={20}
        height={16}
        rx={2}
        fill="rgba(175,150,115,0.25)"
        stroke={fc}
        strokeWidth="0.5"
      />
      <rect
        x={r - 36}
        y={b - 44}
        width={16}
        height={14}
        rx={2}
        fill="rgba(175,150,115,0.2)"
        stroke={fc}
        strokeWidth="0.5"
      />
      <rect
        x={r - 32}
        y={b - 54}
        width={12}
        height={10}
        rx={2}
        fill="rgba(175,150,115,0.15)"
        stroke={fc}
        strokeWidth="0.5"
      />
      {/* Mail cart */}
      <rect x={x + 120} y={b - 38} width={24} height={3} rx={1.5} fill={fl} />
      <rect x={x + 142} y={b - 60} width={2} height={24} rx={0.5} fill={fl} />
      <circle cx={x + 124} cy={b - 12} r="4" fill="none" stroke={fl} strokeWidth="1" />
      <circle cx={x + 140} cy={b - 12} r="4" fill="none" stroke={fl} strokeWidth="1" />
      <rect
        x={x + 122}
        y={b - 34}
        width={18}
        height={12}
        rx={1}
        fill="rgba(175,150,115,0.15)"
        stroke={fc}
        strokeWidth="0.3"
      />
      {/* Bulletin board on wall */}
      <rect
        x={r - 90}
        y={y + 24}
        width={46}
        height={34}
        rx={2}
        fill="rgba(160,130,90,0.1)"
        stroke={fc}
        strokeWidth="0.6"
      />
      <circle cx={r - 78} cy={y + 34} r="2" fill="rgba(200,90,80,0.4)" />
      <circle cx={r - 64} cy={y + 38} r="2" fill="rgba(80,140,200,0.4)" />
      <circle cx={r - 52} cy={y + 32} r="2" fill="rgba(200,180,60,0.4)" />
      <rect x={r - 82} y={y + 42} width={12} height={8} rx={1} fill="rgba(220,215,200,0.12)" />
      <rect x={r - 66} y={y + 44} width={12} height={6} rx={1} fill="rgba(220,215,200,0.1)" />
    </>
  );
}

function archiveFurniture(x: number, y: number, _w: number, h: number) {
  const b = y + h;
  const r = x + _w;
  return (
    <>
      {/* Row of filing cabinets */}
      {[0, 1, 2, 3].map((cab) => (
        <g key={`cabinet-${cab}`}>
          <rect
            x={x + 12 + cab * 34}
            y={y + 8}
            width={28}
            height={h - 20}
            rx={2}
            fill="rgba(32,35,33,0.4)"
            stroke={fc}
            strokeWidth="0.6"
          />
          {[0, 1, 2].map((drawer) => (
            <g key={`drawer-${cab}-${drawer}`}>
              <path
                d={`M${x + 14 + cab * 34} ${y + 14 + drawer * ((h - 26) / 3)}h24`}
                stroke={fl}
                strokeWidth="0.5"
              />
              <circle
                cx={x + 26 + cab * 34}
                cy={y + 10 + drawer * ((h - 26) / 3) + (h - 26) / 6}
                r="1.5"
                fill={fl}
              />
            </g>
          ))}
          {/* Labels on cabinets */}
          <rect
            x={x + 18 + cab * 34}
            y={y + 12}
            width={12}
            height={4}
            rx={0.5}
            fill="rgba(220,215,200,0.12)"
          />
        </g>
      ))}
      {/* Cardboard boxes stacked */}
      <rect
        x={r - 54}
        y={b - 32}
        width={20}
        height={18}
        rx={2}
        fill="rgba(175,150,115,0.25)"
        stroke={fc}
        strokeWidth="0.5"
      />
      <rect
        x={r - 50}
        y={b - 46}
        width={16}
        height={14}
        rx={2}
        fill="rgba(175,150,115,0.2)"
        stroke={fc}
        strokeWidth="0.5"
      />
      <rect
        x={r - 46}
        y={b - 56}
        width={12}
        height={10}
        rx={2}
        fill="rgba(175,150,115,0.15)"
        stroke={fc}
        strokeWidth="0.5"
      />
      {/* Hand dolly */}
      <rect x={x + 150} y={b - 20} width={14} height={3} rx={1} fill={fl} />
      <rect x={x + 162} y={b - 46} width={2} height={28} rx={0.5} fill={fl} />
      <circle cx={x + 153} cy={b - 10} r="3.5" fill="none" stroke={fl} strokeWidth="1" />
      <circle cx={x + 161} cy={b - 10} r="3.5" fill="none" stroke={fl} strokeWidth="1" />
      {/* Old monitor on small desk */}
      <rect x={r - 30} y={b - 42} width={16} height={3} rx={1} fill="rgba(160,130,90,0.35)" />
      <rect
        x={r - 28}
        y={b - 58}
        width={12}
        height={14}
        rx={1}
        fill="rgba(32,35,33,0.5)"
        stroke={fc}
        strokeWidth="0.5"
      />
      <rect x={r - 27} y={b - 56} width={10} height={10} rx={0.5} fill="rgba(77,138,97,0.15)" />
      {/* Dust/cobweb detail */}
      <path
        d={`M${x + 10} ${y + 6}q8 4 4 12`}
        stroke="rgba(180,175,165,0.12)"
        strokeWidth="0.5"
        fill="none"
      />
      <path
        d={`M${r - 14} ${y + 6}q-6 6-2 14`}
        stroke="rgba(180,175,165,0.12)"
        strokeWidth="0.5"
        fill="none"
      />
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
      return <g opacity="0.85">{terminalLabFurniture(x, y, w, h)}</g>;
    case "mail-room":
      return <g opacity="0.85">{mailRoomFurniture(x, y, w, h)}</g>;
    case "archive":
      return <g opacity="0.85">{archiveFurniture(x, y, w, h)}</g>;
    default:
      return null;
  }
}
