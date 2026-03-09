import type { ActivityRoom } from "@tyrum/operator-core";
import { LowerRoomFurniture } from "./activity-scene-furniture-lower.js";

const fc = "var(--tyrum-color-border)";
const fw = "rgba(175,140,100,0.50)";
const fwDark = "rgba(150,118,82,0.45)";
const fwLight = "rgba(200,170,130,0.40)";
const metal = "rgba(175,165,148,0.38)";
const paper = "rgba(235,228,218,0.22)";
const plantGreen = "rgba(95,148,82,0.42)";

function loungeFurniture(x: number, y: number, _w: number, h: number) {
  const b = y + h;
  const r = x + _w;
  return (
    <>
      {/* Soft rug */}
      <ellipse cx={x + _w / 2} cy={b - 18} rx={_w * 0.34} ry={14} fill="rgba(185,145,120,0.10)" />
      {/* Cozy sofa */}
      <rect x={x + 16} y={b - 48} width={100} height={28} rx={8} fill="rgba(175,125,105,0.35)" />
      <rect
        x={x + 16}
        y={b - 65}
        width={14}
        height={45}
        rx={7}
        fill="rgba(165,118,98,0.28)"
        stroke={fc}
        strokeWidth="0.6"
      />
      <rect
        x={x + 102}
        y={b - 65}
        width={14}
        height={45}
        rx={7}
        fill="rgba(165,118,98,0.28)"
        stroke={fc}
        strokeWidth="0.6"
      />
      {/* Cushions */}
      <rect x={x + 34} y={b - 46} width={26} height={16} rx={6} fill="rgba(210,160,100,0.28)" />
      <rect x={x + 66} y={b - 46} width={26} height={16} rx={6} fill="rgba(145,120,160,0.25)" />
      {/* Coffee table */}
      <rect x={x + 126} y={b - 36} width={48} height={4} rx={3} fill={fw} />
      <rect x={x + 132} y={b - 32} width={4} height={20} rx={2} fill={fwDark} />
      <rect x={x + 166} y={b - 32} width={4} height={20} rx={2} fill={fwDark} />
      {/* Mug and book on table */}
      <rect x={x + 136} y={b - 44} width={7} height={8} rx={2} fill="rgba(210,185,155,0.35)" />
      <rect x={x + 150} y={b - 44} width={14} height={3} rx={1} fill="rgba(140,100,65,0.38)" />
      {/* Floor plant */}
      <rect x={r - 46} y={b - 28} width={11} height={16} rx={5} fill="rgba(175,128,82,0.38)" />
      <ellipse cx={r - 40} cy={b - 36} rx={13} ry={9} fill={plantGreen} />
      <ellipse cx={r - 36} cy={b - 44} rx={8} ry={6} fill="rgba(100,158,90,0.38)" />
      <ellipse cx={r - 44} cy={b - 40} rx={6} ry={5} fill="rgba(85,140,75,0.32)" />
      {/* Picture frames on wall */}
      <rect
        x={x + 38}
        y={y + 22}
        width={36}
        height={28}
        rx={2}
        fill="rgba(160,195,165,0.12)"
        stroke={fw}
        strokeWidth="1"
      />
      <rect
        x={x + 84}
        y={y + 26}
        width={24}
        height={24}
        rx={2}
        fill="rgba(195,165,140,0.10)"
        stroke={fw}
        strokeWidth="1"
      />
      {/* Floor lamp */}
      <rect x={r - 26} y={b - 108} width={2.5} height={94} rx={1} fill={metal} />
      <path
        d={`M${r - 35} ${b - 110}l4-5h14l4 5z`}
        fill="rgba(215,180,130,0.28)"
        stroke="rgba(200,168,120,0.22)"
        strokeWidth="0.6"
      />
      <ellipse cx={r - 24} cy={b - 108} rx={10} ry={5} fill="rgba(245,220,160,0.12)" />
      <circle cx={r - 24} cy={b - 12} r={6} fill="rgba(155,145,130,0.18)" />
      {/* Side table */}
      <rect x={r - 68} y={b - 28} width={16} height={3} rx={2} fill={fw} />
      <rect x={r - 62} y={b - 25} width={3} height={14} rx={1} fill={fwDark} />
    </>
  );
}

