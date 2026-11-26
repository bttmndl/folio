import assert from "node:assert/strict";
import test from "node:test";
import { findSheet } from "./sheet-find.ts";

const W = 240;
const H = 135;

function blank(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = 28;
    data[i * 4 + 1] = 28;
    data[i * 4 + 2] = 26;
    data[i * 4 + 3] = 255;
  }
  return data;
}

function paint(data: Uint8ClampedArray, x: number, y: number, r: number, g: number, b: number) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  data[i] = r;
  data[i + 1] = g;
  data[i + 2] = b;
  data[i + 3] = 255;
}

function fillRect(data: Uint8ClampedArray, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) paint(data, x, y, rgb[0], rgb[1], rgb[2]);
}

function keyboardFrame(): Uint8ClampedArray {
  const data = blank();
  fillRect(data, 18, 18, 222, 118, [244, 240, 230]);
  // A short title above the keys must not become the keyboard.
  fillRect(data, 28, 28, 92, 31, [20, 18, 16]);
  const x0 = 34;
  const y0 = 52;
  const x1 = 206;
  const y1 = 100;
  for (let row = 0; row < 6; row++) {
    const top = y0 + Math.round((row * (y1 - y0)) / 6);
    const bot = y0 + Math.round(((row + 1) * (y1 - y0)) / 6);
    fillRect(data, x0, top, x1, top + 1, [16, 16, 16]);
    fillRect(data, x0, bot - 1, x1, bot, [16, 16, 16]);
    for (let col = 0; col <= 16; col++) {
      const left = x0 + Math.round((col * (x1 - x0)) / 16);
      fillRect(data, left, top, left + 1, bot, [16, 16, 16]);
    }
  }
  return data;
}

test("finds a wide keyboard and ignores the page title", () => {
  const hit = findSheet(keyboardFrame(), W, H);
  assert.ok(hit);
  const [tl, tr, br, bl] = hit.points;
  assert.ok(tl && tr && br && bl);
  assert.ok(tl.x < 0.22 && tl.y < 0.48);
  assert.ok(tr.x > 0.8 && tr.y < 0.48);
  assert.ok(br.x > 0.8 && br.y > 0.65);
  assert.ok(bl.x < 0.22 && bl.y > 0.65);
  assert.ok(Math.hypot(tr.x - tl.x, tr.y - tl.y) > Math.hypot(bl.x - tl.x, bl.y - tl.y) * 2);
});

test("returns nothing when the frame has no sheet", () => {
  assert.equal(findSheet(blank(), W, H), null);
});

test("returns nothing for a tall page of text", () => {
  const data = blank();
  fillRect(data, 70, 10, 170, 125, [250, 250, 248]);
  for (let y = 18; y < 120; y += 6) fillRect(data, 78, y, 162, y + 1, [20, 20, 20]);
  assert.equal(findSheet(data, W, H), null);
});

test("finds a dark laptop keyboard", () => {
  const data = blank();
  fillRect(data, 0, 0, W - 1, H - 1, [150, 40, 36]);
  const x0 = 30;
  const y0 = 28;
  const x1 = 200;
  const y1 = 108;
  fillRect(data, x0, y0, x1, y1, [24, 26, 28]);
  for (let row = 0; row < 5; row++) {
    const top = y0 + 3 + row * 15;
    for (let col = 0; col < 12; col++) {
      const left = x0 + 4 + col * 14;
      fillRect(data, left, top, left + 10, top + 10, [78, 80, 76]);
    }
  }
  const hit = findSheet(data, W, H);
  assert.ok(hit);
  const [tl, tr, br, bl] = hit.points;
  assert.ok(tl && tr && br && bl);
  assert.ok(tl.x < 0.25 && tr.x > 0.7);
  assert.ok(tl.y < 0.4 && bl.y > 0.65);
});

test("ignores a flat gray panel", () => {
  const data = blank();
  fillRect(data, 20, 20, 210, 110, [90, 90, 90]);
  assert.equal(findSheet(data, W, H), null);
});
