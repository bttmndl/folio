/** A right-handed acoustic guitar. Low E is the top string, the way it sits in your hands. */

export type Geom = {
  /** +1: neck on the left of the video. -1: neck on the right, so a mirrored preview shows the neck on the left. */
  dir: 1 | -1;
  head: number;
  nut: number;
  joint: number;
  bridge: number;
  tail: number;
  /** Low E first. */
  strings: number[];
  span: number;
  mid: number;
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
const OPENS = [40, 45, 50, 55, 59, 64];
const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const SCALE_END = 1 - 2 ** (-FRETS / 12);
const TIPS = [8, 12, 16, 20];

export function createGuitarPlay(): GuitarPlay {
  return {
    frets: [0, 0, 0, 0, 0, 0],
    touched: [0, 0, 0, 0, 0, 0],
    last: new Map(),
    rung: [0, 0, 0, 0, 0, 0],
    vibe: [0, 0, 0, 0, 0, 0],
  };
}

export function guitarGeom(mirrored: boolean): Geom {
  const dir: 1 | -1 = mirrored ? -1 : 1;
  const strings = [0, 1, 2, 3, 4, 5].map((i) => 0.36 + (0.28 * i) / 5);
  if (mirrored) {
    return { dir, head: 0.94, nut: 0.8, joint: 0.5, bridge: 0.26, tail: 0.07, strings, span: 0.28 / 5, mid: 0.5 };
  }
  return { dir, head: 0.06, nut: 0.2, joint: 0.5, bridge: 0.74, tail: 0.93, strings, span: 0.28 / 5, mid: 0.5 };
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

function along(g: Geom, p: Point): number {
  return (p.x - g.nut) / (g.bridge - g.nut);
}

function nearestString(g: Geom, p: Point): number | null {
  let best = 0;
  let dist = Infinity;
  g.strings.forEach((at, i) => {
    const d = Math.abs(p.y - at);
    if (d < dist) {
      dist = d;
      best = i;
    }
  });
  return dist <= g.span * 0.7 ? best : null;
}

export function updateGuitar(
  play: GuitarPlay,
  hands: Point[][],
  _width: number,
  _height: number,
  now: number,
  mirrored: boolean,
): Pluck[] {
  const g = guitarGeom(mirrored);
  const jointT = (g.joint - g.nut) / (g.bridge - g.nut);
  const seen = new Set<string>();
  const plucks: Pluck[] = [];
  const ranked = hands.filter((hand) => hand[0]).sort((a, b) => along(g, a[0]!) - along(g, b[0]!));
  const fretHand = ranked[0];
  const strumHand = ranked.length > 1 ? ranked[ranked.length - 1] : ranked[0];

  const track = (id: string, p: Point) => {
    seen.add(id);
    const prev = play.last.get(id);
    play.last.set(id, { x: p.x, y: p.y });
    return prev ? Math.hypot(p.x - prev.x, p.y - prev.y) : 0;
  };

  if (fretHand && along(g, fretHand[0]!) < jointT + 0.08) {
    for (const tipIndex of TIPS) {
      const tip = fretHand[tipIndex];
      if (!tip) continue;
      const hi = hands.indexOf(fretHand);
      const speed = track(`${hi}:t${tipIndex}`, tip);
      const t = along(g, tip);
      const stringIndex = nearestString(g, tip);
      if (stringIndex !== null && speed < 0.04 && t >= -0.02 && t <= jointT + 0.02) {
        play.frets[stringIndex] = fretAt(Math.min(1, Math.max(0, t / jointT)));
        play.touched[stringIndex] = now;
      }
    }
  }

  if (strumHand && (ranked.length === 1 ? along(g, strumHand[0]!) > jointT : true)) {
    const hi = hands.indexOf(strumHand);
    const points: { id: string; p: Point }[] = [];
    const wrist = strumHand[0];
    if (wrist) points.push({ id: `${hi}:w`, p: wrist });
    for (const tipIndex of [4, 8, 12, 16, 20]) {
      const tip = strumHand[tipIndex];
      if (tip) points.push({ id: `${hi}:s${tipIndex}`, p: tip });
    }
    for (const point of points) {
      const prev = play.last.get(point.id);
      const speed = track(point.id, point.p);
      if (prev && speed > 0.008) pluckCrossings(play, g, prev, point.p, speed, now, plucks, jointT);
    }
  }

  for (const id of play.last.keys()) if (!seen.has(id)) play.last.delete(id);
  for (let i = 0; i < 6; i++) {
    if (now - play.touched[i]! > 360) play.frets[i] = 0;
    play.vibe[i] = Math.max(0, play.vibe[i]! * 0.9);
  }
  return plucks;
}

function pluckCrossings(
  play: GuitarPlay,
  g: Geom,
  a: Point,
  b: Point,
  speed: number,
  now: number,
  plucks: Pluck[],
  jointT: number,
) {
  g.strings.forEach((at, stringIndex) => {
    if ((a.y - at) * (b.y - at) >= 0) return;
    const t = (at - a.y) / (b.y - a.y);
    const x = a.x + (b.x - a.x) * t;
    const alongT = (x - g.nut) / (g.bridge - g.nut);
    if (alongT < jointT + 0.04 || alongT > 1.02) return;
    if (now - play.rung[stringIndex]! < 80) return;
    play.rung[stringIndex] = now;
    play.vibe[stringIndex] = 1;
    plucks.push({
      string: stringIndex,
      midi: midiFor(stringIndex, play.frets[stringIndex] ?? 0),
      velocity: Math.max(0.4, Math.min(1, speed * 16)),
    });
  });
}

export function drawGuitar(
  g: CanvasRenderingContext2D,
  play: GuitarPlay,
  width: number,
  height: number,
  time: number,
  mirrored: boolean,
) {
  const geom = guitarGeom(mirrored);
  const X = (x: number) => x * width;
  const Y = (y: number) => y * height;
  const bodyT = (t: number) => geom.joint + (geom.tail - geom.joint) * t;
  const mid = geom.mid;

  g.save();
  const body = new Path2D();
  body.moveTo(X(bodyT(0.02)), Y(mid - 0.055));
  body.bezierCurveTo(X(bodyT(0.16)), Y(mid - 0.2), X(bodyT(0.34)), Y(mid - 0.16), X(bodyT(0.4)), Y(mid - 0.09));
  body.bezierCurveTo(X(bodyT(0.5)), Y(mid - 0.12), X(bodyT(0.66)), Y(mid - 0.23), X(bodyT(0.86)), Y(mid - 0.16));
  body.bezierCurveTo(X(bodyT(1.02)), Y(mid - 0.05), X(bodyT(1.02)), Y(mid + 0.05), X(bodyT(0.86)), Y(mid + 0.16));
  body.bezierCurveTo(X(bodyT(0.66)), Y(mid + 0.23), X(bodyT(0.5)), Y(mid + 0.13), X(bodyT(0.4)), Y(mid + 0.1));
  body.bezierCurveTo(X(bodyT(0.34)), Y(mid + 0.17), X(bodyT(0.16)), Y(mid + 0.18), X(bodyT(0.02)), Y(mid + 0.055));
  body.closePath();

  const wood = g.createLinearGradient(X(geom.head), Y(mid), X(geom.tail), Y(mid));
  wood.addColorStop(0, "rgba(92, 58, 32, 0.55)");
  wood.addColorStop(0.45, "rgba(214, 176, 112, 0.78)");
  wood.addColorStop(1, "rgba(168, 122, 62, 0.82)");
  g.fillStyle = wood;
  g.fill(body);
  g.strokeStyle = "rgba(42, 24, 12, 0.85)";
  g.lineWidth = 3;
  g.stroke(body);

  const guard = new Path2D();
  guard.moveTo(X(bodyT(0.48)), Y(mid + 0.02));
  guard.bezierCurveTo(X(bodyT(0.62)), Y(mid + 0.16), X(bodyT(0.84)), Y(mid + 0.14), X(bodyT(0.72)), Y(mid + 0.01));
  guard.closePath();
  g.fillStyle = "rgba(48, 28, 16, 0.45)";
  g.fill(guard);

  const holeX = X(bodyT(0.58));
  const holeY = Y(mid);
  const holeR = Math.min(width, height) * 0.062;
  g.beginPath();
  g.arc(holeX, holeY, holeR * 1.18, 0, Math.PI * 2);
  g.strokeStyle = "rgba(120, 72, 36, 0.9)";
  g.lineWidth = 7;
  g.stroke();
  g.beginPath();
  g.arc(holeX, holeY, holeR, 0, Math.PI * 2);
  g.fillStyle = "rgba(12, 8, 6, 0.88)";
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = "rgba(224, 186, 120, 0.8)";
  g.stroke();

  const neckTop = Y(geom.strings[0]! - geom.span * 1.15);
  const neckBot = Y(geom.strings[5]! + geom.span * 1.15);
  g.fillStyle = "rgba(120, 78, 42, 0.8)";
  g.fillRect(Math.min(X(geom.head), X(geom.joint)), neckTop - 8, Math.abs(X(geom.joint) - X(geom.head)), neckBot - neckTop + 16);

  const boardTop = Y(geom.strings[0]! - geom.span * 0.85);
  const boardBot = Y(geom.strings[5]! + geom.span * 0.85);
  g.fillStyle = "rgba(46, 28, 18, 0.9)";
  g.fillRect(Math.min(X(geom.nut), X(geom.joint)), boardTop, Math.abs(X(geom.joint) - X(geom.nut)), boardBot - boardTop);

  g.strokeStyle = "rgba(236, 224, 196, 0.95)";
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(X(geom.nut), boardTop);
  g.lineTo(X(geom.nut), boardBot);
  g.stroke();

  for (let fret = 1; fret <= FRETS; fret++) {
    const t = (1 - 2 ** (-fret / 12)) / SCALE_END;
    const x = geom.nut + (geom.joint - geom.nut) * t;
    g.strokeStyle = "rgba(214, 196, 160, 0.75)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(X(x), boardTop);
    g.lineTo(X(x), boardBot);
    g.stroke();
  }

  for (const fret of [3, 5, 7, 9, 12]) {
    const t = (1 - 2 ** (-fret / 12)) / SCALE_END;
    const prev = (1 - 2 ** (-(fret - 1) / 12)) / SCALE_END;
    const x = geom.nut + (geom.joint - geom.nut) * ((t + prev) / 2);
    const dots = fret === 12 ? [geom.strings[1]!, geom.strings[4]!] : [(geom.strings[2]! + geom.strings[3]!) / 2];
    g.fillStyle = "rgba(236, 220, 180, 0.8)";
    for (const y of dots) {
      g.beginPath();
      g.arc(X(x), Y(y), Math.max(3.5, width / 180), 0, Math.PI * 2);
      g.fill();
    }
  }

  const headW = (boardBot - boardTop) * 0.72;
  g.fillStyle = "rgba(72, 44, 24, 0.92)";
  g.beginPath();
  g.moveTo(X(geom.nut), Y(mid) - headW * 0.45);
  g.lineTo(X(geom.head), Y(mid) - headW * 0.72);
  g.lineTo(X(geom.head + geom.dir * -0.015), Y(mid) + headW * 0.72);
  g.lineTo(X(geom.nut), Y(mid) + headW * 0.45);
  g.closePath();
  g.fill();
  g.strokeStyle = "rgba(32, 18, 10, 0.8)";
  g.stroke();
  for (let i = 0; i < 3; i++) {
    const y = Y(mid) + (i - 1) * headW * 0.42;
    for (const side of [-1, 1]) {
      g.fillStyle = "rgba(210, 186, 140, 0.9)";
      g.beginPath();
      g.ellipse(X(geom.head + geom.dir * 0.012), y, 7, 5, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(40, 24, 14, 0.9)";
      g.beginPath();
      g.arc(X(geom.head + geom.dir * 0.012) + side * 8, y, 3.2, 0, Math.PI * 2);
      g.fill();
    }
  }

  const bridgeX = X(geom.bridge);
  g.fillStyle = "rgba(58, 34, 18, 0.95)";
  g.fillRect(bridgeX - 10, Y(geom.strings[0]!) - 8, 20, Y(geom.strings[5]!) - Y(geom.strings[0]!) + 16);
  g.fillStyle = "rgba(236, 224, 196, 0.9)";
  g.fillRect(bridgeX - 2, Y(geom.strings[0]!) - 4, 4, Y(geom.strings[5]!) - Y(geom.strings[0]!) + 8);
  geom.strings.forEach((at) => {
    g.fillStyle = "rgba(236, 220, 190, 0.85)";
    g.beginPath();
    g.arc(bridgeX + geom.dir * -14, Y(at), 3.2, 0, Math.PI * 2);
    g.fill();
  });

  geom.strings.forEach((at, i) => {
    const amp = play.vibe[i]! * (5 + (5 - i));
    const wave = Math.sin(time / 38 + i) * amp;
    g.strokeStyle = i === 0 || i === 1 ? "rgba(214, 176, 110, 0.95)" : "rgba(236, 228, 210, 0.95)";
    g.lineWidth = 2.4 - i * 0.22;
    g.beginPath();
    const steps = 24;
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const x = geom.nut + (geom.bridge - geom.nut) * u;
      const wobble = Math.sin(u * Math.PI) * wave;
      const px = X(x);
      const py = Y(at) + wobble;
      if (s === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
    if (play.frets[i]) {
      const ft = (1 - 2 ** (-(play.frets[i]! - 0.35) / 12)) / SCALE_END;
      const x = geom.nut + (geom.joint - geom.nut) * ft;
      g.fillStyle = "rgba(224, 154, 62, 0.95)";
      g.beginPath();
      g.arc(X(x), Y(at), Math.max(7, width / 90), 0, Math.PI * 2);
      g.fill();
    }
  });
  g.restore();
}