function strategyDeskFurniture(x: number, y: number, _w: number, h: number) {
  const b = y + h;
  const r = x + _w;
  return (
    <>
      {/* Writing desk with drawers */}
      <rect x={x + 18} y={b - 54} width={120} height={5} rx={3} fill={fw} />
      <rect x={x + 24} y={b - 49} width={4} height={36} rx={2} fill={fwDark} />
      <rect x={x + 130} y={b - 49} width={4} height={36} rx={2} fill={fwDark} />
      {/* Drawer panel */}
      <rect
        x={x + 108}
        y={b - 49}
        width={22}
        height={34}
        rx={2}
        fill={fwLight}
        stroke={fc}
        strokeWidth="0.5"
      />
      <circle cx={x + 119} cy={b - 38} r="1.2" fill={metal} />
      <circle cx={x + 119} cy={b - 26} r="1.2" fill={metal} />
      {/* Papers on desk */}
      <rect
        x={x + 38}
        y={b - 66}
        width={24}
        height={12}
        rx={1}
        fill={paper}
        transform={`rotate(-6 ${x + 50} ${b - 60})`}
      />
      <rect x={x + 70} y={b - 64} width={20} height={10} rx={1} fill="rgba(230,225,215,0.18)" />
      {/* Pen */}
      <line
        x1={x + 96}
        y1={b - 66}
        x2={x + 104}
        y2={b - 60}
        stroke="rgba(60,75,120,0.35)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Desk lamp */}
      <rect x={x + 142} y={b - 68} width={2} height={16} rx={0.5} fill={metal} />
      <path d={`M${x + 136} ${b - 70}l3-4h10l3 4z`} fill="rgba(215,180,130,0.28)" />
      <ellipse cx={x + 145} cy={b - 68} rx={7} ry={4} fill="rgba(245,220,160,0.10)" />
      {/* Comfortable chair */}
      <ellipse cx={x + 76} cy={b - 10} rx={16} ry={3.5} fill="rgba(150,128,108,0.22)" />
      <rect x={x + 70} y={b - 30} width={12} height={18} rx={4} fill="rgba(165,135,115,0.22)" />
      {/* Cork board on wall */}
      <rect
        x={r - 88}
        y={y + 22}
        width={68}
        height={48}
        rx={3}
        fill="rgba(195,165,125,0.12)"
        stroke={fw}
        strokeWidth="1"
      />
      {/* Pinned notes */}
      <rect x={r - 80} y={y + 30} width={16} height={12} rx={1} fill="rgba(245,225,140,0.22)" />
      <circle cx={r - 72} cy={y + 28} r="1.5" fill="rgba(215,95,90,0.50)" />
      <rect x={r - 58} y={y + 34} width={14} height={10} rx={1} fill="rgba(170,210,175,0.20)" />
      <circle cx={r - 51} cy={y + 32} r="1.5" fill="rgba(95,140,210,0.50)" />
      <rect x={r - 40} y={y + 28} width={12} height={14} rx={1} fill="rgba(200,180,220,0.18)" />
      <circle cx={r - 34} cy={y + 26} r="1.5" fill="rgba(230,180,80,0.50)" />
      <rect x={r - 76} y={y + 50} width={20} height={8} rx={1} fill={paper} />
      <rect x={r - 50} y={y + 52} width={16} height={6} rx={1} fill="rgba(210,230,215,0.15)" />
      {/* Wall clock */}
      <circle
        cx={x + 34}
        cy={y + 38}
        r={10}
        fill="rgba(235,228,218,0.10)"
        stroke={fw}
        strokeWidth="1.2"
      />
      <circle cx={x + 34} cy={y + 38} r={1.5} fill={fwDark} />
      <path
        d={`M${x + 34} ${y + 30}v8l4 4`}
        stroke={fwDark}
        strokeWidth="1"
        strokeLinecap="round"
      />
      {/* Small bookshelf */}
      <rect
        x={x + 152}
        y={y + 26}
        width={30}
        height={44}
        rx={2}
        fill={fwLight}
        stroke={fc}
        strokeWidth="0.5"
      />
      <path
        d={`M${x + 154} ${y + 42}h26M${x + 154} ${y + 56}h26`}
        stroke={fwDark}
        strokeWidth="0.5"
      />
      {[0, 1, 2].map((bk) => (
        <rect
          key={`sb-${bk}`}
          x={x + 156 + bk * 8}
          y={y + 28}
          width={6}
          height={12}
          rx={1}
          fill={["rgba(155,110,70,0.40)", "rgba(90,135,100,0.40)", "rgba(115,100,145,0.40)"][bk]}
        />
      ))}
    </>
  );
}

