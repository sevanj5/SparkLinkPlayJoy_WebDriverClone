/**
 * Keyboard V2 macro protocol (pure functions, no I/O).
 *
 * Reverse-read from the upstream bundle keyboard/js/esm-BSNVEyo2.js
 * (macroProtocol: Er / Tr / Dr, GFSMacroSpaceInfoGet). Frames are 64-byte
 * HID output reports sent with reportId 0.
 *
 * VERIFIED from code:  frame layouts, 4-byte action layout, little-endian u16.
 * NOT VERIFIED on hardware: meaning of status 0/1, meaning of `mode`, whether
 * `offset` counts actions or bytes, whether keyCode uses the layout keycode table.
 */
export const REPORT_SIZE = 64;
export const GROUP_GLOBAL = 2;
export const GROUP_MACRO = 7;
export const CMD_MACRO_SPACE_INFO = 14;
export const CMD = Object.freeze({ GetMacroMode: 1, SetMacroMode: 2, GetMacro: 3, SetMacro: 4 });
export const ACTIONS_PER_FRAME = 15; // response carries bytes 4..63 = 60 bytes = 15 actions
export const MAX_DELAY = 0x7fff;
export const MAX_KEYCODE = 0xffff;

// Modifier bitmask used by the V2 "combined key" feature (custom-key page).
export const MODIFIER = Object.freeze({ ctrl: 1, shift: 2, alt: 4, win: 8 });

const u8 = (n, name) => {
  if (!Number.isInteger(n) || n < 0 || n > 255) throw new RangeError(`${name} must be 0-255`);
  return n;
};
const u16 = (n, name) => {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new RangeError(`${name} must be 0-65535`);
  return n;
};
const lo = n => n & 0xff;
const hi = n => (n >> 8) & 0xff;
const pad = bytes => {
  if (bytes.length > REPORT_SIZE) throw new RangeError(`frame exceeds ${REPORT_SIZE} bytes`);
  const out = new Uint8Array(REPORT_SIZE);
  out.set(bytes);
  return out;
};
export const asBytes = data => data instanceof Uint8Array ? data : data instanceof DataView
  ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : Uint8Array.from(data);
const u16le = (bytes, i) => bytes[i] | (bytes[i + 1] << 8);

/* ---------- actions ---------- */
export function encodeAction({ status, delay, keyCode }) {
  if (delay > MAX_DELAY) throw new RangeError(`delay exceeds ${MAX_DELAY}`);
  if (keyCode > MAX_KEYCODE) throw new RangeError("keyCode exceeds 0xFFFF");
  if (!Number.isInteger(delay) || delay < 0 || !Number.isInteger(keyCode) || keyCode < 0) {
    throw new RangeError("delay and keyCode must be non-negative integers");
  }
  const word = ((status === 1 ? 1 : 0) << 31) | (delay << 16) | (keyCode & 0xffff);
  return [word & 255, (word >>> 8) & 255, (word >>> 16) & 255, (word >>> 24) & 255];
}

export function decodeAction(b) {
  const word = b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24);
  return { status: (word >> 31) & 1, delay: (word >> 16) & 0x7fff, keyCode: word & 0xffff };
}

/* ---------- read frames (safe) ---------- */
export const buildSpaceInfoQuery = () => pad([GROUP_GLOBAL, CMD_MACRO_SPACE_INFO, 0]);
export const buildReadMacroMode = macroId => pad([GROUP_MACRO, CMD.GetMacroMode, u8(macroId, "macroId")]);
export const buildReadMacro = (macroId, offset = 0) =>
  pad([GROUP_MACRO, CMD.GetMacro, u8(macroId, "macroId"), u8(offset, "offset")]);

/* ---------- write frames (encode only; nothing in this repo sends them yet) ---------- */
export const buildWriteMacroMode = ({ macroId, valid, actNum, repNum, mode }) => pad([
  GROUP_MACRO, CMD.SetMacroMode, u8(macroId, "macroId"), valid ? 1 : 0,
  lo(u16(actNum, "actNum")), hi(actNum), lo(u16(repNum, "repNum")), hi(repNum), u8(mode, "mode"),
]);
export function buildWriteMacro({ macroId, offset, actions }) {
  if (actions.length > ACTIONS_PER_FRAME) throw new RangeError(`at most ${ACTIONS_PER_FRAME} actions per frame`);
  return pad([GROUP_MACRO, CMD.SetMacro, u8(macroId, "macroId"), u8(offset, "offset"), ...actions.flatMap(encodeAction)]);
}

/* ---------- response parsers ---------- */
export function parseSpaceInfo(data) {
  const b = asBytes(data);
  return { macroCount: b[3], macroNumber: u16le(b, 4) };
}
export function parseMacroMode(data) {
  const b = asBytes(data);
  return { macroId: b[2], valid: b[3] === 1, actNum: u16le(b, 4), repNum: u16le(b, 6), mode: b[8] };
}
export function parseMacroData(data) {
  const b = asBytes(data);
  const actions = [];
  for (let i = 4; i + 4 <= 64 && i + 4 <= b.length; i += 4) actions.push(decodeAction(b.subarray(i, i + 4)));
  return { macroId: b[2], offset: b[3], actions };
}

/* ---------- safety: the probe may only send these ---------- */
export function isReadOnlyFrame(frame) {
  const b = asBytes(frame);
  if (b.length !== REPORT_SIZE) return false;
  if (b[0] === GROUP_GLOBAL) return b[1] === CMD_MACRO_SPACE_INFO && b[2] === 0 && b.subarray(3).every(x => x === 0);
  if (b[0] === GROUP_MACRO) {
    if (b[1] === CMD.GetMacroMode) return b.subarray(3).every(x => x === 0);
    if (b[1] === CMD.GetMacro) return b.subarray(4).every(x => x === 0);
  }
  return false;
}

export const hex = (data, max = REPORT_SIZE) =>
  Array.from(asBytes(data).subarray(0, max), x => x.toString(16).padStart(2, "0")).join(" ");
