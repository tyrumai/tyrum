import type { ActivityRoom } from "@tyrum/operator-core";

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
  const fc = "var(--tyrum-color-border)";
  const fl = "rgba(138,136,127,0.35)";
  const bottom = y + h;
  const right = x + w;

  switch (roomId) {
    case "terminal-lab":
      return (
        <g opacity="0.65">
          <rect x={x + 16} y={bottom - 42} width="60" height="3" rx="1" fill={fc} />
          <rect x={x + 22} y={bottom - 39} width="3" height="30" fill={fl} />
          <rect x={x + 68} y={bottom - 39} width="3" height="30" fill={fl} />
          <rect
            x={x + 28}
            y={bottom - 68}
            width="36"
            height="24"
            rx="2"
            fill="rgba(32,35,33,0.8)"
            stroke={fc}
          />
          <rect
            x={x + 31}
            y={bottom - 65}
            width="30"
            height="18"
            rx="1"
            fill="rgba(77,138,97,0.25)"
          />
          <rect x={x + 42} y={bottom - 44} width="8" height="3" fill={fl} />
          <rect
            x={right - 42}
            y={bottom - 80}
            width="24"
            height="70"
            rx="2"
            fill="rgba(32,35,33,0.7)"
            stroke={fc}
          />
          <path
            d={`M${right - 40} ${bottom - 64}h20M${right - 40} ${bottom - 48}h20M${right - 40} ${bottom - 32}h20`}
            stroke={fl}
          />
          <circle cx={right - 22} cy={bottom - 72} r="2" fill="rgba(77,138,97,0.6)" />
        </g>
      );
    case "library":
      return (
        <g opacity="0.65">
          <rect
            x={x + 14}
            y={y + 28}
            width="70"
            height={h - 40}
            rx="2"
            fill="rgba(32,35,33,0.6)"
            stroke={fc}
          />
          {[0, 1, 2, 3].map((shelf) => {
            const sy = y + 38 + shelf * ((h - 50) / 4);
            return (
              <g key={`shelf-${shelf}`}>
                <path d={`M${x + 16} ${sy}h66`} stroke={fl} />
                {[0, 1, 2, 3, 4].map((book) => (
                  <rect
                    key={`book-${shelf}-${book}`}
                    x={x + 18 + book * 13}
                    y={sy - ((h - 50) / 4 - 6)}
                    width={8}
                    height={(h - 50) / 4 - 8}
                    rx="1"
                    fill={
                      [
                        "rgba(140,100,60,0.4)",
                        "rgba(80,120,90,0.4)",
                        "rgba(100,90,130,0.4)",
                        "rgba(150,120,80,0.4)",
                        "rgba(90,110,120,0.4)",
                      ][book]!
                    }
                  />
                ))}
              </g>
            );
          })}
          <rect x={right - 36} y={bottom - 60} width="2" height="48" fill={fl} />
          <path
            d={`M${right - 44} ${bottom - 60}h16`}
            stroke={fc}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx={right - 35} cy={bottom - 63} r="4" fill="rgba(170,140,70,0.3)" />
        </g>
      );
    case "strategy-desk":
      return (
        <g opacity="0.65">
          <rect x={x + 20} y={bottom - 38} width="90" height="3" rx="1" fill={fc} />
          <rect x={x + 26} y={bottom - 35} width="3" height="26" fill={fl} />
          <rect x={x + 102} y={bottom - 35} width="3" height="26" fill={fl} />
          <rect
            x={x + 36}
            y={bottom - 48}
            width="22"
            height="9"
            rx="1"
            fill="rgba(200,190,170,0.25)"
            transform={`rotate(-4 ${x + 47} ${bottom - 43})`}
          />
          <rect
            x={x + 64}
            y={bottom - 46}
            width="18"
            height="7"
            rx="1"
            fill="rgba(200,190,170,0.2)"
            transform={`rotate(6 ${x + 73} ${bottom - 42})`}
          />
          <rect
            x={right - 80}
            y={y + 28}
            width="60"
            height="40"
            rx="2"
            fill="rgba(220,215,200,0.12)"
            stroke={fc}
          />
          <path
            d={`M${right - 70} ${y + 40}l20 8M${right - 66} ${y + 52}l16 -4`}
            stroke="rgba(138,136,127,0.3)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <circle cx={x + 40} cy={y + 40} r="8" fill="none" stroke={fl} strokeWidth="1.5" />
          <path
            d={`M${x + 40} ${y + 34}v6l3 3`}
            stroke={fl}
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </g>
      );
    case "lounge":
      return (
        <g opacity="0.65">
          <rect
            x={x + 18}
            y={bottom - 36}
            width="80"
            height="24"
            rx="6"
            fill="rgba(123,107,82,0.25)"
            stroke={fc}
          />
          <rect
            x={x + 18}
            y={bottom - 52}
            width="10"
            height="40"
            rx="4"
            fill="rgba(123,107,82,0.2)"
            stroke={fc}
          />
          <rect
            x={x + 88}
            y={bottom - 52}
            width="10"
            height="40"
            rx="4"
            fill="rgba(123,107,82,0.2)"
            stroke={fc}
          />
          <rect x={x + 108} y={bottom - 28} width="36" height="3" rx="1" fill={fc} />
          <rect x={x + 112} y={bottom - 25} width="3" height="16" fill={fl} />
          <rect x={x + 137} y={bottom - 25} width="3" height="16" fill={fl} />
          <rect
            x={right - 38}
            y={bottom - 22}
            width="14"
            height="14"
            rx="2"
            fill="rgba(123,107,82,0.3)"
          />
          <ellipse cx={right - 31} cy={bottom - 28} rx="10" ry="8" fill="rgba(77,120,72,0.35)" />
          <ellipse cx={right - 27} cy={bottom - 32} rx="6" ry="5" fill="rgba(90,140,85,0.3)" />
        </g>
      );
    case "mail-room":
      return (
        <g opacity="0.65">
          <rect
            x={x + 14}
            y={y + 28}
            width="80"
            height={h - 40}
            rx="2"
            fill="rgba(32,35,33,0.5)"
            stroke={fc}
          />
          {[0, 1, 2].map((row) =>
            [0, 1, 2, 3].map((col) => (
              <rect
                key={`cubby-${row}-${col}`}
                x={x + 18 + col * 19}
                y={y + 32 + row * ((h - 48) / 3)}
                width={16}
                height={(h - 56) / 3}
                rx="1"
                fill="rgba(200,190,170,0.08)"
                stroke={fl}
                strokeWidth="0.5"
              />
            )),
          )}
          <rect x={x + 22} y={y + 36} width="8" height="5" rx="0.5" fill="rgba(200,190,170,0.2)" />
          <rect
            x={x + 60}
            y={y + 36 + (h - 48) / 3}
            width="8"
            height="5"
            rx="0.5"
            fill="rgba(200,190,170,0.2)"
          />
          <rect
            x={right - 50}
            y={bottom - 30}
            width="20"
            height="16"
            rx="2"
            fill="rgba(160,140,110,0.2)"
            stroke={fc}
          />
          <rect
            x={right - 44}
            y={bottom - 42}
            width="16"
            height="14"
            rx="2"
            fill="rgba(160,140,110,0.15)"
            stroke={fc}
          />
        </g>
      );
    case "approval-desk":
      return (
        <g opacity="0.65">
          <rect x={x + 30} y={bottom - 38} width="100" height="3" rx="1" fill={fc} />
          <rect x={x + 36} y={bottom - 35} width="3" height="26" fill={fl} />
          <rect x={x + 122} y={bottom - 35} width="3" height="26" fill={fl} />
          <rect
            x={x + 50}
            y={bottom - 50}
            width="10"
            height="11"
            rx="1"
            fill="rgba(140,100,60,0.35)"
          />
          <rect
            x={x + 48}
            y={bottom - 42}
            width="14"
            height="3"
            rx="1"
            fill="rgba(140,100,60,0.4)"
          />
          <path
            d={`M${x + 80} ${bottom - 46}l4 8h24l4-8`}
            fill="none"
            stroke={fc}
            strokeWidth="1.5"
          />
          <path
            d={`M${x + 80} ${bottom - 56}l4 8h24l4-8`}
            fill="none"
            stroke={fc}
            strokeWidth="1.5"
          />
          <rect x={right - 50} y={bottom - 54} width="2" height="16" fill={fl} />
          <path
            d={`M${right - 56} ${bottom - 54}h14`}
            stroke={fc}
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx={right - 49} cy={bottom - 57} r="3" fill="rgba(170,140,70,0.25)" />
        </g>
      );
    case "archive":
      return (
        <g opacity="0.65">
          {[0, 1, 2].map((cab) => (
            <g key={`cabinet-${cab}`}>
              <rect
                x={x + 16 + cab * 34}
                y={y + 8}
                width="28"
                height={h - 20}
                rx="2"
                fill="rgba(32,35,33,0.5)"
                stroke={fc}
              />
              {[0, 1, 2].map((drawer) => (
                <g key={`drawer-${cab}-${drawer}`}>
                  <path
                    d={`M${x + 18 + cab * 34} ${y + 14 + drawer * ((h - 26) / 3)}h24`}
                    stroke={fl}
                  />
                  <circle
                    cx={x + 30 + cab * 34}
                    cy={y + 10 + drawer * ((h - 26) / 3) + (h - 26) / 6}
                    r="1.5"
                    fill={fl}
                  />
                </g>
              ))}
            </g>
          ))}
          <rect
            x={right - 50}
            y={y + h - 30}
            width="30"
            height="18"
            rx="2"
            fill="rgba(32,35,33,0.4)"
            stroke={fc}
          />
          <circle cx={right - 44} cy={y + h - 10} r="3" fill="none" stroke={fl} />
          <circle cx={right - 24} cy={y + h - 10} r="3" fill="none" stroke={fl} />
        </g>
      );
    default:
      return null;
  }
}