function approvalDeskFurniture(x: number, y: number, _w: number, h: number) {
  const b = y + h;
  const r = x + _w;
  return (
    <>
      {/* Long counter desk */}
      <rect x={x + 18} y={b - 54} width={155} height={5} rx={3} fill={fw} />
      <rect x={x + 24} y={b - 49} width={4} height={36} rx={2} fill={fwDark} />
      <rect x={x + 165} y={b - 49} width={4} height={36} rx={2} fill={fwDark} />
      {/* Stamp holders */}
      {[0, 1, 2].map((s) => (
        <g key={`stamp-${s}`}>
          <rect
            x={x + 38 + s * 22}
            y={b - 66}
            width={10}
            height={12}
            rx={2}
            fill="rgba(155,115,75,0.35)"
          />
          <rect
            x={x + 36 + s * 22}
            y={b - 58}
            width={14}
            height={3}
            rx={1.5}
            fill="rgba(150,110,70,0.38)"
          />
        </g>
      ))}
      {/* In/out trays */}
      {[0, 1, 2].map((tray) => (
        <g key={`tray-${tray}`}>
          <path
            d={`M${x + 118} ${b - 64 - tray * 12}h30l3-7h-36l3 7z`}
            fill="rgba(195,185,170,0.18)"
            stroke={fc}
            strokeWidth="0.5"
          />
          {tray < 2 && (
            <rect x={x + 126} y={b - 66 - tray * 12} width={16} height={2} rx={0.5} fill={paper} />
          )}
        </g>
      ))}
      {/* Desk lamp */}
      <rect x={x + 168} y={b - 70} width={2} height={18} rx={0.5} fill={metal} />
      <path d={`M${x + 162} ${b - 72}l3-4h10l3 4z`} fill="rgba(215,180,130,0.28)" />
      {/* Wooden filing cabinet */}
      <rect
        x={r - 54}
        y={b - 98}
        width={30}
        height={84}
        rx={3}
        fill={fwLight}
        stroke={fc}
        strokeWidth="0.6"
      />
      <path
        d={`M${r - 52} ${b - 70}h26M${r - 52} ${b - 42}h26`}
        stroke={fwDark}
        strokeWidth="0.5"
      />
      {/* Brass drawer handles */}
      <circle cx={r - 39} cy={b - 84} r="1.8" fill="rgba(195,175,130,0.42)" />
      <circle cx={r - 39} cy={b - 56} r="1.8" fill="rgba(195,175,130,0.42)" />
      <circle cx={r - 39} cy={b - 28} r="1.8" fill="rgba(195,175,130,0.42)" />
      {/* Coffee mug on desk */}
      <rect x={x + 100} y={b - 64} width={7} height={8} rx={2} fill="rgba(200,175,145,0.32)" />
      {/* Wall calendar */}
      <rect
        x={x + 18}
        y={y + 20}
        width={56}
        height={42}
        rx={2}
        fill={paper}
        stroke={fc}
        strokeWidth="0.6"
      />
      {[0, 1, 2].map((row) =>
        [0, 1, 2, 3].map((col) => (
          <rect
            key={`cell-${row}-${col}`}
            x={x + 22 + col * 13}
            y={y + 34 + row * 9}
            width={10}
            height={6}
            rx={1}
            fill="rgba(215,205,190,0.10)"
            stroke="rgba(190,180,165,0.12)"
            strokeWidth="0.3"
          />
        )),
      )}
      {/* Check marks on calendar */}
      <path
        d={`M${x + 25} ${y + 38}l2 2 4-4M${x + 38} ${y + 38}l2 2 4-4`}
        stroke="rgba(110,165,105,0.35)"
        strokeWidth="1"
        strokeLinecap="round"
        fill="none"
      />
    </>
  );
}

