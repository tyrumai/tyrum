import type { ActivityRoom } from "@tyrum/operator-core";
import { LowerRoomFurniture } from "./activity-scene-furniture-lower.js";

const fc = "var(--tyrum-color-border)";
const fl = "rgba(138,136,127,0.4)";

function loungeFurniture(x: number, y: number, _w: number, h: number) {
  const b = y + h;
  const r = x + _w;
  return (
    <>
      {/* Floor rug */}
      <ellipse cx={x + _w / 2} cy={b - 20} rx={_w * 0.32} ry={12} fill="rgba(150,120,90,0.10)" />
      {/* Large couch */}
      <rect
        x={x + 16}
        y={b - 50}
        width={100}
        height={30}
        rx={6}
        fill="rgba(123,107,82,0.30)"
        stroke={fc}
        strokeWidth="0.8"
      />
      <rect
        x={x + 16}
        y={b - 68}
        width={12}
        height={48}
        rx={5}
        fill="rgba(123,107,82,0.22)"
        stroke={fc}
        strokeWidth="0.8"
      />
      <rect
        x={x + 104}
        y={b - 68}
        width={12}
        height={48}
        rx={5}
        fill="rgba(123,107,82,0.22)"
        stroke={fc}
        strokeWidth="0.8"
      />
      <rect x={x + 34} y={b - 48} width={24} height={18} rx={4} fill="rgba(150,130,100,0.2)" />
      <rect x={x + 66} y={b - 48} width={24} height={18} rx={4} fill="rgba(140,118,88,0.2)" />
      {/* Coffee table */}
      <rect x={x + 126} y={b - 38} width={50} height={4} rx={2} fill="rgba(160,130,90,0.45)" />
      <rect x={x + 132} y={b - 34} width={4} height={22} rx={1.5} fill={fl} />
      <rect x={x + 168} y={b - 34} width={4} height={22} rx={1.5} fill={fl} />
      <rect x={x + 134} y={b - 44} width={8} height={6} rx={2} fill="rgba(200,190,170,0.3)" />
      <rect x={x + 148} y={b - 46} width={14} height={3} rx={1} fill="rgba(200,190,170,0.2)" />
      {/* Floor plant */}
      <rect x={r - 48} y={b - 30} width={12} height={18} rx={4} fill="rgba(170,120,75,0.4)" />
      <ellipse cx={r - 42} cy={b - 38} rx={14} ry={10} fill="rgba(77,120,72,0.4)" />
      <ellipse cx={r - 38} cy={b - 46} rx={9} ry={7} fill="rgba(90,140,85,0.35)" />
      <ellipse cx={r - 46} cy={b - 42} rx={7} ry={5} fill="rgba(70,115,65,0.3)" />
      {/* Wall art */}
      <rect
        x={x + 40}
        y={y + 24}
        width={40}
        height={30}
        rx={2}
        fill="rgba(160,130,100,0.08)"
        stroke={fc}
        strokeWidth="0.8"
      />
      <rect x={x + 44} y={y + 28} width={32} height={22} rx={1} fill="rgba(140,170,130,0.10)" />
      {/* Side table */}
      <rect x={r - 70} y={b - 30} width={18} height={3} rx={1.5} fill="rgba(160,130,90,0.4)" />
      <rect x={r - 64} y={b - 27} width={3} height={16} rx={1} fill={fl} />
      <rect x={r - 68} y={b - 36} width={7} height={6} rx={2} fill="rgba(200,190,170,0.25)" />
      {/* Standing lamp */}
      <rect x={r - 28} y={b - 110} width={3} height={96} rx={1} fill={fl} />
      <ellipse cx={r - 26} cy={b - 112} rx={12} ry={8} fill="rgba(200,160,90,0.18)" />
      <circle cx={r - 26} cy={b - 12} r={7} fill="rgba(138,136,127,0.2)" />
      {/* Small bookshelf on wall */}
      <rect
        x={r - 60}
        y={y + 26}
        width={34}
        height={50}
        rx={2}
        fill="rgba(32,35,33,0.35)"
        stroke={fc}
        strokeWidth="0.6"
      />
      <path d={`M${r - 58} ${y + 42}h30M${r - 58} ${y + 58}h30`} stroke={fl} strokeWidth="0.6" />
      {[0, 1, 2].map((b2) => (
        <rect
          key={`lb-${b2}`}
          x={r - 56 + b2 * 10}
          y={y + 28}
          width={7}
          height={12}
          rx={1}
          fill={["rgba(140,100,60,0.35)", "rgba(80,120,90,0.35)", "rgba(100,90,130,0.35)"][b2]}
        />
      ))}
    </>
  );
}

