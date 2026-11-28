/** Two-octave piano. Pinch to place it, double-tap to lock, then play on top. */

export type Point = { x: number; y: number; z?: number };

export type Hand = { points: Point[] };

export type PianoNote = { midi: number; velocity: number };

export type PianoPlay = {
  /** Center and width as a fraction of the visible screen, so rotation keeps it put. */
  cx: number;
  cy: number;
  span: number;
  ready: boolean;
  locked: boolean;
  seen: number;
  last: Map<string, Point>;
  held: Map<string, number>;
  down: Set<number>;
  aimed: Set<number>;
  aim: Map<string, number>;
  aimAt: Map<string, number>;
  tap: { t: number; x: number; y: number } | null;
  pinch: { dist: number; span: number } | null;
};

const START = 48;
const WHITES = 15;
const STEPS = [0, 2, 4, 5, 7, 9, 11];
const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const TIPS = [8, 12, 16];

export function createPianoPlay(): PianoPlay {
  return {
    cx: 0.5,
    cy: 0.62,
    span: 0.86,
    ready: false,
    locked: false,
    seen: 0,
    last: new Map(),
    held: new Map(),
    down: new Set(),
    aimed: new Set(),
    aim: new Map(),
    aimAt: new Map(),
    tap: null,
    pinch: null,
  };
}

export function whiteMidi(index: number): number {
  const oct = Math.floor(index / 7);
  return START + oct * 12 + STEPS[index % 7]!;
}