function libraryFurniture(x: number, y: number, _w: number, h: number) {
  const b = y + h;
  const r = x + _w;
  const bookColors = [
    "rgba(155,110,65,0.45)",
    "rgba(90,135,100,0.45)",
    "rgba(115,100,145,0.45)",
    "rgba(165,130,85,0.45)",
    "rgba(100,125,140,0.45)",
    "rgba(150,85,80,0.45)",
  ];
  return (
    <>
      {/* Large bookshelf */}
      <rect
        x={x + 10}
        y={y + 20}
        width={80}
        height={h - 32}
        rx={3}
        fill={fwLight}
        stroke={fc}
        strokeWidth="0.6"
      />
      {[0, 1, 2, 3, 4, 5].map((shelf) => {
        const sy = y + 32 + shelf * ((h - 44) / 6);
        return (
          <g key={`shelf-${shelf}`}>
            <path d={`M${x + 12} ${sy}h76`} stroke={fwDark} strokeWidth="0.6" />
            {[0, 1, 2, 3, 4, 5].map((bk) => (
              <rect
                key={`book-${shelf}-${bk}`}
                x={x + 14 + bk * 12}
                y={sy - ((h - 44) / 6 - 5)}
                width={9}
                height={(h - 44) / 6 - 7}
                rx={1}
                fill={bookColors[bk % 6]}
              />
            ))}
          </g>
        );
      })}
      {/* Ladder */}
      <path d={`M${x + 74} ${y + 24}l16 ${h - 44}`} stroke={fw} strokeWidth="1.8" />
      <path d={`M${x + 80} ${y + 24}l16 ${h - 44}`} stroke={fw} strokeWidth="1.8" />
      {[0, 1, 2, 3].map((rung) => {
        const ry = y + 48 + rung * ((h - 78) / 4);
        return (
          <path
            key={`rung-${rung}`}
            d={`M${x + 76 + rung * 2} ${ry}h8`}
            stroke={fw}
            strokeWidth="1"
          />
        );
      })}
      {/* Reading armchair */}
      <rect x={x + 100} y={b - 40} width={30} height={22} rx={8} fill="rgba(175,135,115,0.30)" />
      <rect x={x + 98} y={b - 52} width={10} height={34} rx={5} fill="rgba(165,128,108,0.24)" />
      <rect x={x + 122} y={b - 52} width={10} height={34} rx={5} fill="rgba(165,128,108,0.24)" />
      {/* Side table with lamp */}
      <rect x={x + 138} y={b - 30} width={18} height={3} rx={2} fill={fw} />
      <rect x={x + 144} y={b - 27} width={3} height={16} rx={1} fill={fwDark} />
      <rect x={x + 140} y={b - 40} width={2} height={12} rx={0.5} fill={metal} />
      <ellipse cx={x + 141} cy={b - 42} rx={6} ry={4} fill="rgba(245,220,160,0.12)" />
      {/* Globe on stand */}
      <circle
        cx={r - 32}
        cy={b - 32}
        r={10}
        fill="rgba(110,155,180,0.22)"
        stroke={fc}
        strokeWidth="0.6"
      />
      <path d={`M${r - 42} ${b - 32}h20`} stroke={fc} strokeWidth="0.4" />
      <ellipse cx={r - 32} cy={b - 32} rx={4} ry={10} fill="none" stroke={fc} strokeWidth="0.4" />
      <rect x={r - 35} y={b - 20} width={6} height={8} rx={2} fill={fwDark} />
      {/* Stacked books on floor */}
      <rect x={x + 100} y={b - 16} width={18} height={4} rx={1} fill={bookColors[0]} />
      <rect x={x + 99} y={b - 20} width={20} height={4} rx={1} fill={bookColors[2]} />
      <rect x={x + 101} y={b - 24} width={16} height={4} rx={1} fill={bookColors[4]} />
      {/* Card catalog */}
      <rect
        x={r - 56}
        y={b - 58}
        width={30}
        height={44}
        rx={3}
        fill={fwLight}
        stroke={fc}
        strokeWidth="0.5"
      />
      {[0, 1, 2].map((row) =>
        [0, 1].map((col) => (
          <g key={`cat-${row}-${col}`}>
            <rect
              x={r - 54 + col * 14}
              y={b - 54 + row * 14}
              width={12}
              height={10}
              rx={1.5}
              fill="rgba(215,205,190,0.10)"
              stroke={fwDark}
              strokeWidth="0.3"
            />
            <circle
              cx={r - 48 + col * 14}
              cy={b - 48 + row * 14}
              r="1.2"
              fill="rgba(195,175,130,0.42)"
            />
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
      return <g opacity="0.88">{loungeFurniture(x, y, w, h)}</g>;
    case "strategy-desk":
      return <g opacity="0.88">{strategyDeskFurniture(x, y, w, h)}</g>;
    case "approval-desk":
      return <g opacity="0.88">{approvalDeskFurniture(x, y, w, h)}</g>;
    case "library":
      return <g opacity="0.88">{libraryFurniture(x, y, w, h)}</g>;
    case "terminal-lab":
    case "mail-room":
    case "archive":
      return <LowerRoomFurniture roomId={roomId} x={x} y={y} w={w} h={h} />;
    default:
      return null;
  }
}
