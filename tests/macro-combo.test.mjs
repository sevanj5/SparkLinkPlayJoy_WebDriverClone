import assert from "node:assert/strict";
import test from "node:test";
import * as c from "../web/local/macro-combo.mjs";
import * as m from "../web/local/macro-protocol.mjs";

const fromHex = text => Uint8Array.from(text.trim().split(/\s+/).map(h => parseInt(h, 16)));
const pad = bytes => { const out = new Uint8Array(64); out.set(bytes); return out; };

// Frames captured from a real Carotmas Mer68 MAX (read-only probe, macro ids 0-2).
const REAL = {
  0: "07 03 00 00 e0 00 02 80 e1 00 0b 80 21 00 02 80 21 00 03 00 e0 00 03 00 e1 00 02 00",
  1: "07 03 01 00 e0 00 02 80 e1 00 05 80 1e 00 02 80 1e 00 04 00 e1 00 02 00 e0 00 02 00",
  2: "07 03 02 00 e0 00 02 80 e1 00 0b 80 20 00 02 80 20 00 03 00 e0 00 03 00 e1 00 02 00",
};
test("real captured macros decode to the expected key sequences", () => {
  assert.equal(c.describeActions(m.parseMacroData(pad(fromHex(REAL[0]))).actions), "Ctrl↓ Shift↓ 4↓ 4↑ Ctrl↑ Shift↑");
  assert.equal(c.describeActions(m.parseMacroData(pad(fromHex(REAL[1]))).actions), "Ctrl↓ Shift↓ 1↓ 1↑ Shift↑ Ctrl↑");
  assert.equal(c.describeActions(m.parseMacroData(pad(fromHex(REAL[2]))).actions), "Ctrl↓ Shift↓ 3↓ 3↑ Ctrl↑ Shift↑");
});
test("re-encoding a real macro reproduces the captured bytes exactly", () => {
  for (const [id, hexText] of Object.entries(REAL)) {
    const captured = pad(fromHex(hexText));
    const { actions } = m.parseMacroData(captured);
    const live = actions.slice(0, 6);
    const rebuilt = m.buildWriteMacro({ macroId: Number(id), offset: 0, actions: live });
    rebuilt[1] = 3; // a read reply echoes command 3; a write uses 4
    assert.deepEqual(Array.from(rebuilt.subarray(0, 28)), Array.from(captured.subarray(0, 28)));
  }
});
test("combo parsing", () => {
  assert.deepEqual(c.parseCombo("Ctrl+Shift+4"), { modifiers: [0xe0, 0xe1], key: 0x21, label: "Ctrl+Shift+4" });
  assert.equal(c.parseCombo("alt+f4").key, 0x3d);
  assert.equal(c.parseCombo("win+left").key, 0x50);
  assert.equal(c.parseCombo("a").modifiers.length, 0);
  assert.throws(() => c.parseCombo("ctrl+shift"), /non-modifier/);
  assert.throws(() => c.parseCombo("ctrl+banana"), /unknown key/);
  assert.throws(() => c.parseCombo("fn+c"), /not a modifier/);
});
test("HID usage table spot checks", () => {
  const usage = name => c.parseCombo(name).key;
  assert.equal(usage("a"), 0x04); assert.equal(usage("z"), 0x1d); assert.equal(usage("1"), 0x1e);
  assert.equal(usage("9"), 0x26); assert.equal(usage("0"), 0x27); assert.equal(usage("f1"), 0x3a);
  assert.equal(usage("f12"), 0x45); assert.equal(usage("space"), 0x2c); assert.equal(usage("delete"), 0x4c);
});
test("steps: parsing, comments, per-step wait", () => {
  const steps = c.parseSteps("# copy then paste\nctrl+c 50\n\nctrl+v");
  assert.equal(steps.length, 2);
  assert.equal(steps[0].waitMs, 50); assert.equal(steps[1].waitMs, undefined);
  assert.throws(() => c.parseSteps("ctrl+c 50 60"), /line 1/);
});
test("sequence is balanced, round-trips, and honours tick size", () => {
  const steps = c.parseSteps("ctrl+shift+c 100\nalt+tab");
  const actions = c.buildSequence(steps, { tickMs: 10, holdMs: 20, gapMs: 10 });
  assert.equal(actions.length, 10); // 6 for ctrl+shift+c, 4 for alt+tab
  assert.equal(actions.filter(a => a.status === 1).length, actions.filter(a => a.status === 0).length);
  assert.equal(c.describeActions(actions), "Ctrl↓ Shift↓ C↓ C↑ Shift↑ Ctrl↑ Alt↓ Tab↓ Tab↑ Alt↑");
  assert.equal(actions[5].delay, 10); // 100 ms wait at 10 ms/tick
  assert.equal(c.buildSequence(steps, { tickMs: 20 })[5].delay, 5);
  actions.forEach(a => assert.deepEqual(m.decodeAction(m.encodeAction(a)), a));
});
test("plan: data first, mode last; chunking by 15 actions", () => {
  const steps = c.parseSteps(Array(5).fill("ctrl+shift+a").join("\n")); // 5 x 6 = 30 actions
  const actions = c.buildSequence(steps);
  const plan = c.planWrite({ macroId: 3, actions });
  assert.equal(actions.length, 30);
  assert.deepEqual(plan.dataFrames.map(d => d.offset), [0, 15]);
  assert.equal(c.planWrite({ macroId: 3, actions, offsetUnit: "byte" }).dataFrames[1].offset, 60);
  assert.ok(plan.warnings.some(w => /offset/.test(w)));
  assert.equal(plan.modeFrame[1], 2); assert.equal(plan.modeFrame[3], 1); assert.equal(plan.modeFrame[4], 30);
  assert.deepEqual(c.decodePlannedActions(plan, actions.length), actions);
  assert.throws(() => c.planWrite({ macroId: 3, actions: [] }), /no actions/);
});
