export type Pt = { x: number; y: number };

/** Map 4 source points onto 4 destinations. Returns a row-major 3×3 matrix. */
export function solveHomography(src: readonly Pt[], dst: readonly Pt[]): number[] {
  if (src.length !== 4 || dst.length !== 4) throw new Error("Need 4 point pairs");
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]!;
    const u = dst[i]!.x;
    const v = dst[i]!.y;
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve8(a, b);
  h.push(1);
  return h;
}

export function applyH(h: readonly number[], p: Pt): Pt {
  const x = h[0]! * p.x + h[1]! * p.y + h[2]!;
  const y = h[3]! * p.x + h[4]! * p.y + h[5]!;
  const w = h[6]! * p.x + h[7]! * p.y + h[8]!;
  if (Math.abs(w) < 1e-8) return { x: 0, y: 0 };
  return { x: x / w, y: y / w };
}

function solve8(a: number[][], b: number[]): number[] {
  const n = 8;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    }
    const piv = m[pivot]!;
    if (Math.abs(piv[col]!) < 1e-10) throw new Error("Corners are degenerate");
    m[pivot] = m[col]!;
    m[col] = piv;
    const div = piv[col]!;
    for (let c = col; c <= n; c++) piv[c] = piv[c]! / div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const row = m[r]!;
      const f = row[col]!;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) row[c] = row[c]! - f * piv[c]!;
    }
  }
  return m.map((row) => row[n]!);
}
