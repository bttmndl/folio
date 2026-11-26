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

/** Place a rigid, life-size guitar: neck through the left hand, body on the right ribs. */
export function solveHold(pose: Point[] | null, hands: TrackedHand[]): Hold | null {
  const left = hands.find((hand) => hand.side === "Left");
  const right = hands.find((hand) => hand.side === "Right");
  const grip = ok(left?.points[5]) ? left?.points[5] : ok(left?.points[0]) ? left?.points[0] : ok(pose?.[15]) ? pose?.[15] : undefined;
  const rightWrist = ok(right?.points[0]) ? right?.points[0] : ok(pose?.[16]) ? pose?.[16] : undefined;
  const leftShoulder = ok(pose?.[11]) ? pose?.[11] : undefined;
  const rightShoulder = ok(pose?.[12]) ? pose?.[12] : undefined;
  const leftHip = ok(pose?.[23]) ? pose?.[23] : undefined;
  const rightHip = ok(pose?.[24]) ? pose?.[24] : undefined;
  const span =
    leftShoulder && rightShoulder
      ? Math.max(0.16, len(sub(leftShoulder, rightShoulder)))
      : grip && rightWrist
        ? Math.max(0.18, len(sub(grip, rightWrist)) * 0.62)
        : 0.32;

  let body: Point | null = null;
  if (rightHip && rightShoulder) body = mix(rightHip, rightShoulder, 0.5);
  else if (rightWrist) body = { x: rightWrist.x, y: rightWrist.y + span * 0.22 };
  else if (grip) body = { x: grip.x - span * 0.7, y: grip.y + span * 0.35 };
  if (!body) return null;
  if (leftShoulder && rightShoulder) {
    const chest = mix(leftShoulder, rightShoulder, 0.58);
    body = mix(body, chest, 0.22);
  }

  const towardHand = grip ? sub(grip, body) : { x: span * 0.9, y: -span * 0.55 };
  const axis = len(towardHand) > 0.03 ? norm(towardHand) : { x: 0.86, y: -0.51 };
  const scale = span * 1.85;
  let bridge = add(body, mul(axis, -span * 0.12));
  let nut = add(bridge, mul(axis, scale));
  if (grip) {
    const planted = add(bridge, mul(axis, scale * 0.75));
    const shift = sub(grip, planted);
    nut = add(nut, shift);
    bridge = add(bridge, shift);
  }
  const joint = lerp(nut, bridge, 0.5);
  const tail = add(bridge, mul(norm(sub(bridge, nut)), scale * 0.42));
  let perp = { x: -axis.y, y: axis.x };
  const up = leftShoulder && leftHip ? norm(sub(leftShoulder, leftHip)) : { x: 0, y: -1 };
  if (dot(perp, up) < 0) perp = mul(perp, -1);

  return { nut, joint, bridge, tail, perp, neckHalf: span * 0.05, bodyHalf: span * 0.42 };
}

function smoothHold(prev: Hold | null, next: Hold): Hold {
  if (!prev) return next;
  const jump = len(sub(prev.nut, next.nut));
  const a = jump > 0.18 ? 0.12 : 0.28;
  const s = (p: Point, n: Point) => mix(p, n, a);
  let perp = norm(s(prev.perp, next.perp));
  if (dot(perp, prev.perp) < 0) perp = mul(perp, -1);
  return {
    nut: s(prev.nut, next.nut),
    joint: s(prev.joint, next.joint),
    bridge: s(prev.bridge, next.bridge),
    tail: s(prev.tail, next.tail),
    perp,
    neckHalf: prev.neckHalf * (1 - a) + next.neckHalf * a,
    bodyHalf: prev.bodyHalf * (1 - a) + next.bodyHalf * a,
  };
}

const IMG_NUT = 0.127;
const IMG_JOINT = 0.509;
const IMG_BRIDGE = 0.81;
const IMG_MID = 0.497;
const STRING_V = [0.444, 0.464, 0.484, 0.505, 0.526, 0.546];

function spritePrefix(): string {
  const host = window.location.hostname.toLowerCase();
  if (host !== "preview.grok.genai.mil" && host !== "preview.grok.mil" && host !== "preview.grokgsac.com") return "";
  return /^\/hds-[a-z0-9]+-\d+-[a-z0-9]+(?=\/|$)/i.exec(window.location.pathname)?.[0] ?? "";
}

let sprite: HTMLImageElement | null = null;
let spriteStarted = false;

function guitarImage(): HTMLImageElement | null {
  if (typeof Image === "undefined") return null;
  if (sprite) return sprite;
  if (spriteStarted) return null;
  spriteStarted = true;
  const img = new Image();
  const prefix = typeof window === "undefined" ? "" : spritePrefix();
  img.src = `${prefix}/guitar.png`;
  img.onload = () => {
    sprite = img;
  };
  return null;
}

type Frame = {
  nutx: number;
  nuty: number;
  angle: number;
  full: number;
  destH: number;
  cos: number;
  sin: number;
  flip: boolean;
};

