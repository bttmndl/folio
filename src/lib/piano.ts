/** Two-octave piano that sits under the hands. A fingertip press plays the key. */

export type Point = { x: number; y: number; z?: number };

export type Hand = { points: Point[] };

export type PianoNote = { midi: number; velocity: number };

export type PianoPlay = {
  cx: number;
  cy: number;
  span: number;
  ready: boolean;
  seen: number;
  last: Map<string, Point>;
  held: Map<string, number>;
  down: Set<number>;
};

const START = 48;
const WHITES = 15;
const STEPS = [0, 2, 4, 5, 7, 9, 11];
const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const TIPS = [8, 12, 16, 20];

export function createPianoPlay(): PianoPlay {
  return {
    cx: 0.5,
    cy: 0.62,
    span: 0.78,
    ready: false,
    seen: 0,
    last: new Map(),
    held: new Map(),
    down: new Set(),
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

export type Board = { left: number; top: number; width: number; height: number };

export function boardOf(play: PianoPlay, viewW: number, viewH: number): Board {
  const width = Math.min(viewW * 0.96, Math.max(viewW * 0.46, play.span * viewW));
  const height = width * 0.32;
  return {
    left: play.cx * viewW - width / 2,
    top: play.cy * viewH - height * 0.62,
    width,
    height,
  };
}

export function keyAt(board: Board, x: number, y: number): number | null {
  if (x < board.left || y < board.top || x > board.left + board.width || y > board.top + board.height) return null;
  const u = (x - board.left) / board.width;
  const v = (y - board.top) / board.height;
  const whiteW = 1 / WHITES;
  if (v < 0.63) {
    for (let i = 0; i < WHITES - 1; i++) {
      if (!hasBlack(i)) continue;
      const boundary = (i + 1) * whiteW;
      if (Math.abs(u - boundary) <= whiteW * 0.3) return whiteMidi(i) + 1;
    }
  }
  const index = Math.min(WHITES - 1, Math.max(0, Math.floor(u * WHITES)));
  return whiteMidi(index);
}

function avg(points: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

export function updatePiano(play: PianoPlay, hands: Hand[], now: number, viewW: number, viewH: number): PianoNote[] {
  const notes: PianoNote[] = [];
  const wrists = hands.map((hand) => hand.points[0]).filter((p): p is Point => !!p);
  const tips = hands.flatMap((hand) => TIPS.map((i) => hand.points[i])).filter((p): p is Point => !!p);
  if (!wrists.length && !tips.length) {
    if (now - play.seen > 800) play.ready = false;
    return notes;
  }
  const wrist = avg(wrists.length ? wrists : tips);
  const tip = avg(tips.length ? tips : wrists);
  const xs = (tips.length ? tips : wrists).map((p) => p.x);
  const span = Math.min(0.96, Math.max(0.55, (Math.max(...xs) - Math.min(...xs)) * 2.4 || play.span));
  const a = play.ready ? 0.1 : 1;
  play.cx = play.cx * (1 - a) + wrist.x * a;
  play.cy = play.cy * (1 - a) + tip.y * a;
  play.span = play.span * (1 - a) + span * a;
  play.ready = true;
  play.seen = now;

  const board = boardOf(play, viewW, viewH);
  const seen = new Set<string>();
  play.down = new Set();

  hands.forEach((hand, hi) => {
    for (const tipIndex of TIPS) {
      const point = hand.points[tipIndex];
      if (!point) continue;
      const id = `${hi}:${tipIndex}`;
      seen.add(id);
      const prev = play.last.get(id);
      play.last.set(id, point);
      const midi = keyAt(board, point.x * viewW, point.y * viewH);
      const dy = prev ? (point.y - prev.y) * viewH : 0;
      const dx = prev ? (point.x - prev.x) * viewW : 0;
      const dz = prev ? (point.z ?? 0) - (prev.z ?? 0) : 0;
      const was = play.held.get(id);
      if (midi == null) {
        play.held.delete(id);
        continue;
      }
      play.down.add(midi);
      const pressing = !!prev && (dy > 3 || dz > 0.01 || (was !== midi && Math.hypot(dx, dy) > 8));
      if (was !== midi && pressing) {
        play.held.set(id, midi);
        notes.push({ midi, velocity: Math.max(0.5, Math.min(1, Math.abs(dy) / 16 + 0.5)) });
      } else if (was === midi) {
        play.held.set(id, midi);
      }
    }
  });

  for (const id of play.last.keys()) if (!seen.has(id)) play.last.delete(id);
  for (const id of play.held.keys()) if (!seen.has(id)) play.held.delete(id);
  return notes;
}

export function drawPiano(g: CanvasRenderingContext2D, play: PianoPlay, viewW: number, viewH: number) {
  if (!play.ready) return;
  const board = boardOf(play, viewW, viewH);
  const whiteW = board.width / WHITES;
  g.save();
  g.shadowColor = "rgba(0,0,0,0.45)";
  g.shadowBlur = 24;
  g.shadowOffsetY = 16;
  g.fillStyle = "#1a120c";
  g.fillRect(board.left - 8, board.top - 8, board.width + 16, board.height + 18);
  g.shadowColor = "transparent";

  for (let i = 0; i < WHITES; i++) {
    const midi = whiteMidi(i);
    const pressed = play.down.has(midi);
    const x = board.left + i * whiteW;
    const y = board.top + (pressed ? 7 : 0);
    const grad = g.createLinearGradient(x, y, x, y + board.height);
    grad.addColorStop(0, pressed ? "#d9d0c2" : "#f4efe6");
    grad.addColorStop(1, pressed ? "#b7aa98" : "#e4d9c8");
    g.fillStyle = grad;
    g.fillRect(x + 1, y, whiteW - 2, board.height - (pressed ? 7 : 0));
    g.strokeStyle = "rgba(70, 54, 40, 0.35)";
    g.strokeRect(x + 1, y, whiteW - 2, board.height - (pressed ? 7 : 0));
  }

  for (let i = 0; i < WHITES - 1; i++) {
    if (!hasBlack(i)) continue;
    const midi = whiteMidi(i) + 1;
    const pressed = play.down.has(midi);
    const x = board.left + (i + 1) * whiteW - whiteW * 0.3;
    const y = board.top + (pressed ? 5 : 0);
    const w = whiteW * 0.6;
    const h = board.height * 0.62;
    const grad = g.createLinearGradient(x, y, x + w, y);
    grad.addColorStop(0, "#2a2a2a");
    grad.addColorStop(0.5, pressed ? "#111" : "#3a3a3a");
    grad.addColorStop(1, "#0c0c0c");
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
  }
  g.restore();
}