export function noteName(midi: number): string {
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

function hasBlack(index: number): boolean {
  const step = index % 7;
  return step !== 2 && step !== 6 && index < WHITES - 1;
}

type View = { left: number; top: number; width: number; height: number };

/** The part of the camera frame actually visible on the phone, including after rotation. */
export function visibleFrame(videoW: number, videoH: number, screenW: number, screenH: number): View {
  const boxW = screenW > 0 ? screenW : videoW;
  const boxH = screenH > 0 ? screenH : videoH;
  const scale = Math.max(boxW / videoW, boxH / videoH);
  const width = boxW / scale;
  const height = boxH / scale;
  return {
    left: (videoW - width) / 2,
    top: (videoH - height) / 2,
    width,
    height,
  };
}

export function toScreen(p: Point, videoW: number, videoH: number, screenW: number, screenH: number): Point {
  const view = visibleFrame(videoW, videoH, screenW, screenH);
  return {
    x: (p.x * videoW - view.left) / view.width,
    y: (p.y * videoH - view.top) / view.height,
    z: p.z,
  };
}

export type Board = { left: number; top: number; width: number; height: number; angle: number };

export function boardOf(play: PianoPlay, videoW: number, videoH: number, screenW: number, screenH: number): Board {
  const view = visibleFrame(videoW, videoH, screenW, screenH);
  const span = Math.min(1.15, Math.max(0.34, play.span));
  const along = span * view.width;
  const width = along;
  const height = along * 0.32;
  const cx = view.left + play.cx * view.width;
  const cy = view.top + play.cy * view.height;
  return { left: cx - width / 2, top: cy - height / 2, width, height, angle: 0 };
}

function localPoint(board: Board, x: number, y: number): Point {
  const cx = board.left + board.width / 2;
  const cy = board.top + board.height / 2;
  const dx = x - cx;
  const dy = y - cy;
  const c = Math.cos(-board.angle);
  const s = Math.sin(-board.angle);
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  const along = board.angle === 0 ? board.width : board.height;
  const across = board.angle === 0 ? board.height : board.width;
  return { x: lx / along + 0.5, y: ly / across + 0.5 };
}

export function keyAt(board: Board, x: number, y: number): number | null {
  const p = localPoint(board, x, y);
  if (p.x < 0 || p.y < 0 || p.x > 1 || p.y > 1) return null;
  const whiteW = 1 / WHITES;
  if (p.y < 0.63) {
    for (let i = 0; i < WHITES - 1; i++) {
      if (!hasBlack(i)) continue;
      const boundary = (i + 1) * whiteW;
      if (Math.abs(p.x - boundary) <= whiteW * 0.3) return whiteMidi(i) + 1;
    }
  }
  const index = Math.min(WHITES - 1, Math.max(0, Math.floor(p.x * WHITES)));
  return whiteMidi(index);
}

function committedKey(board: Board, x: number, y: number, previous: number | undefined): number | null {
  const raw = keyAt(board, x, y);
  if (raw == null || previous == null || previous === raw) return raw;
  const u = localPoint(board, x, y).x;
  const whiteW = 1 / WHITES;
  const center = keyCenter(raw);
  const half = isBlack(raw) ? whiteW * 0.3 : whiteW * 0.5;
  return Math.abs(u - center) < half * 0.45 ? raw : previous;
}

function isBlack(midi: number): boolean {
  const pc = midi % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

function keyCenter(midi: number): number {
  const whiteW = 1 / WHITES;
  for (let i = 0; i < WHITES; i++) {
    if (whiteMidi(i) === midi) return (i + 0.5) * whiteW;
    if (hasBlack(i) && whiteMidi(i) + 1 === midi) return (i + 1) * whiteW;
  }
  return 0.5;
}

function handAnchor(hand: Hand): Point | null {
  return hand.points[8] ?? hand.points[0] ?? null;
}

export function updatePiano(
  play: PianoPlay,
  hands: Hand[],
  now: number,
  videoW: number,
  videoH: number,
  screenW = videoW,
  screenH = videoH,
): PianoNote[] {
  const notes: PianoNote[] = [];
  const anchors = hands.map(handAnchor).filter((p): p is Point => !!p);
  if (!anchors.length) {
    play.pinch = null;
    if (now - play.seen > 800 && !play.locked) play.ready = false;
    return notes;
  }
  play.ready = true;
  play.seen = now;
  const screen = anchors.map((p) => toScreen(p, videoW, videoH, screenW, screenH));

  if (!play.locked && screen.length >= 2) {
    const a = screen[0]!;
    const b = screen[1]!;
    const dist = Math.hypot((a.x - b.x) * screenW, (a.y - b.y) * screenH);
    if (!play.pinch || dist < 8) play.pinch = { dist: Math.max(dist, 8), span: play.span };
    play.span = Math.min(1.15, Math.max(0.34, play.pinch.span * (dist / play.pinch.dist)));
    play.cx = Math.min(0.92, Math.max(0.08, (a.x + b.x) / 2));
    play.cy = Math.min(0.9, Math.max(0.12, (a.y + b.y) / 2));
  } else if (!play.locked) {
    play.pinch = null;
    const p = screen[0]!;
    const glide = 0.42;
    play.cx = Math.min(0.92, Math.max(0.08, play.cx * (1 - glide) + p.x * glide));
    play.cy = Math.min(0.9, Math.max(0.12, play.cy * (1 - glide) + p.y * glide));
  } else {
    play.pinch = null;
  }

  const board = boardOf(play, videoW, videoH, screenW, screenH);
  const seen = new Set<string>();
  play.down = new Set();
  play.aimed = new Set();

  hands.forEach((hand, hi) => {
    const indexTip = hand.points[8];
    if (indexTip && hands.length < 2) {
      const id = `${hi}:8`;
      const prev = play.last.get(id);
      const here = toScreen(indexTip, videoW, videoH, screenW, screenH);
      const dy = prev ? (here.y - toScreen(prev, videoW, videoH, screenW, screenH).y) * screenH : 0;
      if (prev && dy > 14) {
        const px = here.x * screenW;
        const py = here.y * screenH;
        if (
          play.tap &&
          !play.locked &&
          now - play.tap.t > 70 &&
          now - play.tap.t < 450 &&
          Math.hypot(px - play.tap.x, py - play.tap.y) < 90
        ) {
          play.locked = true;
          play.tap = null;
          play.held.clear();
          play.pinch = null;
        } else if (!play.tap || now - play.tap.t > 450) {
          play.tap = { t: now, x: px, y: py };
        }
      }
    }

    for (const tipIndex of TIPS) {
      const point = hand.points[tipIndex];
      if (!point) continue;
      const id = `${hi}:${tipIndex}`;
      seen.add(id);
      const prev = play.last.get(id);
      play.last.set(id, point);
      if (!play.locked) continue;
      const filtered = prev
        ? { x: prev.x * 0.6 + point.x * 0.4, y: prev.y * 0.6 + point.y * 0.4 }
        : point;
      const prevScreen = prev ? toScreen(prev, videoW, videoH, screenW, screenH) : null;
      const here = toScreen(point, videoW, videoH, screenW, screenH);
      const midi = committedKey(board, filtered.x * videoW, filtered.y * videoH, play.aim.get(id));
      const dy = prevScreen ? (here.y - prevScreen.y) * screenH : 0;
      const dx = prevScreen ? (here.x - prevScreen.x) * screenW : 0;
      const was = play.held.get(id);
      if (midi == null) {
        play.aim.delete(id);
        play.aimAt.delete(id);
        play.held.delete(id);
        continue;
      }
      if (play.aim.get(id) !== midi) {
        play.aim.set(id, midi);
        play.aimAt.set(id, now);
      }
      play.aimed.add(midi);
      if (was === midi) {
        play.down.add(midi);
        if (dy < -12) play.held.delete(id);
        continue;
      }
      const stableFor = now - (play.aimAt.get(id) ?? now);
      const cameDown = prevScreen != null && dy > 16 && dy > Math.abs(dx) * 1.25;
      const freshStrike = was == null && dy > 28 && dy > Math.abs(dx);
      if (cameDown && (stableFor >= 60 || freshStrike)) {
        play.held.set(id, midi);
        play.down.add(midi);
        notes.push({ midi, velocity: Math.max(0.55, Math.min(1, dy / 36)) });
      }
    }
  });

  for (const id of play.last.keys()) if (!seen.has(id)) play.last.delete(id);
  for (const id of [...play.held.keys(), ...play.aim.keys()]) {
    if (!seen.has(id)) {
      play.held.delete(id);
      play.aim.delete(id);
      play.aimAt.delete(id);
    }
  }
  return notes;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  g.beginPath();
  g.rect(x, y, w, h);
}

export function drawPiano(
  g: CanvasRenderingContext2D,
  play: PianoPlay,
  videoW: number,
  videoH: number,
  screenW = videoW,
  screenH = videoH,
) {
  if (!play.ready) return;
  const board = boardOf(play, videoW, videoH, screenW, screenH);
  const along = board.angle === 0 ? board.width : board.height;
  const across = board.angle === 0 ? board.height : board.width;
  const whiteW = along / WHITES;
  g.save();
  g.translate(board.left + board.width / 2, board.top + board.height / 2);
  g.rotate(board.angle);
  g.shadowColor = "rgba(0,0,0,0.45)";
  g.shadowBlur = 24;
  g.shadowOffsetY = 16;
  g.fillStyle = play.locked ? "#1a120c" : "#3a2a18";
  roundRect(g, -along / 2 - 8, -across / 2 - 8, along + 16, across + 18);
  g.fill();
  g.shadowColor = "transparent";

  for (let i = 0; i < WHITES; i++) {
    const midi = whiteMidi(i);
    const pressed = play.down.has(midi);
    const x = -along / 2 + i * whiteW;
    const y = -across / 2 + (pressed ? 7 : 0);
    const aimed = play.aimed.has(midi) && !pressed;
    const grad = g.createLinearGradient(x, y, x, y + across);
    grad.addColorStop(0, pressed ? "#d9d0c2" : aimed ? "#fff6df" : "#f4efe6");
    grad.addColorStop(1, pressed ? "#b7aa98" : aimed ? "#f0e0bc" : "#e4d9c8");
    g.fillStyle = grad;
    g.fillRect(x + 1, y, whiteW - 2, across - (pressed ? 7 : 0));
    g.strokeStyle = "rgba(70, 54, 40, 0.35)";
    g.strokeRect(x + 1, y, whiteW - 2, across - (pressed ? 7 : 0));
  }

  for (let i = 0; i < WHITES - 1; i++) {
    if (!hasBlack(i)) continue;
    const midi = whiteMidi(i) + 1;
    const pressed = play.down.has(midi);
    const x = -along / 2 + (i + 1) * whiteW - whiteW * 0.3;
    const y = -across / 2 + (pressed ? 5 : 0);
    const w = whiteW * 0.6;
    const h = across * 0.62;
    const grad = g.createLinearGradient(x, y, x + w, y);
    grad.addColorStop(0, "#2a2a2a");
    grad.addColorStop(0.5, pressed ? "#111" : "#3a3a3a");
    grad.addColorStop(1, "#0c0c0c");
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
  }

  if (!play.locked) {
    g.strokeStyle = "rgba(212, 168, 74, 0.95)";
    g.lineWidth = 4;
    g.setLineDash([14, 10]);
    g.strokeRect(-along / 2 - 6, -across / 2 - 6, along + 12, across + 12);
    g.setLineDash([]);
  }
  g.restore();
}
