import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import * as m from "../web/local/macro-protocol.mjs";

// Load the upstream encoder (Er/Tr) straight from the shipped bundle and compare byte-for-byte.
const bundle = readFileSync(new URL("../web/keyboard/js/esm-BSNVEyo2.js", import.meta.url), "utf8");
const start = bundle.indexOf("Tr=(e,t)=>{let n=e===`Write`?wr:Cr");
const end = bundle.indexOf(",{Performance:Or}", start);
const upstream = vm.createContext({ br: 7, wr: 2, Cr: 1, Sr: 4, xr: 3, N: n => [n & 255, (n >> 8) & 255], Je: () => null });
vm.runInContext(`var ${bundle.slice(start, end)}; this.Tr = Tr; this.Er = Er;`, upstream);
const same = (frame, bytes) => assert.deepEqual(Array.from(frame.subarray(0, bytes.length)), Array.from(bytes)); // Array.from: vm arrays are cross-realm

test("write-macro frame matches upstream Er", () => {
  const actions = [{ status: 0, delay: 0, keyCode: 0xe0 }, { status: 1, delay: 50, keyCode: 6 }, { status: 0, delay: 32767, keyCode: 0xffff }];
  same(m.buildWriteMacro({ macroId: 3, offset: 0, actions }), upstream.Er("Write", { macroId: 3, offset: 0, actions }));
});
test("read frames match upstream", () => {
  same(m.buildReadMacro(2, 15), upstream.Er("Read", { macroId: 2, offset: 15 }));
  same(m.buildReadMacroMode(5), upstream.Tr("Read", { macroId: 5 }));
});
test("mode write matches upstream Tr", () => {
  const arg = { macroId: 1, valid: 1, actNum: 300, repNum: 2, mode: 1 };
  same(m.buildWriteMacroMode(arg), upstream.Tr("Write", arg));
});
test("action round-trips including the status bit", () => {
  for (const a of [{ status: 0, delay: 0, keyCode: 4 }, { status: 1, delay: 32767, keyCode: 0xffff }, { status: 1, delay: 1, keyCode: 0 }]) {
    assert.deepEqual(m.decodeAction(m.encodeAction(a)), a);
  }
});
test("out-of-range values are rejected", () => {
  assert.throws(() => m.encodeAction({ status: 0, delay: 32768, keyCode: 1 }), RangeError);
  assert.throws(() => m.encodeAction({ status: 0, delay: 0, keyCode: 0x10000 }), RangeError);
  assert.throws(() => m.buildWriteMacro({ macroId: 0, offset: 0, actions: Array(16).fill({ status: 0, delay: 0, keyCode: 1 }) }), RangeError);
});
test("responses parse", () => {
  const info = new Uint8Array(64); info.set([2, 14, 0, 16, 0x00, 0x04]);
  assert.deepEqual(m.parseSpaceInfo(info), { macroCount: 16, macroNumber: 1024 });
  const mode = new Uint8Array(64); mode.set([7, 1, 4, 1, 0x2c, 1, 3, 0, 2]);
  assert.deepEqual(m.parseMacroMode(mode), { macroId: 4, valid: true, actNum: 300, repNum: 3, mode: 2 });
  const data = new Uint8Array(64); data.set([7, 3, 1, 0, ...m.encodeAction({ status: 1, delay: 20, keyCode: 7 })]);
  const parsed = m.parseMacroData(data);
  assert.equal(parsed.actions.length, 15);
  assert.deepEqual(parsed.actions[0], { status: 1, delay: 20, keyCode: 7 });
});
test("read-only guard rejects every write command", () => {
  assert.ok(m.isReadOnlyFrame(m.buildSpaceInfoQuery()));
  assert.ok(m.isReadOnlyFrame(m.buildReadMacroMode(0)));
  assert.ok(m.isReadOnlyFrame(m.buildReadMacro(0, 0)));
  assert.ok(!m.isReadOnlyFrame(m.buildWriteMacro({ macroId: 0, offset: 0, actions: [] })));
  assert.ok(!m.isReadOnlyFrame(m.buildWriteMacroMode({ macroId: 0, valid: 1, actNum: 0, repNum: 1, mode: 0 })));
  const sneaky = m.buildReadMacro(0, 0); sneaky[40] = 1;
  assert.ok(!m.isReadOnlyFrame(sneaky));
  assert.ok(!m.isReadOnlyFrame(new Uint8Array(64).fill(0)));
});