function strategyDeskFurniture(x: number, y: number, _w: number, h: number) {
  const b = y + h;
  const r = x + _w;
  return (
    <>
      {/* Large central table */}
      <rect x={x + 20} y={b - 56} width={120} height={5} rx={2} fill="rgba(160,130,90,0.45)" />
      <rect x={x + 26} y={b - 51} width={4} height={38} rx={2} fill={fl} />
      <rect x={x + 132} y={b - 51} width={4} height={38} rx={2} fill={fl} />
      {/* Papers on table */}
      <rect
        x={x + 40}
        y={b - 68}
        width={26}
        height={12}
        rx={1}
        fill="rgba(220,215,200,0.2)"
        transform={`rotate(-5 ${x + 53} ${b - 62})`}
      />
      <rect
        x={x + 74}
        y={b - 66}
        width={22}
        height={10}
        rx={1}
        fill="rgba(220,215,200,0.18)"
        transform={`rotate(4 ${x + 85} ${b - 61})`}
      />
      <rect x={x + 102} y={b - 64} width={18} height={8} rx={1} fill="rgba(220,215,200,0.15)" />
      {/* Chair silhouettes */}
      <ellipse cx={x + 60} cy={b - 10} rx={14} ry={3} fill="rgba(100,96,88,0.2)" />
      <rect x={x + 56} y={b - 28} width={8} height={16} rx={2} fill="rgba(100,96,88,0.15)" />
      <ellipse cx={x + 110} cy={b - 10} rx={14} ry={3} fill="rgba(100,96,88,0.2)" />
      <rect x={x + 106} y={b - 28} width={8} height={16} rx={2} fill="rgba(100,96,88,0.15)" />
      {/* Desk lamp */}
      <rect x={x + 144} y={b - 70} width={2} height={18} rx={0.5} fill={fl} />
      <ellipse cx={x + 145} cy={b - 72} rx={8} ry={5} fill="rgba(200,160,90,0.2)" />
      {/* Whiteboard on wall */}
      <rect
        x={r - 90}
        y={y + 24}
        width={72}
        height={52}
        rx={2}
        fill="rgba(230,228,220,0.12)"
        stroke={fc}
        strokeWidth="0.8"
      />
      <path
        d={`M${r - 78} ${y + 40}l22 10M${r - 72} ${y + 36}l14 18`}
        stroke="rgba(140,100,80,0.25)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle
        cx={r - 46}
        cy={y + 52}
        r={8}
        fill="none"
        stroke="rgba(100,140,170,0.2)"
        strokeWidth="1"
      />
      <rect x={r - 64} y={y + 60} width={20} height={3} rx={1} fill="rgba(140,100,80,0.15)" />
      {/* Clock on wall */}
      <circle cx={x + 36} cy={y + 40} r={10} fill="none" stroke={fc} strokeWidth="1.2" />
      <circle cx={x + 36} cy={y + 40} r={1.5} fill={fc} />
      <path d={`M${x + 36} ${y + 32}v8l4 4`} stroke={fc} strokeWidth="1" strokeLinecap="round" />
      {/* Third chair at end */}
      <ellipse cx={x + 160} cy={b - 10} rx={14} ry={3} fill="rgba(100,96,88,0.2)" />
      <rect x={x + 156} y={b - 28} width={8} height={16} rx={2} fill="rgba(100,96,88,0.15)" />
    </>
  );
}

