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
  const tips = [8, 12, 16, 20].map((i) => left?.points[i]).filter((p) => ok(p));
  const indexMcp = ok(left?.points[5]) ? left?.points[5] : undefined;
  const pinkyMcp = ok(left?.points[17]) ? left?.points[17] : undefined;
  const grip =
    tips.length >= 2
      ? tips.reduce((sum, p) => add(sum, p), { x: 0, y: 0 })
      : indexMcp
        ? indexMcp
        : ok(pose?.[15])
          ? pose?.[15]
          : undefined;
  if (grip && tips.length >= 2) {
    grip.x /= tips.length;
    grip.y /= tips.length;
  }
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

  const towardNut = grip ? norm(sub(grip, body)) : { x: 0.86, y: -0.51 };
  let axis = towardNut;
  if (indexMcp && pinkyMcp && len(sub(indexMcp, pinkyMcp)) > 0.015) {
    let anatomical = norm(sub(indexMcp, pinkyMcp));
    if (dot(anatomical, towardNut) < 0) anatomical = mul(anatomical, -1);
    axis = norm(add(mul(anatomical, 0.7), mul(towardNut, 0.3)));
  }
  const scale = span * 1.72;
  let bridge = add(body, mul(axis, -span * 0.08));
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
  if (grip && tips.length >= 2 && indexMcp) {
    const curl = norm(sub(grip, indexMcp));
    if (dot(perp, curl) > 0) perp = mul(perp, -1);
  } else {
    const up = leftShoulder && leftHip ? norm(sub(leftShoulder, leftHip)) : { x: 0, y: -1 };
    if (dot(perp, up) < 0) perp = mul(perp, -1);
  }

  return { nut, joint, bridge, tail, perp, neckHalf: span * 0.05, bodyHalf: span * 0.42 };
}

function smoothHold(prev: Hold | null, next: Hold): Hold {
  if (!prev) return next;
  const jump = len(sub(prev.nut, next.nut));
  const a = jump > 0.22 ? 0.45 : 0.72;
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
  bx: number;
  by: number;
  px: number;
  py: number;
  destH: number;
};

function frameOf(hold: Hold, width: number, height: number): Frame {
  const nutx = hold.nut.x * width;
  const nuty = hold.nut.y * height;
  const bx = hold.bridge.x * width;
  const by = hold.bridge.y * height;
  const dist = Math.hypot(bx - nutx, by - nuty) || 1;
  const full = dist / (IMG_BRIDGE - IMG_NUT);
  const destH = full * (612 / 1649);
  const perp = norm({ x: hold.perp.x * width, y: hold.perp.y * height });
  return { nutx, nuty, bx, by, px: perp.x, py: perp.y, destH };
}

function widthScale(t: number): number {
  const u = Math.min(1.4, Math.max(-0.15, t));
  return 0.78 + 0.48 * Math.max(0, u);
}

function project(frame: Frame, s: number, v: number): { x: number; y: number } {
  const t = (s - IMG_NUT) / (IMG_BRIDGE - IMG_NUT);
  const x = frame.nutx + (frame.bx - frame.nutx) * t;
  const y = frame.nuty + (frame.by - frame.nuty) * t;
  const side = (v - IMG_MID) * frame.destH * widthScale(t);
  return { x: x + frame.px * side, y: y + frame.py * side };
}

function toImage(frame: Frame, x: number, y: number): { u: number; v: number } {
  const ax = frame.bx - frame.nutx;
  const ay = frame.by - frame.nuty;
  const denom = ax * ax + ay * ay || 1;
  const t = ((x - frame.nutx) * ax + (y - frame.nuty) * ay) / denom;
  const cx = frame.nutx + ax * t;
  const cy = frame.nuty + ay * t;
  const side = (x - cx) * frame.px + (y - cy) * frame.py;
  const scale = widthScale(t) * frame.destH || 1;
  return { u: IMG_NUT + t * (IMG_BRIDGE - IMG_NUT), v: IMG_MID + side / scale };
}

