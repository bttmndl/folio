export type Pt = { x: number; y: number };

export type SheetHit = {
  /** Normalized video points, order: top-left, top-right, bottom-right, bottom-left. */
  points: Pt[];
};

type Run = { start: number; end: number };

/**
 * Find a printed laptop keyboard in a camera frame.
 * Looks for a bright sheet and a short, very wide block of key ink.
 * Returns null until that shape is actually there.
 */
export function findSheet(rgba: Uint8ClampedArray, width: number, height: number): SheetHit | null {
  return findPrinted(rgba, width, height) ?? findLaptop(rgba, width, height);
}

function findPrinted(rgba: Uint8ClampedArray, width: number, height: number): SheetHit | null {
  if (width < 24 || height < 24 || rgba.length < width * height * 4) return null;
  const n = width * height;
  const luma = new Uint8Array(n);
  let brightCount = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const y = (rgba[p]! * 0.299 + rgba[p + 1]! * 0.587 + rgba[p + 2]! * 0.114) | 0;
    luma[i] = y;
    if (y >= 168) brightCount++;
  }
  if (brightCount < n * 0.07) return null;

  const bright = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (luma[i]! >= 168) bright[i] = 1;
  const paper = largest(bright, width, height);
  if (!paper || paper.area < n * 0.07) return null;

  const ink = new Uint8Array(n);
  let inkCount = 0;
  for (let y = paper.minY; y <= paper.maxY; y++) {
    for (let x = paper.minX; x <= paper.maxX; x++) {
      const i = y * width + x;
      if (luma[i]! < 108) {
        ink[i] = 1;
        inkCount++;
      }
    }
  }
  if (inkCount < 40) return null;

  const paperW = paper.maxX - paper.minX + 1;
  const rows = new Float32Array(height);
  for (let y = paper.minY; y <= paper.maxY; y++) {
    let count = 0;
    for (let x = paper.minX; x <= paper.maxX; x++) if (ink[y * width + x]) count++;
    rows[y] = count;
  }
  const rowSmooth = smooth(rows, Math.max(1, Math.round(height * 0.018)));
  const rowRun = longest(rowSmooth, paperW * 0.15, paper.minY, paper.maxY);
  if (!rowRun || rowRun.end - rowRun.start + 1 < height * 0.05) return null;

  const cols = new Float32Array(width);
  const bandH = rowRun.end - rowRun.start + 1;
  for (let x = paper.minX; x <= paper.maxX; x++) {
    let count = 0;
    for (let y = rowRun.start; y <= rowRun.end; y++) if (ink[y * width + x]) count++;
    cols[x] = count;
  }
  const colSmooth = smooth(cols, Math.max(1, Math.round(width * 0.012)));
  const colRun = longest(colSmooth, bandH * 0.1, paper.minX, paper.maxX);
  if (!colRun) return null;

  const padX = Math.max(2, Math.round((colRun.end - colRun.start) * 0.03));
  const padY = Math.max(2, Math.round(bandH * 0.08));
  const x0 = Math.max(0, colRun.start - padX);
  const x1 = Math.min(width - 1, colRun.end + padX);
  const y0 = Math.max(0, rowRun.start - padY);
  const y1 = Math.min(height - 1, rowRun.end + padY);

  let tl = { x: 0, y: 0, s: Infinity };
  let tr = { x: 0, y: 0, s: -Infinity };
  let br = { x: 0, y: 0, s: -Infinity };
  let bl = { x: 0, y: 0, s: Infinity };
  let seen = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!ink[y * width + x]) continue;
      seen++;
      const sum = x + y;
      const diff = x - y;
      if (sum < tl.s) tl = { x, y, s: sum };
      if (sum > br.s) br = { x, y, s: sum };
      if (diff > tr.s) tr = { x, y, s: diff };
      if (diff < bl.s) bl = { x, y, s: diff };
    }
  }
  if (seen < 30) return null;

  const corners = [tl, tr, br, bl];
  const ids = new Set(corners.map((p) => p.y * width + p.x));
  if (ids.size < 4) return null;

  const widthPx = (dist(tl, tr) + dist(bl, br)) / 2;
  const heightPx = (dist(tl, bl) + dist(tr, br)) / 2;
  if (heightPx < 4 || widthPx < width * 0.16) return null;
  const aspect = widthPx / heightPx;
  if (aspect < 2.05 || aspect > 5.2) return null;
  if (widthPx * heightPx < n * 0.03) return null;

  let light = 0;
  let samples = 0;
  for (let y = y0; y <= y1; y += 2) {
    for (let x = x0; x <= x1; x += 2) {
      light += luma[y * width + x]!;
      samples++;
    }
  }
  if (samples && light / samples < 145) return null;

  const norm = (p: { x: number; y: number }) => ({ x: (p.x + 0.5) / width, y: (p.y + 0.5) / height });
  return { points: [norm(tl), norm(tr), norm(br), norm(bl)] };
}