function approvalDeskFurniture(x: number, y: number, _w: number, h: number) {
  const b = y + h;
  const r = x + _w;
  return (
    <>
      {/* Long counter/desk */}
      <rect x={x + 20} y={b - 56} width={160} height={5} rx={2} fill="rgba(160,130,90,0.45)" />
      <rect x={x + 26} y={b - 51} width={4} height={38} rx={2} fill={fl} />
      <rect x={x + 172} y={b - 51} width={4} height={38} rx={2} fill={fl} />
      {/* Multiple stamp holders */}
      {[0, 1, 2].map((s) => (
        <g key={`stamp-${s}`}>
          <rect
            x={x + 40 + s * 24}
            y={b - 68}
            width={12}
            height={12}
            rx={2}
            fill="rgba(140,100,60,0.30)"
          />
          <rect
            x={x + 38 + s * 24}
            y={b - 60}
            width={16}
            height={3}
            rx={1}
            fill="rgba(140,100,60,0.35)"
          />
        </g>
      ))}
      {/* Inbox/outbox trays */}
      {[0, 1, 2].map((tray) => (
        <g key={`tray-${tray}`}>
          <path
            d={`M${x + 120} ${b - 66 - tray * 12}h32l3-8h-38l3 8z`}
            fill="rgba(180,180,180,0.15)"
            stroke={fc}
            strokeWidth="0.5"
          />
          {tray < 2 && (
            <rect
              x={x + 128}
              y={b - 68 - tray * 12}
              width={18}
              height={2}
              rx={0.5}
              fill="rgba(220,215,200,0.2)"
            />
          )}
        </g>
      ))}
      {/* Desk lamp */}
      <rect x={x + 170} y={b - 72} width={2} height={18} rx={0.5} fill={fl} />
      <ellipse cx={x + 171} cy={b - 74} rx={8} ry={5} fill="rgba(200,160,90,0.2)" />
      {/* Filing cabinet */}
      <rect
        x={r - 56}
        y={b - 100}
        width={32}
        height={86}
        rx={2}
        fill="rgba(32,35,33,0.4)"
        stroke={fc}
        strokeWidth="0.6"
      />
      <path d={`M${r - 54} ${b - 72}h28M${r - 54} ${b - 44}h28`} stroke={fl} strokeWidth="0.6" />
      <circle cx={r - 40} cy={b - 86} r="1.5" fill={fl} />
      <circle cx={r - 40} cy={b - 58} r="1.5" fill={fl} />
      <circle cx={r - 40} cy={b - 30} r="1.5" fill={fl} />
      {/* Approval board on wall */}
      <rect
        x={x + 20}
        y={y + 22}
        width={60}
        height={44}
        rx={2}
        fill="rgba(220,215,200,0.06)"
        stroke={fc}
        strokeWidth="0.6"
      />
      {[0, 1, 2].map((row) =>
        [0, 1, 2, 3].map((col) => (
          <rect
            key={`cell-${row}-${col}`}
            x={x + 24 + col * 14}
            y={y + 28 + row * 13}
            width={10}
            height={9}
            rx={1}
            fill="rgba(200,190,170,0.06)"
            stroke={fl}
            strokeWidth="0.3"
          />
        )),
      )}
      <path
        d={`M${x + 28} ${y + 33}l4 4M${x + 42} ${y + 33}l4 4`}
        stroke="rgba(90,140,80,0.3)"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <path
        d={`M${x + 56} ${y + 33}l4 4l-4-1`}
        stroke="rgba(180,80,70,0.3)"
        strokeWidth="1"
        strokeLinecap="round"
      />
      {/* Clipboard on wall */}
      <rect
        x={r - 80}
        y={y + 26}
        width={16}
        height={22}
        rx={1}
        fill="rgba(220,215,200,0.08)"
        stroke={fc}
        strokeWidth="0.5"
      />
      <rect x={r - 76} y={y + 24} width={8} height={4} rx={1} fill={fl} />
      <path
        d={`M${r - 77} ${y + 34}h10M${r - 77} ${y + 38}h8M${r - 77} ${y + 42}h10`}
        stroke="rgba(138,136,127,0.2)"
        strokeWidth="0.5"
      />
    </>
  );
}