function blitStrip(
  g: CanvasRenderingContext2D,
  img: HTMLImageElement,
  frame: Frame,
  s0: number,
  s1: number,
) {
  const top0 = project(frame, s0, 0);
  const bot0 = project(frame, s0, 1);
  const top1 = project(frame, s1, 0);
  const sw = Math.max(1, (s1 - s0) * img.width);
  const sh = img.height;
  const sx = s0 * img.width;
  g.save();
  g.beginPath();
  g.moveTo(top0.x, top0.y);
  g.lineTo(top1.x, top1.y);
  g.lineTo(project(frame, s1, 1).x, project(frame, s1, 1).y);
  g.lineTo(bot0.x, bot0.y);
  g.closePath();
  g.clip();
  g.transform((top1.x - top0.x) / sw, (top1.y - top0.y) / sw, (bot0.x - top0.x) / sh, (bot0.y - top0.y) / sh, top0.x, top0.y);
  g.drawImage(img, sx, 0, sw, sh, 0, 0, sw, sh);
  g.restore();
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
      if (dist > 0.028) continue;
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
      if (speed < 4) continue;
      const steps = Math.max(1, Math.min(6, Math.ceil(speed / 10)));
      for (let step = 1; step <= steps; step++) {
        const a = toImage(
          frame,
          (prev.x + (tip.x - prev.x) * ((step - 1) / steps)) * width,
          (prev.y + (tip.y - prev.y) * ((step - 1) / steps)) * height,
        );
        const b = toImage(
          frame,
          (prev.x + (tip.x - prev.x) * (step / steps)) * width,
          (prev.y + (tip.y - prev.y) * (step / steps)) * height,
        );
        STRING_V.forEach((v, i) => {
          if ((a.v - v) * (b.v - v) > 0) return;
          const t = (v - a.v) / (b.v - a.v || 1);
          const u = a.u + (b.u - a.u) * t;
          if (u < 0.57 || u > 0.78) return;
          if (now - play.rung[i]! < 70) return;
          play.rung[i] = now;
          play.vibe[i] = 1;
          plucks.push({
            string: i,
            midi: midiFor(i, play.frets[i] ?? 0),
            velocity: Math.max(0.4, Math.min(1, speed / 22)),
          });
        });
      }
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
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  const shadow = project(frame, 0.74, IMG_MID);
  g.filter = "blur(18px)";
  g.fillStyle = "rgba(0,0,0,0.4)";
  g.beginPath();
  g.ellipse(shadow.x, shadow.y + height * 0.012, frame.destH * 0.72, frame.destH * 0.28, Math.atan2(frame.py, frame.px), 0, Math.PI * 2);
  g.fill();
  g.filter = "none";
  const strips = 18;
  for (let i = 0; i < strips; i++) blitStrip(g, img, frame, i / strips, (i + 1) / strips);
  for (let i = 0; i < 6; i++) {
    if (!play.frets[i]) continue;
    const neckT = (1 - 2 ** (-(play.frets[i]! - 0.35) / 12)) / (1 - 2 ** (-12 / 12));
    const s = IMG_NUT + neckT * (IMG_JOINT - IMG_NUT);
    const p = project(frame, s, STRING_V[i]!);
    g.fillStyle = "rgba(20, 12, 8, 0.45)";
    g.beginPath();
    g.ellipse(p.x, p.y, 7, 5, Math.atan2(frame.by - frame.nuty, frame.bx - frame.nutx), 0, Math.PI * 2);
    g.fill();
  }
  if (play.vibe.some((v) => v > 0.05)) {
    g.strokeStyle = "rgba(255,246,226,0.7)";
    g.lineWidth = 1.25;
    STRING_V.forEach((v, i) => {
      if (play.vibe[i]! < 0.05) return;
      const amp = Math.sin(time / 28 + i) * play.vibe[i]! * 5;
      g.beginPath();
      for (let s = 0; s <= 10; s++) {
        const u = 0.56 + (0.24 * s) / 10;
        const wobble = Math.sin((s / 10) * Math.PI) * amp;
        const p = project(frame, u, v + wobble / frame.destH);
        if (s === 0) g.moveTo(p.x, p.y);
        else g.lineTo(p.x, p.y);
      }
      g.stroke();
    });
  }
  g.restore();
}
