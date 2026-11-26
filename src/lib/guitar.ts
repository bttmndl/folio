/** Six strings, high E at the top, twelve frets. Positions are 0–1 in the video frame. */

export type Neck = {
  horizontal: boolean;
  nut: number;
  bridge: number;
  /** Perpendicular coordinate of each string. Index 0 is the high E. */
  strings: number[];
  span: number;
};

export type Pluck = { string: number; midi: number; velocity: number };

export type GuitarPlay = {
  frets: number[];
  touched: number[];
  last: Map<string, { x: number; y: number }>;
  rung: number[];
  vibe: number[];
};

const FRETS = 12;
const OPENS = [64, 59, 55, 50, 45, 40];
const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const SCALE_END = 1 - 2 ** (-FRETS / 12);

export function createGuitarPlay(): GuitarPlay {
  return {
    frets: [0, 0, 0, 0, 0, 0],
    touched: [0, 0, 0, 0, 0, 0],
    last: new Map(),
    rung: [0, 0, 0, 0, 0, 0],
    vibe: [0, 0, 0, 0, 0, 0],
  };
}

export function neckFor(width: number, height: number): Neck {
  const horizontal = width >= height;
  const nut = horizontal ? 0.1 : 0.14;
  const bridge = horizontal ? 0.9 : 0.86;
  const start = 0.2;
  const end = 0.8;
  const strings = Array.from({ length: 6 }, (_, i) => start + ((end - start) * i) / 5);
  return { horizontal, nut, bridge, strings, span: (end - start) / 5 };
}

export function fretAt(t: number): number {
  if (t <= 0.02) return 0;
  if (t >= 0.98) return FRETS;
  let best = 0;
  for (let fret = 1; fret <= FRETS; fret++) {
    const prev = fret === 1 ? 0 : (1 - 2 ** (-(fret - 1) / 12)) / SCALE_END;
    const at = (1 - 2 ** (-fret / 12)) / SCALE_END;
    if (t >= (prev + at) / 2) best = fret;
  }
  return best;
}

export function chordLabel(frets: number[]): string {
  const pcs = [...new Set(frets.map((fret, i) => (OPENS[i]! + fret) % 12))].sort((a, b) => a - b);
  for (const root of pcs) {
    const rel = new Set(pcs.map((p) => (p - root + 12) % 12));
    const has = (n: number) => rel.has(n);
    if (has(0) && has(4) && has(7) && rel.size <= 4) return NAMES[root] ?? "";
    if (has(0) && has(3) && has(7) && rel.size <= 4) return `${NAMES[root] ?? ""}m`;
  }
  return pcs.map((p) => NAMES[p] ?? "").join(" ");
}

export function midiFor(stringIndex: number, fret: number): number {
  return OPENS[stringIndex]! + fret;
}

type Point = { x: number; y: number };

function along(neck: Neck, p: Point): number {
  return neck.horizontal ? (p.x - neck.nut) / (neck.bridge - neck.nut) : (p.y - neck.nut) / (neck.bridge - neck.nut);
}

function across(neck: Neck, p: Point): number {
  return neck.horizontal ? p.y : p.x;
}

function nearestString(neck: Neck, p: Point): number | null {
  const c = across(neck, p);
  let best = 0;
  let dist = Infinity;
  neck.strings.forEach((at, i) => {
    const d = Math.abs(c - at);
    if (d < dist) {
      dist = d;
      best = i;
    }
  });
  return dist <= neck.span * 0.62 ? best : null;
}

function crosses(neck: Neck, a: Point, b: Point, stringAt: number): boolean {
  const aSide = across(neck, a) - stringAt;
  const bSide = across(neck, b) - stringAt;
  if (aSide === 0 || bSide === 0 || aSide * bSide > 0) return false;
  const t = aSide / (aSide - bSide);
  const hit = neck.horizontal ? a.x + (b.x - a.x) * t : a.y + (b.y - a.y) * t;
  return hit >= Math.min(neck.nut, neck.bridge) - 0.02 && hit <= Math.max(neck.nut, neck.bridge) + 0.02;
}

const TIPS = [4, 8, 12, 16, 20];

export function updateGuitar(play: GuitarPlay, hands: Point[][], width: number, height: number, now: number): Pluck[] {
  const neck = neckFor(width, height);
  const seen = new Set<string>();
  const plucks: Pluck[] = [];

  hands.forEach((hand, hi) => {
    for (const tipIndex of TIPS) {
      const tip = hand[tipIndex];
      if (!tip) continue;
      const id = `${hi}:t${tipIndex}`;
      seen.add(id);
      const prev = play.last.get(id);
      play.last.set(id, { x: tip.x, y: tip.y });
      const speed = prev ? Math.hypot(tip.x - prev.x, tip.y - prev.y) : 0;
      const stringIndex = nearestString(neck, tip);
      const t = along(neck, tip);
      if (stringIndex !== null && speed < 0.03 && t >= -0.02 && t <= 1.05) {
        play.frets[stringIndex] = fretAt(Math.min(1, Math.max(0, t)));
        play.touched[stringIndex] = now;
      }
      if (prev && speed > 0.012) pluckCrossings(play, neck, prev, tip, speed, now, plucks);
    }
    const wrist = hand[0];
    if (!wrist) return;
    const id = `${hi}:w`;
    seen.add(id);
    const prev = play.last.get(id);
    play.last.set(id, { x: wrist.x, y: wrist.y });
    const speed = prev ? Math.hypot(wrist.x - prev.x, wrist.y - prev.y) : 0;
    if (prev && speed > 0.01) pluckCrossings(play, neck, prev, wrist, speed, now, plucks);
  });

  for (const id of play.last.keys()) if (!seen.has(id)) play.last.delete(id);
  for (let i = 0; i < 6; i++) {
    if (now - play.touched[i]! > 180) play.frets[i] = 0;
    play.vibe[i] = Math.max(0, play.vibe[i]! * 0.9);
  }
  return plucks;
}

