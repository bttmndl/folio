import assert from "node:assert/strict";
import test from "node:test";
import { createPianoPlay, keyAt, noteName, updatePiano, whiteMidi, boardOf } from "./piano.ts";

test("white keys start at C3", () => {
  assert.equal(whiteMidi(0), 48);
  assert.equal(whiteMidi(7), 60);
  assert.equal(noteName(60), "C4");
});

test("a fingertip moving down on the keyboard plays that key", () => {
  const play = createPianoPlay();
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.55 }));
  points[0] = { x: 0.5, y: 0.4 };
  points[8] = { x: 0.5, y: 0.58 };
  updatePiano(play, [{ points }], 0, 1000, 1000);
  const board = boardOf(play, 1000, 1000);
  const midi = keyAt(board, 500, 580);
  assert.equal(typeof midi, "number");
  const next = points.map((p) => ({ ...p }));
  next[8] = { x: 0.5, y: 0.64 };
  const notes = updatePiano(play, [{ points: next }], 40, 1000, 1000);
  assert.ok(notes.length >= 1);
  assert.equal(notes[0]!.midi, keyAt(boardOf(play, 1000, 1000), 500, 640));
});
