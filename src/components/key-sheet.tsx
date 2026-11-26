import { BOARD_H, BOARD_W, CORNERS, KEYS, type KeySpec } from "@/lib/keyboard-layout";
import { cn } from "@/lib/cn";

type Phase = "down" | "up";

export function KeySheet({
  tone,
  interactive,
  numlock,
  fnOn,
  isOn,
  onPhase,
}: {
  tone: "desk" | "print";
  interactive: boolean;
  numlock: boolean;
  fnOn: boolean;
  isOn?: (key: KeySpec) => boolean;
  onPhase?: (key: KeySpec, phase: Phase) => void;
}) {
  return (
    <div className={cn("board", tone === "print" ? "board-print" : "board-desk")} data-tone={tone}>
      {KEYS.map((key) => {
        const text = capText(key, numlock, fnOn);
        const on = isOn?.(key) ?? false;
        const style = {
          left: `${(key.x / BOARD_W) * 100}%`,
          top: `${(key.y / BOARD_H) * 100}%`,
          width: `${(key.w / BOARD_W) * 100}%`,
          height: `${(key.h / BOARD_H) * 100}%`,
        };
        const face = (
          <span className="keyface">
            {text.sub ? <span className="keycap-sub">{text.sub}</span> : null}
            <span className="keycap-main">{text.main}</span>
          </span>
        );
        if (!interactive) {
          return (
            <div key={key.id} className="keycap" style={style} data-on={on ? "true" : "false"}>
              {face}
            </div>
          );
        }
        return (
          <button
            key={key.id}
            type="button"
            className="keycap"
            style={style}
            data-on={on ? "true" : "false"}
            aria-label={key.label}
            aria-pressed={on}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              onPhase?.(key, "down");
            }}
            onPointerUp={() => onPhase?.(key, "up")}
            onPointerCancel={() => onPhase?.(key, "up")}
          >
            {face}
          </button>
        );
      })}
      {CORNERS.map((corner, index) => (
        <span
          key={index}
          className="mark"
          style={{
            left: `${(corner.x / BOARD_W) * 100}%`,
            top: `${(corner.y / BOARD_H) * 100}%`,
          }}
        >
          {index + 1}
        </span>
      ))}
    </div>
  );
}

function capText(key: KeySpec, numlock: boolean, fnOn: boolean): { main: string; sub?: string } {
  if (key.kind.t === "fn") {
    return fnOn
      ? { main: key.sub || key.legend, sub: key.legend }
      : { main: key.legend, sub: key.sub };
  }
  if (key.kind.t === "num") {
    return numlock
      ? { main: key.legend, sub: key.sub || undefined }
      : { main: key.sub || key.legend, sub: key.legend };
  }
  return { main: key.legend, sub: key.sub };
}
