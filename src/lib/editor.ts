import { keyById, type EditName, type KeySpec, type ModName } from "./keyboard-layout";

export type Phase = "down" | "repeat" | "up";

export type Fx =
  | { t: "click"; tone: "key" | "mod" }
  | { t: "copy"; text: string }
  | { t: "paste" }
  | { t: "vol"; delta: number }
  | { t: "mute" }
  | { t: "fullscreen" }
  | { t: "focus" };

type Snap = { value: string; anchor: number; focus: number };

export type EditorState = {
  value: string;
  anchor: number;
  focus: number;
  sticky: Record<ModName, boolean>;
  held: string[];
  armedAt: Record<string, number>;
  caps: boolean;
  numlock: boolean;
  overtype: boolean;
  chord: string;
  undo: Snap[];
  redo: Snap[];
};

const MODS: ModName[] = ["shift", "ctrl", "alt", "meta", "fn"];

const emptySticky = (): Record<ModName, boolean> => ({
  shift: false,
  ctrl: false,
  alt: false,
  meta: false,
  fn: false,
});

export function createEditor(): EditorState {
  return {
    value: "",
    anchor: 0,
    focus: 0,
    sticky: emptySticky(),
    held: [],
    armedAt: {},
    caps: false,
    numlock: true,
    overtype: false,
    chord: "Ready",
    undo: [],
    redo: [],
  };
}

export function repeats(key: KeySpec): boolean {
  if (key.kind.t === "char" || key.kind.t === "num") return true;
  if (key.kind.t === "edit") return key.kind.edit !== "esc";
  return false;
}

export function modHeld(state: EditorState, mod: ModName): boolean {
  return state.held.some((id) => {
    const key = keyById(id);
    return key?.kind.t === "mod" && key.kind.mod === mod;
  });
}

export function modOn(state: EditorState, mod: ModName): boolean {
  return state.sticky[mod] || modHeld(state, mod);
}

export function undo(state: EditorState): EditorState {
  const prev = state.undo[0];
  if (!prev) return { ...state, chord: "Nothing to undo" };
  return {
    ...state,
    value: prev.value,
    anchor: prev.anchor,
    focus: prev.focus,
    undo: state.undo.slice(1),
    redo: [snap(state), ...state.redo].slice(0, 100),
    chord: "Undo",
  };
}

export function redo(state: EditorState): EditorState {
  const next = state.redo[0];
  if (!next) return { ...state, chord: "Nothing to redo" };
  return {
    ...state,
    value: next.value,
    anchor: next.anchor,
    focus: next.focus,
    redo: state.redo.slice(1),
    undo: [snap(state), ...state.undo].slice(0, 100),
    chord: "Redo",
  };
}

/** Snapshot the document before a physical-keyboard edit. */
export function pushUndo(state: EditorState): EditorState {
  const top = state.undo[0];
  if (top && top.value === state.value && top.anchor === state.anchor && top.focus === state.focus) {
    return state;
  }
  return { ...state, undo: [snap(state), ...state.undo].slice(0, 100), redo: [] };
}

export function insertPlain(state: EditorState, text: string): EditorState {
  return commit(state, splice(state, text, state.overtype));
}

export function selectedText(state: EditorState): string {
  const { a, b } = bounds(state);
  return state.value.slice(a, b);
}

export function reduceKey(
  state: EditorState,
  key: KeySpec,
  phase: Phase,
  now: number,
): { state: EditorState; fx: Fx[] } {
  if (phase === "up") return release(state, key, now);
  if (phase === "down" && state.held.includes(key.id)) return { state, fx: [] };

  const base: EditorState = {
    ...state,
    held: phase === "down" ? [...state.held, key.id] : state.held,
    armedAt: phase === "down" ? { ...state.armedAt, [key.id]: now } : state.armedAt,
  };
  return press(base, key);
}

function release(state: EditorState, key: KeySpec, now: number): { state: EditorState; fx: Fx[] } {
  const started = state.armedAt[key.id] ?? now;
  const armedAt = { ...state.armedAt };
  delete armedAt[key.id];
  let next: EditorState = { ...state, held: state.held.filter((id) => id !== key.id), armedAt };
  if (key.kind.t === "mod" && now - started >= 50 && now - started < 280) {
    const mod = key.kind.mod;
    const on = !state.sticky[mod];
    next = {
      ...next,
      sticky: { ...next.sticky, [mod]: on },
      chord: on ? modLabel(mod) : `${modLabel(mod)} off`,
    };
  }
  return { state: next, fx: [] };
}