function pluckCrossings(play: GuitarPlay, neck: Neck, a: Point, b: Point, speed: number, now: number, plucks: Pluck[]) {
  neck.strings.forEach((at, stringIndex) => {
    if (!crosses(neck, a, b, at)) return;
    if (now - play.rung[stringIndex]! < 70) return;
    play.rung[stringIndex] = now;
    play.vibe[stringIndex] = 1;
    const velocity = Math.max(0.35, Math.min(1, speed * 18));
    plucks.push({ string: stringIndex, midi: midiFor(stringIndex, play.frets[stringIndex] ?? 0), velocity });
  });
}

export function drawGuitar(
  g: CanvasRenderingContext2D,
  play: GuitarPlay,
  width: number,
  height: number,
  time: number,
) {
  const neck = neckFor(width, height);
  const x0 = neck.horizontal ? neck.nut * width : neck.strings[0]! * width - neck.span * width * 1.4;
  const y0 = neck.horizontal ? neck.strings[0]! * height - neck.span * height * 1.4 : neck.nut * height;
  const x1 = neck.horizontal ? neck.bridge * width : neck.strings[5]! * width + neck.span * width * 1.4;
  const y1 = neck.horizontal ? neck.strings[5]! * height + neck.span * height * 1.4 : neck.bridge * height;

  g.save();
  g.fillStyle = "rgba(62, 36, 18, 0.72)";
  g.beginPath();
  g.roundRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0), 18);
  g.fill();

  for (let fret = 0; fret <= FRETS; fret++) {
    const t = fret === 0 ? 0 : (1 - 2 ** (-fret / 12)) / SCALE_END;
    const at = neck.nut + (neck.bridge - neck.nut) * t;
    g.strokeStyle = fret === 0 ? "rgba(243,239,228,0.9)" : "rgba(224,154,62,0.55)";
    g.lineWidth = fret === 0 ? 4 : 1.5;
    g.beginPath();
    if (neck.horizontal) {
      g.moveTo(at * width, y0);
      g.lineTo(at * width, y1);
    } else {
      g.moveTo(x0, at * height);
      g.lineTo(x1, at * height);
    }
    g.stroke();
  }

  for (const fret of [3, 5, 7, 9, 12]) {
    const t = (1 - 2 ** (-fret / 12)) / SCALE_END;
    const prev = (1 - 2 ** (-(fret - 1) / 12)) / SCALE_END;
    const at = neck.nut + (neck.bridge - neck.nut) * ((t + prev) / 2);
    g.fillStyle = "rgba(243,239,228,0.45)";
    const dots = fret === 12 ? [-0.18, 0.18] : [0];
    for (const d of dots) {
      const acrossAt = (neck.strings[2]! + neck.strings[3]!) / 2 + d * (neck.strings[5]! - neck.strings[0]!);
      const cx = neck.horizontal ? at * width : acrossAt * width;
      const cy = neck.horizontal ? acrossAt * height : at * height;
      g.beginPath();
      g.arc(cx, cy, Math.max(4, width / 140), 0, Math.PI * 2);
      g.fill();
    }
  }

  neck.strings.forEach((at, i) => {
    const amp = play.vibe[i]! * (6 + i);
    const wave = Math.sin(time / 40 + i) * amp;
    g.strokeStyle = i < 3 ? "rgba(230, 196, 122, 0.95)" : "rgba(243,239,228,0.92)";
    g.lineWidth = 1.2 + (5 - i) * 0.35;
    g.beginPath();
    const steps = 16;
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const wobble = Math.sin(u * Math.PI) * wave;
      const ax = neck.horizontal ? (neck.nut + (neck.bridge - neck.nut) * u) * width : at * width + wobble;
      const ay = neck.horizontal ? at * height + wobble : (neck.nut + (neck.bridge - neck.nut) * u) * height;
      if (s === 0) g.moveTo(ax, ay);
      else g.lineTo(ax, ay);
    }
    g.stroke();

    if (play.frets[i]) {
      const t = (1 - 2 ** (-(play.frets[i]! - 0.5) / 12)) / SCALE_END;
      const alongAt = neck.nut + (neck.bridge - neck.nut) * t;
      const cx = neck.horizontal ? alongAt * width : at * width;
      const cy = neck.horizontal ? at * height : alongAt * height;
      g.fillStyle = "rgba(224,154,62,0.95)";
      g.beginPath();
      g.arc(cx, cy, Math.max(8, width / 70), 0, Math.PI * 2);
      g.fill();
    }
  });
  g.restore();
}
