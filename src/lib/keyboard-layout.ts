export const MARGIN = 0.85;
export const MARK = 0.42;
export const CONTENT_W = 22.5;
export const CONTENT_H = 6.02;
export const BOARD_W = CONTENT_W + MARGIN * 2;
export const BOARD_H = CONTENT_H + MARGIN * 2;

const ROW = {
  fnY: 0,
  fnH: 0.7,
  numY: 0.82,
  qY: 1.87,
  aY: 2.92,
  zY: 3.97,
  bY: 5.02,
  h: 1,
} as const;

const SPAN2 = ROW.aY + ROW.h - ROW.qY;

export type ModName = "shift" | "ctrl" | "alt" | "meta" | "fn";

export type EditName =
  | "esc"
  | "tab"
  | "backspace"
  | "enter"
  | "delete"
  | "left"
  | "right"
  | "up"
  | "down"
  | "home"
  | "end"
  | "pgup"
  | "pgdn";

export type FnAct = "vol-down" | "vol-up" | "mute" | "copy" | "focus" | "full";

export type KeyKind =
  | { t: "char"; ch: string; shift: string }
  | { t: "mod"; mod: ModName }
  | { t: "lock"; lock: "caps" | "numlock" | "insert" }
  | { t: "edit"; edit: EditName }
  | { t: "fn"; code: string; act?: FnAct }
  | { t: "num"; ch: string; nav: EditName | "ins" | "none" }
  | { t: "signal"; name: string };

export type KeySpec = {
  id: string;
  /** Spoken / chord name. */
  label: string;
  /** Primary cap engraving. */
  legend: string;
  /** Small upper engraving (shift glyph, Fn action, or numpad nav). */
  sub?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: KeyKind;
};

type Draft = {
  id: string;
  label: string;
  legend: string;
  sub?: string;
  w: number;
  h?: number;
  x?: number;
  kind: KeyKind;
};

function place(items: Draft[], y: number, h = 1): KeySpec[] {
  let cursor = 0;
  return items.map((item) => {
    const x = item.x ?? cursor;
    cursor = x + item.w;
    return {
      id: item.id,
      label: item.label,
      legend: item.legend,
      sub: item.sub,
      x: x + MARGIN,
      y: y + MARGIN,
      w: item.w,
      h: item.h ?? h,
      kind: item.kind,
    };
  });
}

const letter = (ch: string, x?: number): Draft => ({
  id: ch,
  label: ch.toUpperCase(),
  legend: ch.toUpperCase(),
  w: 1,
  x,
  kind: { t: "char", ch, shift: ch.toUpperCase() },
});

const sym = (
  id: string,
  legend: string,
  ch: string,
  shift: string,
  w = 1,
  x?: number,
): Draft => ({
  id,
  label: legend,
  legend,
  sub: shift,
  w,
  x,
  kind: { t: "char", ch, shift },
});

const edit = (id: string, label: string, name: EditName, w: number, x?: number, h?: number): Draft => ({
  id,
  label,
  legend: label,
  w,
  h,
  x,
  kind: { t: "edit", edit: name },
});

const mod = (id: string, label: string, name: ModName, w: number, x?: number): Draft => ({
  id,
  label,
  legend: label,
  w,
  x,
  kind: { t: "mod", mod: name },
});

const fn = (code: string, sub: string, x: number | undefined, act?: FnAct): Draft => ({
  id: code.toLowerCase(),
  label: code,
  legend: code,
  sub,
  w: 1,
  x,
  kind: { t: "fn", code, act },
});

const num = (
  id: string,
  ch: string,
  nav: EditName | "ins" | "none",
  sub: string,
  x?: number,
  w = 1,
): Draft => ({
  id,
  label: ch,
  legend: ch,
  sub,
  w,
  x,
  kind: { t: "num", ch, nav },
});

const signal = (id: string, label: string, w = 1, x?: number): Draft => ({
  id,
  label,
  legend: label,
  w,
  x,
  kind: { t: "signal", name: label },
});