function press(state: EditorState, key: KeySpec): { state: EditorState; fx: Fx[] } {
  const kind = key.kind;
  if (kind.t === "lock") {
    if (kind.lock === "caps") {
      return {
        state: { ...state, caps: !state.caps, chord: state.caps ? "Caps off" : "Caps Lock" },
        fx: [click("mod")],
      };
    }
    if (kind.lock === "numlock") {
      return {
        state: { ...state, numlock: !state.numlock, chord: state.numlock ? "Num Lock off" : "Num Lock" },
        fx: [click("mod")],
      };
    }
    return {
      state: { ...state, overtype: !state.overtype, chord: state.overtype ? "Insert" : "Overwrite" },
      fx: [click("mod")],
    };
  }

  if (kind.t === "mod") {
    return { state: { ...state, chord: modLabel(kind.mod) }, fx: [click("mod")] };
  }

  if (kind.t === "signal") {
    return {
      state: releaseShots({ ...state, chord: chordName(state, key) }, "char"),
      fx: [click("key")],
    };
  }

  if (kind.t === "fn") {
    const fx: Fx[] = [click("key")];
    const fnOn = modOn(state, "fn");
    if (fnOn && kind.act === "vol-down") fx.push({ t: "vol", delta: -0.2 });
    if (fnOn && kind.act === "vol-up") fx.push({ t: "vol", delta: 0.2 });
    if (fnOn && kind.act === "mute") fx.push({ t: "mute" });
    if (fnOn && kind.act === "copy") fx.push({ t: "copy", text: state.value });
    if (fnOn && kind.act === "focus") fx.push({ t: "focus" });
    if (fnOn && kind.act === "full") fx.push({ t: "fullscreen" });
    return {
      state: releaseShots({ ...state, chord: chordName(state, key) }, "fn"),
      fx,
    };
  }

  if (kind.t === "edit" && kind.edit === "esc") {
    return {
      state: {
        ...state,
        sticky: emptySticky(),
        anchor: state.focus,
        focus: state.focus,
        chord: "Esc",
      },
      fx: [click("mod")],
    };
  }

  if (kind.t === "edit" && (kind.edit === "backspace" || kind.edit === "delete")) {
    return editDelete(state, key, kind.edit === "backspace");
  }

  if (kind.t === "edit" && (kind.edit === "enter" || kind.edit === "tab")) {
    if (modOn(state, "ctrl") || modOn(state, "alt") || modOn(state, "meta")) {
      return { state: releaseShots({ ...state, chord: chordName(state, key) }, "char"), fx: [click("key")] };
    }
    const text = kind.edit === "enter" ? "\n" : "\t";
    return {
      state: releaseShots({ ...commit(state, splice(state, text, false)), chord: key.label }, "char"),
      fx: [click("key")],
    };
  }

  if (kind.t === "edit") {
    return move(state, key, kind.edit);
  }

  if (kind.t === "num") {
    if (!state.numlock) {
      if (kind.nav === "none") {
        return { state: { ...state, chord: key.label }, fx: [click("key")] };
      }
      if (kind.nav === "ins") {
        return {
          state: releaseShots(
            { ...state, overtype: !state.overtype, chord: state.overtype ? "Insert" : "Overwrite" },
            "char",
          ),
          fx: [click("mod")],
        };
      }
      if (kind.nav === "delete") return editDelete(state, key, false);
      return move(state, key, kind.nav);
    }
    return typeChar(state, key, kind.ch);
  }

  if (kind.t === "char") {
    return typeChar(state, key, glyphFor(state, kind.ch, kind.shift));
  }

  return { state, fx: [] };
}