function frameOf(hold: Hold, width: number, height: number): Frame {
  const nutx = hold.nut.x * width;
  const nuty = hold.nut.y * height;
  const bx = hold.bridge.x * width;
  const by = hold.bridge.y * height;
  const angle = Math.atan2(by - nuty, bx - nutx);
  const dist = Math.hypot(bx - nutx, by - nuty) || 1;
  const full = dist / (IMG_BRIDGE - IMG_NUT);
  const destH = full * (612 / 1649);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const imageUp = { x: sin, y: -cos };
  const perp = norm({ x: hold.perp.x * width, y: hold.perp.y * height });
  const flip = imageUp.x * perp.x + imageUp.y * perp.y < 0;
  return { nutx, nuty, angle, full, destH, cos, sin, flip };
}

function toImage(frame: Frame, x: number, y: number): { u: number; v: number } {
  const dx = x - frame.nutx;
  const dy = y - frame.nuty;
  const lx = dx * frame.cos + dy * frame.sin;
  let ly = -dx * frame.sin + dy * frame.cos;
  if (frame.flip) ly = -ly;
  return { u: IMG_NUT + lx / frame.full, v: IMG_MID + ly / frame.destH };
}

export function updateGuitar(
  play: GuitarPlay,
  hands: TrackedHand[],
  pose: Point[] | null,
  now: number,
  width: number,
  height: number,
): Pluck[] {
  const target = solveHold(pose, hands);
  if (target) {
    play.hold = smoothHold(play.hold, target);
    play.seen = now;
  } else if (now - play.seen > 700) {
    play.hold = null;
  }
  const hold = play.hold;
  const plucks: Pluck[] = [];
  if (!hold || width < 2 || height < 2) return plucks;
  const frame = frameOf(hold, width, height);
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
      const uv = toImage(frame, tip.x * width, tip.y * height);
      if (uv.u < IMG_NUT - 0.02 || uv.u > IMG_JOINT + 0.03) continue;
      let best = 0;
      let dist = Infinity;
      STRING_V.forEach((v, i) => {
        const d = Math.abs(uv.v - v);
        if (d < dist) {
          dist = d;
          best = i;
        }
      });
      if (dist > 0.045) continue;
      const neckT = (uv.u - IMG_NUT) / (IMG_JOINT - IMG_NUT);
      play.frets[best] = fretAt(Math.min(1, Math.max(0, neckT)));
      play.touched[best] = now;
    }
  }

  if (right) {
    for (const tipIndex of [8, 12, 16]) {
      const tip = right.points[tipIndex];
      if (!tip) continue;
      const prev = track(`R${tipIndex}`, tip);
      if (!prev) continue;
      const ax = (tip.x - prev.x) * width;
      const ay = (tip.y - prev.y) * height;
      const speed = Math.hypot(ax, ay);
      if (speed < 6) continue;
      const across = Math.abs(ax * frame.sin - ay * frame.cos);
      const along = Math.abs(ax * frame.cos + ay * frame.sin);
      if (across < along * 0.75) continue;
      const a = toImage(frame, prev.x * width, prev.y * height);
      const b = toImage(frame, tip.x * width, tip.y * height);
      STRING_V.forEach((v, i) => {
        if ((a.v - v) * (b.v - v) > 0) return;
        const t = (v - a.v) / (b.v - a.v || 1);
        const u = a.u + (b.u - a.u) * t;
        if (u < 0.56 || u > 0.78) return;
        if (now - play.rung[i]! < 90) return;
        play.rung[i] = now;
        play.vibe[i] = 1;
        plucks.push({
          string: i,
          midi: midiFor(i, play.frets[i] ?? 0),
          velocity: Math.max(0.45, Math.min(1, speed / 28)),
        });
      });
    }
  }

  for (const id of play.last.keys()) if (!seen.has(id)) play.last.delete(id);
  for (let i = 0; i < 6; i++) {
    if (now - play.touched[i]! > 420) play.frets[i] = 0;
    play.vibe[i] = Math.max(0, play.vibe[i]! * 0.88);
  }
  return plucks;
}

export function drawGuitar(g: CanvasRenderingContext2D, play: GuitarPlay, width: number, height: number, time: number) {
  const hold = play.hold;
  const img = guitarImage();
  if (!hold || !img) return;
  const frame = frameOf(hold, width, height);
  g.save();
  g.translate(frame.nutx, frame.nuty);
  g.rotate(frame.angle);
  g.scale(1, frame.flip ? -1 : 1);
  g.save();
  g.filter = "blur(16px)";
  g.fillStyle = "rgba(0,0,0,0.38)";
  g.beginPath();
  g.ellipse((0.78 - IMG_NUT) * frame.full, frame.destH * 0.08, frame.full * 0.2, frame.destH * 0.34, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
  g.drawImage(img, -IMG_NUT * frame.full, -IMG_MID * frame.destH, frame.full, frame.destH);
  STRING_V.forEach((v, i) => {
    if (play.vibe[i]! < 0.05) return;
    const amp = Math.sin(time / 32 + i) * play.vibe[i]! * frame.destH * 0.012;
    const y = (v - IMG_MID) * frame.destH + amp;
    g.strokeStyle = "rgba(255,244,220,0.55)";
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo((0.55 - IMG_NUT) * frame.full, y);
    g.quadraticCurveTo((0.68 - IMG_NUT) * frame.full, y + amp * 3, (0.8 - IMG_NUT) * frame.full, y);
    g.stroke();
  });
  g.restore();
}