function libraryFurniture(x: number, y: number, _w: number, h: number) {
  const b = y + h;
  const r = x + _w;
  const bookColors = [
    "rgba(140,100,60,0.4)",
    "rgba(80,120,90,0.4)",
    "rgba(100,90,130,0.4)",
    "rgba(150,120,80,0.4)",
    "rgba(90,110,120,0.4)",
    "rgba(130,75,70,0.4)",
  ];
  return (
    <>
      {/* Floor-to-ceiling bookshelf */}
      <rect
        x={x + 10}
        y={y + 22}
        width={80}
        height={h - 34}
        rx={2}
        fill="rgba(32,35,33,0.45)"
        stroke={fc}
        strokeWidth="0.6"
      />
      {[0, 1, 2, 3, 4, 5].map((shelf) => {
        const sy = y + 34 + shelf * ((h - 46) / 6);
        return (
          <g key={`shelf-${shelf}`}>
            <path d={`M${x + 12} ${sy}h76`} stroke={fl} strokeWidth="0.6" />
            {[0, 1, 2, 3, 4, 5].map((bk) => (
              <rect
                key={`book-${shelf}-${bk}`}
                x={x + 14 + bk * 12}
                y={sy - ((h - 46) / 6 - 5)}
                width={9}
                height={(h - 46) / 6 - 7}
                rx={1}
                fill={bookColors[bk % 6]}
              />
            ))}
          </g>
        );
      })}
      {/* Ladder leaning against shelf */}
      <path d={`M${x + 74} ${y + 26}l16 ${h - 46}`} stroke={fl} strokeWidth="1.5" />
      <path d={`M${x + 80} ${y + 26}l16 ${h - 46}`} stroke={fl} strokeWidth="1.5" />
      {[0, 1, 2, 3].map((rung) => {
        const ry2 = y + 50 + rung * ((h - 80) / 4);
        return (
          <path
            key={`rung-${rung}`}
            d={`M${x + 76 + rung * 2} ${ry2}h8`}
            stroke={fl}
            strokeWidth="1"
          />
        );
      })}
      {/* Reading desk */}
      <rect x={x + 100} y={b - 50} width={60} height={4} rx={2} fill="rgba(160,130,90,0.4)" />
      <rect x={x + 106} y={b - 46} width={4} height={34} rx={1.5} fill={fl} />
      <rect x={x + 152} y={b - 46} width={4} height={34} rx={1.5} fill={fl} />
      {/* Open book on desk */}
      <path
        d={`M${x + 116} ${b - 58}l10-3v8l-10-4zM${x + 126} ${b - 61}l10 4l-10 4z`}
        fill="rgba(220,215,200,0.2)"
        stroke={fc}
        strokeWidth="0.4"
      />
      {/* Desk lamp */}
      <rect x={x + 150} y={b - 62} width={2} height={14} rx={0.5} fill={fl} />
      <ellipse cx={x + 151} cy={b - 64} rx={7} ry={4} fill="rgba(200,160,90,0.18)" />
      {/* Globe on stand */}
      <circle
        cx={r - 34}
        cy={b - 34}
        r={10}
        fill="rgba(100,140,170,0.2)"
        stroke={fc}
        strokeWidth="0.6"
      />
      <path d={`M${r - 44} ${b - 34}h20`} stroke={fc} strokeWidth="0.4" />
      <ellipse cx={r - 34} cy={b - 34} rx={4} ry={10} fill="none" stroke={fc} strokeWidth="0.4" />
      <rect x={r - 37} y={b - 22} width={6} height={8} rx={1} fill={fl} />
      {/* Stacked books on floor */}
      <rect x={x + 100} y={b - 16} width={18} height={4} rx={1} fill={bookColors[0]} />
      <rect x={x + 99} y={b - 20} width={20} height={4} rx={1} fill={bookColors[2]} />
      <rect x={x + 101} y={b - 24} width={16} height={4} rx={1} fill={bookColors[4]} />
      {/* Card catalog cabinet */}
      <rect
        x={r - 56}
        y={b - 60}
        width={30}
        height={46}
        rx={2}
        fill="rgba(32,35,33,0.4)"
        stroke={fc}
        strokeWidth="0.6"
      />
      {[0, 1, 2].map((row) =>
        [0, 1].map((col) => (
          <g key={`cat-${row}-${col}`}>
            <rect
              x={r - 54 + col * 14}
              y={b - 56 + row * 14}
              width={12}
              height={10}
              rx={1}
              fill="rgba(200,190,170,0.06)"
              stroke={fl}
              strokeWidth="0.3"
            />
            <circle cx={r - 48 + col * 14} cy={b - 50 + row * 14} r="1" fill={fl} />
          </g>
        )),
      )}
    </>
  );
}

export function RoomFurniture({
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
    case "lounge":
      return <g opacity="0.85">{loungeFurniture(x, y, w, h)}</g>;
    case "strategy-desk":
      return <g opacity="0.85">{strategyDeskFurniture(x, y, w, h)}</g>;
    case "approval-desk":
      return <g opacity="0.85">{approvalDeskFurniture(x, y, w, h)}</g>;
    case "library":
      return <g opacity="0.85">{libraryFurniture(x, y, w, h)}</g>;
    case "terminal-lab":
    case "mail-room":
    case "archive":
      return <LowerRoomFurniture roomId={roomId} x={x} y={y} w={w} h={h} />;
    default:
      return null;
  }
}
