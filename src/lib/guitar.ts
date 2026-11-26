/** Acoustic guitar locked to the body, the way a person actually holds one. */

export type Point = { x: number; y: number };

export type TrackedHand = { side: "Left" | "Right"; points: Point[] };

export type Hold = {
  nut: Point;
  joint: Point;
  bridge: Point;
  tail: Point;
  /** Unit vector toward the low E string. */
  perp: Point;
  neckHalf: number;
  bodyHalf: number;
};

export type Pluck = { string: number; midi: number; velocity: number };

export type GuitarPlay = {
  frets: number[];
  touched: number[];
  last: Map<string, { x: number; y: number }>;
  rung: number[];
  vibe: number[];
  hold: Hold | null;
  seen: number;
};

const FRETS = 12;
const OPENS = [40, 45, 50, 55, 59, 64];
const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const SCALE_END = 1 - 2 ** (-FRETS / 12);
const FRET_TIPS = [8, 12, 16, 20];

export function createGuitarPlay(): GuitarPlay {
  return {
    frets: [0, 0, 0, 0, 0, 0],
    touched: [0, 0, 0, 0, 0, 0],
    last: new Map(),
    rung: [0, 0, 0, 0, 0, 0],
    vibe: [0, 0, 0, 0, 0, 0],
    hold: null,
    seen: 0,
  };
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

function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}
function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}
function mul(a: Point, s: number): Point {
  return { x: a.x * s, y: a.y * s };
}
function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}
function len(a: Point): number {
  return Math.hypot(a.x, a.y);
}
function norm(a: Point): Point {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
}
function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
function mix(a: Point, b: Point, t: number): Point {
  return lerp(a, b, t);
}
function ok(p: Point | undefined): p is Point {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** Place the guitar on the player: neck in the left hand, body against the right side. */
export function solveHold(pose: Point[] | null, hands: TrackedHand[]): Hold | null {
  const left = hands.find((hand) => hand.side === "Left");
  const right = hands.find((hand) => hand.side === "Right");
  const leftWrist = ok(left?.points[0]) ? left?.points[0] : ok(pose?.[15]) ? pose?.[15] : undefined;
  const rightWrist = ok(right?.points[0]) ? right?.points[0] : ok(pose?.[16]) ? pose?.[16] : undefined;
  const leftShoulder = ok(pose?.[11]) ? pose?.[11] : undefined;
  const rightShoulder = ok(pose?.[12]) ? pose?.[12] : undefined;
  const leftHip = ok(pose?.[23]) ? pose?.[23] : undefined;
  const rightHip = ok(pose?.[24]) ? pose?.[24] : undefined;
  const span =
    leftShoulder && rightShoulder ? Math.max(0.18, len(sub(leftShoulder, rightShoulder))) : leftWrist && rightWrist ? Math.max(0.2, len(sub(leftWrist, rightWrist)) * 0.7) : 0.34;

  let body: Point | null = null;
  if (rightHip && rightShoulder) body = mix(rightHip, rightShoulder, 0.4);
  else if (rightWrist) body = { x: rightWrist.x + span * 0.05, y: rightWrist.y + span * 0.28 };
  else if (leftWrist) body = { x: leftWrist.x - span * 0.85, y: leftWrist.y + span * 0.45 };
  if (!body) return null;
  if (leftShoulder && rightShoulder) body = mix(body, mix(leftShoulder, rightShoulder, 0.62), 0.2);

  const grip = leftWrist ?? { x: body.x + span * 0.95, y: body.y - span * 0.72 };
  const toGrip = sub(grip, body);
  const dir = len(toGrip) > 0.04 ? norm(toGrip) : { x: 0.82, y: -0.57 };
  const joint = add(body, mul(dir, span * 0.16));
  const nut = add(grip, mul(dir, span * 0.38));
  const bridge = add(body, mul(dir, -span * 0.22));
  const tail = add(body, mul(dir, -span * 0.5));

  const axis = norm(sub(bridge, nut));
  let perp = { x: -axis.y, y: axis.x };
  const up = leftShoulder && leftHip ? norm(sub(leftShoulder, leftHip)) : { x: 0, y: -1 };
  if (dot(perp, up) < 0) perp = mul(perp, -1);

  return {
    nut,
    joint,
    bridge,
    tail,
    perp,
    neckHalf: span * 0.055,
    bodyHalf: span * 0.34,
  };
}

function smoothHold(prev: Hold | null, next: Hold): Hold {
  if (!prev) return next;
  const a = 0.38;
  const s = (p: Point, n: Point) => mix(p, n, a);
  return {
    nut: s(prev.nut, next.nut),
    joint: s(prev.joint, next.joint),
    bridge: s(prev.bridge, next.bridge),
    tail: s(prev.tail, next.tail),
    perp: norm(s(prev.perp, next.perp)),
    neckHalf: prev.neckHalf * (1 - a) + next.neckHalf * a,
    bodyHalf: prev.bodyHalf * (1 - a) + next.bodyHalf * a,
  };
}

function at(hold: Hold, along: number, side: number): Point {
  const x = hold.nut.x + (hold.bridge.x - hold.nut.x) * along + hold.perp.x * side;
  const y = hold.nut.y + (hold.bridge.y - hold.nut.y) * along + hold.perp.y * side;
  return { x, y };
}

function alongOf(hold: Hold, p: Point): number {
  const axis = sub(hold.bridge, hold.nut);
  const denom = dot(axis, axis) || 1;
  return dot(sub(p, hold.nut), axis) / denom;
}

function sideOf(hold: Hold, p: Point): number {
  const a = alongOf(hold, p);
  const closest = at(hold, a, 0);
  return dot(sub(p, closest), hold.perp);
}

function stringIndexAt(hold: Hold, p: Point): { index: number; along: number } | null {
  const side = sideOf(hold, p);
  const half = hold.neckHalf * 2.4;
  if (Math.abs(side) > half) return null;
  const index = Math.round(((half - side) / (2 * half)) * 5);
  return { index: Math.min(5, Math.max(0, index)), along: alongOf(hold, p) };
}

export function updateGuitar(play: GuitarPlay, hands: TrackedHand[], pose: Point[] | null, now: number): Pluck[] {
  const target = solveHold(pose, hands);
  if (target) {
    play.hold = smoothHold(play.hold, target);
    play.seen = now;
  } else if (now - play.seen > 700) {
    play.hold = null;
  }
  const hold = play.hold;
  const plucks: Pluck[] = [];
  if (!hold) return plucks;

  const jointA = alongOf(hold, hold.joint);
  const seen = new Set<string>();
  const left = hands.find((hand) => hand.side === "Left");
  const right = hands.find((hand) => hand.side === "Right");

  const track = (id: string, p: Point) => {
    seen.add(id);
    const prev = play.last.get(id);
    play.last.set(id, p);
    return prev;
  };

  if (left) {
    for (const tipIndex of FRET_TIPS) {
      const tip = left.points[tipIndex];
      if (!tip) continue;
      track(`L${tipIndex}`, tip);
      const hit = stringIndexAt(hold, tip);
      if (!hit) continue;
      const neckT = jointA > 0.05 ? hit.along / jointA : 0;
      if (neckT < -0.05 || neckT > 1.08) continue;
      play.frets[hit.index] = fretAt(Math.min(1, Math.max(0, neckT)));
      play.touched[hit.index] = now;
    }
  }

  if (right) {
    for (const tipIndex of [0, 4, 8, 12, 16, 20]) {
      const tip = right.points[tipIndex];
      if (!tip) continue;
      const prev = track(`R${tipIndex}`, tip);
      if (!prev) continue;
      const speed = len(sub(tip, prev));
      if (speed < 0.008) continue;
      strum(play, hold, prev, tip, speed, now, plucks, jointA);
    }
  }

  for (const id of play.last.keys()) if (!seen.has(id)) play.last.delete(id);
  for (let i = 0; i < 6; i++) {
    if (now - play.touched[i]! > 420) play.frets[i] = 0;
    play.vibe[i] = Math.max(0, play.vibe[i]! * 0.9);
  }
  return plucks;
}

function strum(play: GuitarPlay, hold: Hold, a: Point, b: Point, speed: number, now: number, plucks: Pluck[], jointA: number) {
  for (let i = 0; i < 6; i++) {
    const side = hold.neckHalf * 2.1 * ((2.5 - i) / 2.5);
    const c = at(hold, jointA + 0.06, side);
    const d = at(hold, 1.02, side);
    const hit = segmentCross(a, b, c, d);
    if (!hit) continue;
    if (now - play.rung[i]! < 70) continue;
    play.rung[i] = now;
    play.vibe[i] = 1;
    plucks.push({
      string: i,
      midi: midiFor(i, play.frets[i] ?? 0),
      velocity: Math.max(0.42, Math.min(1, speed * 14)),
    });
  }
}

function segmentCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-6) return false;
  const q = sub(c, a);
  const t = (q.x * s.y - q.y * s.x) / den;
  const u = (q.x * r.y - q.y * r.x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

export function drawGuitar(g: CanvasRenderingContext2D, play: GuitarPlay, width: number, height: number, time: number) {
  const hold = play.hold;
  if (!hold) return;
  const X = (p: Point) => ({ x: p.x * width, y: p.y * height });
  const jointA = alongOf(hold, hold.joint);
  const tailA = alongOf(hold, hold.tail);
  const P = (along: number, side: number) => X(at(hold, along, side));

  g.save();
  const shadow = P((jointA + tailA) / 2, 0);
  g.fillStyle = "rgba(0,0,0,0.28)";
  g.beginPath();
  g.ellipse(shadow.x, shadow.y + height * 0.03, hold.bodyHalf * width * 1.05, hold.bodyHalf * height * 0.42, Math.atan2(hold.perp.x, hold.perp.y), 0, Math.PI * 2);
  g.fill();

  const body = new Path2D();
  const B = (u: number, v: number) => P(jointA + (tailA - jointA) * u, v * hold.bodyHalf);
  const b0 = B(0.04, -0.22);
  body.moveTo(b0.x, b0.y);
  const curve = (u1: number, v1: number, u2: number, v2: number, u: number, v: number) => {
    const c1 = B(u1, v1);
    const c2 = B(u2, v2);
    const p = B(u, v);
    body.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p.x, p.y);
  };
  curve(0.18, -0.95, 0.34, -0.7, 0.42, -0.38);
  curve(0.52, -0.55, 0.7, -1.05, 0.86, -0.72);
  curve(1.02, -0.2, 1.02, 0.2, 0.86, 0.72);
  curve(0.7, 1.05, 0.52, 0.58, 0.42, 0.4);
  curve(0.34, 0.78, 0.18, 0.9, 0.04, 0.22);
  body.closePath();
  const grad = g.createLinearGradient(P(jointA, 0).x, P(jointA, 0).y, P(tailA, 0).x, P(tailA, 0).y);
  grad.addColorStop(0, "rgba(214, 176, 114, 0.9)");
  grad.addColorStop(0.55, "rgba(236, 206, 146, 0.92)");
  grad.addColorStop(1, "rgba(176, 122, 64, 0.92)");
  g.fillStyle = grad;
  g.fill(body);
  g.strokeStyle = "rgba(48, 26, 12, 0.9)";
  g.lineWidth = 3;
  g.stroke(body);

  const hole = P(jointA + (1 - jointA) * 0.42, 0);
  const holeR = Math.min(width, height) * hold.bodyHalf * 0.55;
  g.beginPath();
  g.arc(hole.x, hole.y, holeR * 1.22, 0, Math.PI * 2);
  g.strokeStyle = "rgba(92, 52, 24, 0.95)";
  g.lineWidth = Math.max(6, holeR * 0.28);
  g.stroke();
  g.beginPath();
  g.arc(hole.x, hole.y, holeR, 0, Math.PI * 2);
  g.fillStyle = "rgba(10, 7, 5, 0.92)";
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = "rgba(224, 186, 120, 0.85)";
  g.stroke();

  const neck = new Path2D();
  const n0 = P(0, hold.neckHalf);
  const n1 = P(jointA, hold.neckHalf * 1.08);
  const n2 = P(jointA, -hold.neckHalf * 1.08);
  const n3 = P(0, -hold.neckHalf);
  neck.moveTo(n0.x, n0.y);
  neck.lineTo(n1.x, n1.y);
  neck.lineTo(n2.x, n2.y);
  neck.lineTo(n3.x, n3.y);
  neck.closePath();
  g.fillStyle = "rgba(92, 56, 30, 0.94)";
  g.fill(neck);

  const board = new Path2D();
  const f0 = P(0, hold.neckHalf * 0.82);
  const f1 = P(jointA, hold.neckHalf * 0.9);
  const f2 = P(jointA, -hold.neckHalf * 0.9);
  const f3 = P(0, -hold.neckHalf * 0.82);
  board.moveTo(f0.x, f0.y);
  board.lineTo(f1.x, f1.y);
  board.lineTo(f2.x, f2.y);
  board.lineTo(f3.x, f3.y);
  board.closePath();
  g.fillStyle = "rgba(38, 22, 14, 0.95)";
  g.fill(board);

  g.strokeStyle = "rgba(236, 224, 196, 0.95)";
  g.lineWidth = 4;
  g.beginPath();
  const nutA = P(0, hold.neckHalf * 0.82);
  const nutB = P(0, -hold.neckHalf * 0.82);
  g.moveTo(nutA.x, nutA.y);
  g.lineTo(nutB.x, nutB.y);
  g.stroke();

  for (let fret = 1; fret <= FRETS; fret++) {
    const t = (1 - 2 ** (-fret / 12)) / SCALE_END;
    const a = t * jointA;
    const p1 = P(a, hold.neckHalf * 0.9);
    const p2 = P(a, -hold.neckHalf * 0.9);
    g.strokeStyle = "rgba(214, 196, 160, 0.8)";
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(p1.x, p1.y);
    g.lineTo(p2.x, p2.y);
    g.stroke();
  }

  g.fillStyle = "rgba(236, 220, 180, 0.85)";
  for (const fret of [3, 5, 7, 9, 12]) {
    const t = (1 - 2 ** (-fret / 12)) / SCALE_END;
    const prev = (1 - 2 ** (-(fret - 1) / 12)) / SCALE_END;
    const a = ((t + prev) / 2) * jointA;
    const spots = fret === 12 ? [0.45, -0.45] : [0];
    for (const spot of spots) {
      const p = P(a, spot * hold.neckHalf);
      g.beginPath();
      g.arc(p.x, p.y, Math.max(3, hold.neckHalf * width * 0.18), 0, Math.PI * 2);
      g.fill();
    }
  }

  const head = new Path2D();
  const h0 = P(-0.01, hold.neckHalf * 0.7);
  const h1 = P(-0.16, hold.neckHalf * 1.15);
  const h2 = P(-0.16, -hold.neckHalf * 1.15);
  const h3 = P(-0.01, -hold.neckHalf * 0.7);
  head.moveTo(h0.x, h0.y);
  head.lineTo(h1.x, h1.y);
  head.lineTo(h2.x, h2.y);
  head.lineTo(h3.x, h3.y);
  head.closePath();
  g.fillStyle = "rgba(64, 38, 20, 0.96)";
  g.fill(head);
  g.strokeStyle = "rgba(28, 16, 8, 0.8)";
  g.stroke();

  const bridge = P(1, 0);
  const bTop = P(1, hold.neckHalf * 2.3);
  const bBot = P(1, -hold.neckHalf * 2.3);
  g.strokeStyle = "rgba(42, 24, 12, 0.95)";
  g.lineWidth = 8;
  g.beginPath();
  g.moveTo(bTop.x, bTop.y);
  g.lineTo(bBot.x, bBot.y);
  g.stroke();
  g.strokeStyle = "rgba(236, 224, 196, 0.9)";
  g.lineWidth = 2;
  g.stroke();

  for (let i = 0; i < 6; i++) {
    const side = hold.neckHalf * 2.1 * ((2.5 - i) / 2.5);
    g.strokeStyle = i < 2 ? "rgba(196, 154, 86, 0.98)" : "rgba(240, 232, 214, 0.98)";
    g.lineWidth = 2.6 - i * 0.22;
    g.beginPath();
    for (let s = 0; s <= 22; s++) {
      const u = s / 22;
      const wobble = Math.sin(u * Math.PI) * Math.sin(time / 36 + i) * play.vibe[i]! * hold.neckHalf * 0.8;
      const p = P(u, side + wobble);
      if (s === 0) g.moveTo(p.x, p.y);
      else g.lineTo(p.x, p.y);
    }
    g.stroke();
    if (play.frets[i]) {
      const ft = (1 - 2 ** (-(play.frets[i]! - 0.3) / 12)) / SCALE_END;
      const p = P(ft * jointA, side);
      g.fillStyle = "rgba(224, 154, 62, 0.96)";
      g.beginPath();
      g.arc(p.x, p.y, Math.max(6, hold.neckHalf * width * 0.28), 0, Math.PI * 2);
      g.fill();
    }
  }
  void bridge;
  g.restore();
}