function typeChar(state: EditorState, key: KeySpec, glyph: string): { state: EditorState; fx: Fx[] } {
  const plain = glyph === " " ? " " : glyph.toLowerCase();
  const chord = chordName(state, key);
  if (modOn(state, "ctrl") || modOn(state, "meta")) {
    return command(state, plain, chord);
  }
  if (modOn(state, "alt") || modOn(state, "fn")) {
    return { state: releaseShots({ ...state, chord }, "char"), fx: [click("key")] };
  }
  const next = commit(state, splice(state, glyph, state.overtype));
  return { state: releaseShots({ ...next, chord }, "char"), fx: [click("key")] };
}

function command(
  state: EditorState,
  plain: string,
  chord: string,
): { state: EditorState; fx: Fx[] } {
  const fx: Fx[] = [click("key")];
  if (plain === "z" && modOn(state, "shift")) {
    return { state: releaseShots({ ...redo(state), chord: "Redo" }, "char"), fx };
  }
  if (plain === "z" || plain === "y") {
    const next = plain === "y" ? redo(state) : undo(state);
    return { state: releaseShots(next, "char"), fx };
  }
  if (plain === "a") {
    return {
      state: releaseShots(
        { ...state, anchor: 0, focus: state.value.length, chord: "Select all" },
        "char",
      ),
      fx,
    };
  }
  if (plain === "c") {
    fx.push({ t: "copy", text: selectedText(state) });
    return { state: releaseShots({ ...state, chord: "Copy" }, "char"), fx };
  }
  if (plain === "x") {
    const text = selectedText(state);
    fx.push({ t: "copy", text });
    const next = text ? commit(state, splice(state, "", false)) : state;
    return { state: releaseShots({ ...next, chord: "Cut" }, "char"), fx };
  }
  if (plain === "v") {
    fx.push({ t: "paste" });
    return { state: releaseShots({ ...state, chord: "Paste" }, "char"), fx };
  }
  return { state: releaseShots({ ...state, chord }, "char"), fx };
}

function editDelete(
  state: EditorState,
  key: KeySpec,
  back: boolean,
): { state: EditorState; fx: Fx[] } {
  const { a, b } = bounds(state);
  let anchor = a;
  let focus = b;
  if (a === b) {
    if (back) {
      anchor = modOn(state, "ctrl") ? wordLeft(state.value, a) : Math.max(0, a - 1);
    } else {
      focus = modOn(state, "ctrl") ? wordRight(state.value, b) : Math.min(state.value.length, b + 1);
    }
  }
  if (anchor === focus) {
    return { state: { ...state, chord: key.label }, fx: [click("key")] };
  }
  const value = state.value.slice(0, anchor) + state.value.slice(focus);
  return {
    state: releaseShots(commit(state, { value, anchor, focus: anchor }), "delete"),
    fx: [click("key")],
  };
}

function move(
  state: EditorState,
  key: KeySpec,
  dir: EditName,
): { state: EditorState; fx: Fx[] } {
  const extend = modOn(state, "shift");
  const word = modOn(state, "ctrl");
  const { a, b } = bounds(state);
  let pos = state.focus;
  if (!extend && a !== b && !word && (dir === "left" || dir === "right" || dir === "home" || dir === "end")) {
    pos = dir === "left" || dir === "home" ? a : b;
    return {
      state: releaseShots({ ...state, anchor: pos, focus: pos, chord: key.label }, "nav"),
      fx: [click("key")],
    };
  }
  let next = pos;
  if (dir === "pgup" || dir === "pgdn") {
    const delta = dir === "pgup" ? -1 : 1;
    next = pos;
    for (let i = 0; i < 8; i++) next = vertical(state.value, next, delta);
  } else {
    next = step(state.value, pos, dir, word);
  }
  return {
    state: releaseShots(
      { ...state, anchor: extend ? state.anchor : next, focus: next, chord: key.label },
      "nav",
    ),
    fx: [click("key")],
  };
}

function releaseShots(state: EditorState, kind: "char" | "delete" | "nav" | "fn"): EditorState {
  const sticky = { ...state.sticky };
  const clear = (mod: ModName) => {
    if (sticky[mod] && !modHeld(state, mod)) sticky[mod] = false;
  };
  if (kind === "nav") {
    clear("ctrl");
    clear("alt");
    clear("meta");
    clear("fn");
  } else {
    MODS.forEach(clear);
  }
  return { ...state, sticky };
}

