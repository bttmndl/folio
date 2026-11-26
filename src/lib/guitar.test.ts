import assert from "node:assert/strict";
import test from "node:test";
import { chordLabel, fretAt, midiFor } from "./guitar.ts";

test("open string is fret 0 and the 12th fret is the octave", () => {
  assert.equal(fretAt(0), 0);
  assert.equal(fretAt(1), 12);
  assert.equal(midiFor(0, 12), 76);
  assert.equal(midiFor(5, 0), 40);
});

test("an E major shape is named", () => {
  assert.equal(chordLabel([0, 0, 1, 2, 2, 0]), "E");
});