export const KEYS: KeySpec[] = [
  ...place(
    [
      edit("esc", "Esc", "esc", 1),
      fn("F1", "Quiet", 2, "vol-down"),
      fn("F2", "Loud", undefined, "vol-up"),
      fn("F3", "Mute", undefined, "mute"),
      fn("F4", "◀◀", undefined),
      fn("F5", "Play", 6.5),
      fn("F6", "▶▶", undefined),
      fn("F7", "Dim", undefined),
      fn("F8", "Sun", undefined),
      fn("F9", "Wifi", 11),
      fn("F10", "Find", undefined, "focus"),
      fn("F11", "Full", undefined, "full"),
      fn("F12", "Copy", undefined, "copy"),
      signal("prtsc", "PrtSc", 1, 15.25),
      signal("scrlk", "ScrLk"),
      signal("pause", "Pause"),
    ],
    ROW.fnY,
    ROW.fnH,
  ),
  ...place(
    [
      sym("grave", "`", "`", "~"),
      sym("d1", "1", "1", "!"),
      sym("d2", "2", "2", "@"),
      sym("d3", "3", "3", "#"),
      sym("d4", "4", "4", "$"),
      sym("d5", "5", "5", "%"),
      sym("d6", "6", "6", "^"),
      sym("d7", "7", "7", "&"),
      sym("d8", "8", "8", "*"),
      sym("d9", "9", "9", "("),
      sym("d0", "0", "0", ")"),
      sym("minus", "-", "-", "_"),
      sym("equal", "=", "=", "+"),
      edit("back", "Back", "backspace", 2),
      { id: "ins", label: "Ins", legend: "Ins", w: 1, x: 15.25, kind: { t: "lock", lock: "insert" } },
      edit("home", "Home", "home", 1),
      edit("pgup", "PgUp", "pgup", 1),
      { id: "numlock", label: "Num", legend: "Num", w: 1, x: 18.5, kind: { t: "lock", lock: "numlock" } },
      sym("ndiv", "/", "/", "/"),
      sym("nmul", "*", "*", "*"),
      sym("nminus", "−", "-", "-"),
    ],
    ROW.numY,
  ),
  ...place(
    [
      edit("tab", "Tab", "tab", 1.5),
      letter("q"),
      letter("w"),
      letter("e"),
      letter("r"),
      letter("t"),
      letter("y"),
      letter("u"),
      letter("i"),
      letter("o"),
      letter("p"),
      sym("lbrack", "[", "[", "{"),
      sym("rbrack", "]", "]", "}"),
      sym("bslash", "\\", "\\", "|", 1.5),
      edit("del", "Del", "delete", 1, 15.25),
      edit("end", "End", "end", 1),
      edit("pgdn", "PgDn", "pgdn", 1),
      num("n7", "7", "home", "Home", 18.5),
      num("n8", "8", "up", "↑"),
      num("n9", "9", "pgup", "PgUp"),
      sym("nplus", "+", "+", "+", 1, 21.5),
    ],
    ROW.qY,
  ).map((key) => (key.id === "nplus" ? { ...key, h: SPAN2 } : key)),
  ...place(
    [
      { id: "caps", label: "Caps", legend: "Caps", w: 1.75, kind: { t: "lock", lock: "caps" } },
      letter("a"),
      letter("s"),
      letter("d"),
      letter("f"),
      letter("g"),
      letter("h"),
      letter("j"),
      letter("k"),
      letter("l"),
      sym("semi", ";", ";", ":"),
      sym("quote", "'", "'", '"'),
      edit("enter", "Enter", "enter", 2.25),
      num("n4", "4", "left", "←", 18.5),
      num("n5", "5", "none", ""),
      num("n6", "6", "right", "→"),
    ],
    ROW.aY,
  ),
  ...place(
    [
      mod("lshift", "Shift", "shift", 2.25),
      letter("z"),
      letter("x"),
      letter("c"),
      letter("v"),
      letter("b"),
      letter("n"),
      letter("m"),
      sym("comma", ",", ",", "<"),
      sym("dot", ".", ".", ">"),
      sym("slash", "/", "/", "?"),
      mod("rshift", "Shift", "shift", 2.75),
      edit("up", "↑", "up", 1, 16.25),
      num("n1", "1", "end", "End", 18.5),
      num("n2", "2", "down", "↓"),
      num("n3", "3", "pgdn", "PgDn"),
      edit("nenter", "Enter", "enter", 1, 21.5, SPAN2),
    ],
    ROW.zY,
  ),
  ...place(
    [
      mod("lctrl", "Ctrl", "ctrl", 1.25),
      mod("fn", "Fn", "fn", 1.25),
      mod("lmeta", "Win", "meta", 1.25),
      mod("lalt", "Alt", "alt", 1.25),
      {
        id: "space",
        label: "Space",
        legend: "",
        w: 6.25,
        kind: { t: "char", ch: " ", shift: " " },
      },
      mod("ralt", "Alt", "alt", 1.25),
      signal("menu", "Menu", 1.25),
      mod("rctrl", "Ctrl", "ctrl", 1.25),
      edit("left", "←", "left", 1, 15.25),
      edit("down", "↓", "down", 1),
      edit("right", "→", "right", 1),
      num("n0", "0", "ins", "Ins", 18.5, 2),
      num("ndot", ".", "delete", "Del", 20.5),
    ],
    ROW.bY,
  ),
];

const BY_ID = new Map(KEYS.map((key) => [key.id, key]));

export function keyById(id: string): KeySpec | undefined {
  return BY_ID.get(id);
}

/** Corners of the printed crosses, in tap order: 1 top-left, then clockwise. */
export const CORNERS: { x: number; y: number }[] = [
  { x: MARK, y: MARK },
  { x: BOARD_W - MARK, y: MARK },
  { x: BOARD_W - MARK, y: BOARD_H - MARK },
  { x: MARK, y: BOARD_H - MARK },
];

export function hitTest(px: number, py: number): KeySpec | null {
  let best: KeySpec | null = null;
  let bestD = Infinity;
  for (const key of KEYS) {
    const dx = Math.max(key.x - px, 0, px - (key.x + key.w));
    const dy = Math.max(key.y - py, 0, py - (key.y + key.h));
    const dist = Math.hypot(dx, dy);
    if (dist < bestD) {
      bestD = dist;
      best = key;
    }
  }
  if (!best || bestD > 0.2) return null;
  return best;
}