function glyphFor(state: EditorState, ch: string, shiftGlyph: string): string {
  const letter = ch.length === 1 && ch >= "a" && ch <= "z";
  const shift = modOn(state, "shift");
  if (letter) return shift !== state.caps ? shiftGlyph : ch;
  return shift ? shiftGlyph : ch;
}

function chordName(state: EditorState, key: KeySpec): string {
  const parts: string[] = [];
  if (modOn(state, "ctrl")) parts.push("Ctrl");
  if (modOn(state, "alt")) parts.push("Alt");
  if (modOn(state, "meta")) parts.push("Win");
  if (modOn(state, "shift")) parts.push("Shift");
  if (modOn(state, "fn")) parts.push("Fn");
  parts.push(displayName(state, key));
  return parts.join(" + ");
}

function displayName(state: EditorState, key: KeySpec): string {
  if (key.kind.t === "num" && !state.numlock) return key.sub || key.label;
  if (key.kind.t === "fn" && modOn(state, "fn") && key.sub) return key.sub;
  return key.label;
}

function commit(state: EditorState, doc: { value: string; anchor: number; focus: number }): EditorState {
  if (doc.value === state.value && doc.anchor === state.anchor && doc.focus === state.focus) return state;
  return {
    ...state,
    ...doc,
    undo: [snap(state), ...state.undo].slice(0, 100),
    redo: [],
  };
}

function splice(state: EditorState, text: string, overtype: boolean) {
  const { a, b } = bounds(state);
  if (a !== b || !overtype || text.length !== 1 || a >= state.value.length) {
    const value = state.value.slice(0, a) + text + state.value.slice(b);
    const caret = a + text.length;
    return { value, anchor: caret, focus: caret };
  }
  const value = state.value.slice(0, a) + text + state.value.slice(a + text.length);
  const caret = a + text.length;
  return { value, anchor: caret, focus: caret };
}

function bounds(state: EditorState) {
  return {
    a: Math.min(state.anchor, state.focus),
    b: Math.max(state.anchor, state.focus),
  };
}

function snap(state: EditorState): Snap {
  return { value: state.value, anchor: state.anchor, focus: state.focus };
}

function click(tone: "key" | "mod"): Fx {
  return { t: "click", tone };
}

function modLabel(mod: ModName): string {
  if (mod === "meta") return "Win";
  if (mod === "fn") return "Fn";
  if (mod === "ctrl") return "Ctrl";
  if (mod === "alt") return "Alt";
  return "Shift";
}

function step(value: string, pos: number, dir: EditName, word: boolean): number {
  if (dir === "left") return word ? wordLeft(value, pos) : Math.max(0, pos - 1);
  if (dir === "right") return word ? wordRight(value, pos) : Math.min(value.length, pos + 1);
  if (dir === "home") return word ? 0 : lineBounds(value, pos).start;
  if (dir === "end") return word ? value.length : lineBounds(value, pos).end;
  if (dir === "up") return vertical(value, pos, -1);
  if (dir === "down") return vertical(value, pos, 1);
  return pos;
}

function vertical(value: string, pos: number, delta: -1 | 1): number {
  const cur = lineBounds(value, pos);
  if (delta < 0) {
    if (cur.start === 0) return 0;
    const prev = lineBounds(value, cur.start - 1);
    return Math.min(prev.end, prev.start + cur.col);
  }
  if (cur.end >= value.length) return value.length;
  const next = lineBounds(value, cur.end + 1);
  return Math.min(next.end, next.start + cur.col);
}

function lineBounds(value: string, pos: number) {
  const start = value.lastIndexOf("\n", Math.max(0, pos - 1)) + 1;
  const nl = value.indexOf("\n", pos);
  const end = nl === -1 ? value.length : nl;
  return { start, end, col: pos - start };
}

function wordLeft(value: string, pos: number) {
  let i = pos;
  while (i > 0 && /\s/.test(value[i - 1] ?? "")) i--;
  while (i > 0 && !/\s/.test(value[i - 1] ?? "")) i--;
  return i;
}

function wordRight(value: string, pos: number) {
  let i = pos;
  while (i < value.length && !/\s/.test(value[i] ?? "")) i++;
  while (i < value.length && /\s/.test(value[i] ?? "")) i++;
  return i;
}
