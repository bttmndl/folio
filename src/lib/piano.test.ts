import assert from "node:assert/strict";
import test from "node:test";
import { boardOf, createPianoPlay, keyAt, noteName, updatePiano, whiteMidi } from "./piano.ts";

test("white keys start at C3", () => {
  assert.equal(whiteMidi(0), 48);
  assert.equal(whiteMidi(7), 60);
  assert.equal(noteName(60), "C4");
});

function finger(x: number, y: number) {
  const points = Array.from({ length: 21 }, () => ({ x, y }));
  points[0] = { x, y: y - 0.12 };
  points[8] = { x, y };
  return { points };
}

test("both hands stretch the piano, a double-tap locks it, then a press plays", () => {
  const play = createPianoPlay();
  updatePiano(play, [finger(0.3, 0.6), finger(0.7, 0.6)], 0, 1000, 1000, 1000, 1000);
  const before = play.span;
  updatePiano(play, [finger(0.15, 0.6), finger(0.85, 0.6)], 40, 1000, 1000, 1000, 1000);
  assert.ok(play.span > before);

  updatePiano(play, [finger(0.5, 0.5)], 100, 1000, 1000, 1000, 1000);
  updatePiano(play, [finger(0.5, 0.58)], 160, 1000, 1000, 1000, 1000);
  updatePiano(play, [finger(0.5, 0.5)], 280, 1000, 1000, 1000, 1000);
  updatePiano(play, [finger(0.5, 0.58)], 360, 1000, 1000, 1000, 1000);
  assert.equal(play.locked, true);

  const parked = { x: play.cx, y: play.cy, span: play.span };
  updatePiano(play, [finger(0.2, 0.3)], 500, 1000, 1000, 1000, 1000);
  assert.equal(play.cx, parked.x);
  assert.equal(play.cy, parked.y);
  assert.equal(play.span, parked.span);

  const board = boardOf(play, 1000, 1000, 1000, 1000);
  const x = board.left + board.width * 0.5;
  const y = board.top + board.height * 0.75;
  updatePiano(play, [finger(x / 1000, board.top / 1000 - 0.03)], 600, 1000, 1000, 1000, 1000);
  const notes = updatePiano(play, [finger(x / 1000, y / 1000)], 680, 1000, 1000, 1000, 1000);
  assert.ok(notes.length >= 1);
  assert.equal(notes[0]!.midi, keyAt(board, x, y));
});

test("rotation keeps the piano on the phone and horizontal", () => {
  const play = createPianoPlay();
  play.ready = true;
  play.locked = true;
  play.cx = 0.5;
  play.cy = 0.5;
  play.span = 0.8;
  const portrait = boardOf(play, 1280, 720, 400, 800);
  const landscape = boardOf(play, 1280, 720, 800, 400);
  assert.equal(portrait.angle, 0);
  assert.equal(landscape.angle, 0);
  assert.ok(landscape.width > portrait.width);
  assert.ok(portrait.height < portrait.width);
});
