import assert from "node:assert/strict";
import test from "node:test";
import { chordLabel, fretAt, midiFor, solveHold } from "./guitar.ts";

test("open string is fret 0 and the 12th fret is the octave", () => {
  assert.equal(fretAt(0), 0);
  assert.equal(fretAt(1), 12);
  assert.equal(midiFor(0, 12), 52);
  assert.equal(midiFor(5, 0), 64);
});

test("an E major shape is named", () => {
  assert.equal(chordLabel([0, 2, 2, 1, 0, 0]), "E");
});

test("the neck reaches the player's left hand", () => {
  const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5 }));
  pose[11] = { x: 0.66, y: 0.32 };
  pose[12] = { x: 0.34, y: 0.32 };
  pose[15] = { x: 0.8, y: 0.5 };
  pose[16] = { x: 0.4, y: 0.58 };
  pose[23] = { x: 0.62, y: 0.74 };
  pose[24] = { x: 0.38, y: 0.74 };
  const hold = solveHold(pose, []);
  assert.ok(hold);
  assert.ok(hold.nut.x > hold.bridge.x);
  assert.ok(hold.nut.y < hold.tail.y);
});