/** A real laptop deck: gray keycaps, not a white printed sheet. */
function findLaptop(rgba: Uint8ClampedArray, width: number, height: number): SheetHit | null {
  if (width < 24 || height < 24) return null;
  const n = width * height;
  const mask = new Uint8Array(n);
  const luma = new Uint8Array(n);
  let marked = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = rgba[p]!;
    const g = rgba[p + 1]!;
    const b = rgba[p + 2]!;
    const y = (r * 0.299 + g * 0.587 + b * 0.114) | 0;
    luma[i] = y;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    if (chroma < 32 && y >= 32 && y <= 150) {
      mask[i] = 1;
      marked++;
    }
  }
  if (marked < n * 0.06) return null;

  const rows = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) if (mask[y * width + x]) count++;
    rows[y] = count;
  }
  const rowFlags: boolean[] = [];
  for (let y = 0; y < height; y++) rowFlags.push(rows[y]! >= width * 0.18);
  const rowOn = bridge(rowFlags, Math.max(2, Math.round(height * 0.07)));
  const rowRun = longestOn(rowOn);
  if (!rowRun) return null;
  const bandH = rowRun.end - rowRun.start + 1;
  if (bandH < height * 0.16 || bandH > height * 0.96) return null;

  const cols = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = rowRun.start; y <= rowRun.end; y++) if (mask[y * width + x]) count++;
    cols[x] = count;
  }
  const colOn = bridge(Array.from(cols, (value) => value >= bandH * 0.14), Math.max(2, Math.round(width * 0.05)));
  const colRun = longestOn(colOn);
  if (!colRun) return null;
  const bandW = colRun.end - colRun.start + 1;
  if (bandW < width * 0.28) return null;
  const aspect = bandW / bandH;
  if (aspect < 0.5 || aspect > 5.4) return null;
  if (bandW * bandH < n * 0.08) return null;

  let edges = 0;
  let samples = 0;
  for (let y = rowRun.start; y <= rowRun.end; y += 1) {
    for (let x = colRun.start; x < colRun.end; x += 2) {
      samples++;
      if (Math.abs(luma[y * width + x]! - luma[y * width + x + 1]!) > 14) edges++;
    }
  }
  if (!samples || edges / samples < 0.045) return null;

  const norm = (x: number, y: number) => ({ x: (x + 0.5) / width, y: (y + 0.5) / height });
  return {
    points: [
      norm(colRun.start, rowRun.start),
      norm(colRun.end, rowRun.start),
      norm(colRun.end, rowRun.end),
      norm(colRun.start, rowRun.end),
    ],
  };
}

function bridge(flags: boolean[], gap: number): boolean[] {
  const on = flags.slice();
  let i = 0;
  while (i < on.length) {
    if (on[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < on.length && !on[j]) j++;
    if (i > 0 && j < on.length && j - i <= gap) {
      for (let k = i; k < j; k++) on[k] = true;
    }
    i = j === i ? i + 1 : j;
  }
  return on;
}

function longestOn(flags: boolean[]): Run | null {
  let best: Run | null = null;
  let start = -1;
  for (let i = 0; i <= flags.length; i++) {
    const on = i < flags.length && flags[i];
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      const run = { start, end: i - 1 };
      if (!best || run.end - run.start > best.end - best.start) best = run;
      start = -1;
    }
  }
  return best;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function smooth(values: Float32Array, radius: number) {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let count = 0;
    const a = Math.max(0, i - radius);
    const b = Math.min(values.length - 1, i + radius);
    for (let j = a; j <= b; j++) {
      sum += values[j]!;
      count++;
    }
    out[i] = sum / count;
  }
  return out;
}

function longest(values: Float32Array, cut: number, lo: number, hi: number): Run | null {
  let best: Run | null = null;
  let start = -1;
  for (let i = lo; i <= hi + 1; i++) {
    const on = i <= hi && values[i]! >= cut;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      const run = { start, end: i - 1 };
      if (!best || run.end - run.start > best.end - best.start) best = run;
      start = -1;
    }
  }
  return best;
}

type Comp = { area: number; minX: number; minY: number; maxX: number; maxY: number };

function largest(mask: Uint8Array, width: number, height: number): Comp | null {
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  let best: Comp | null = null;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    let sp = 0;
    stack[sp++] = i;
    seen[i] = 1;
    const comp: Comp = { area: 0, minX: width, minY: height, maxX: 0, maxY: 0 };
    while (sp) {
      const p = stack[--sp]!;
      const x = p % width;
      const y = (p / width) | 0;
      comp.area++;
      if (x < comp.minX) comp.minX = x;
      if (x > comp.maxX) comp.maxX = x;
      if (y < comp.minY) comp.minY = y;
      if (y > comp.maxY) comp.maxY = y;
      if (x > 0) push(p - 1);
      if (x + 1 < width) push(p + 1);
      if (y > 0) push(p - width);
      if (y + 1 < height) push(p + width);
    }
    if (!best || comp.area > best.area) best = comp;

    function push(q: number) {
      if (mask[q] && !seen[q]) {
        seen[q] = 1;
        stack[sp++] = q;
      }
    }
  }
  return best;
}
