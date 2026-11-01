/**
 * Combo sequences -> V2 macro actions (pure functions, no I/O).
 *
 * Confirmed from a read-only probe of a Carotmas Mer68 MAX:
 *   status 1 = key down, status 0 = key up; keyCode = USB HID keyboard usage ID
 *   (0xE0 LCtrl, 0xE1 LShift, 0x1E '1', 0x20 '3', 0x21 '4'); 15 actions per frame.
 * ASSUMED, not yet measured: one `delay` tick = 10 ms and the delay applies after
 * its action; chunk `offset` counts actions. Both are exposed as options so the
 * dry-run output makes the assumption visible.
 */
import { ACTIONS_PER_FRAME, buildWriteMacro, buildWriteMacroMode, decodeAction, encodeAction, asBytes } from "./macro-protocol.mjs";

export const MODIFIER_USAGE = Object.freeze({
  ctrl: 0xe0, control: 0xe0, shift: 0xe1, alt: 0xe2, option: 0xe2,
  win: 0xe3, gui: 0xe3, cmd: 0xe3, meta: 0xe3, super: 0xe3,
});

const NAMED = {
  enter: 0x28, return: 0x28, esc: 0x29, escape: 0x29, backspace: 0x2a, tab: 0x2b, space: 0x2c,
  "-": 0x2d, "=": 0x2e, "[": 0x2f, "]": 0x30, "\\": 0x31, ";": 0x33, "'": 0x34, "`": 0x35, ",": 0x36, ".": 0x37, "/": 0x38,
  capslock: 0x39, printscreen: 0x46, scrolllock: 0x47, pause: 0x48, insert: 0x49, home: 0x4a, pageup: 0x4b,
  delete: 0x4c, del: 0x4c, end: 0x4d, pagedown: 0x4e, right: 0x4f, left: 0x50, down: 0x51, up: 0x52,
};
const KEY_USAGE = new Map(Object.entries(NAMED));
for (let i = 0; i < 26; i++) KEY_USAGE.set(String.fromCharCode(97 + i), 0x04 + i);
for (let i = 1; i <= 9; i++) KEY_USAGE.set(String(i), 0x1d + i);
KEY_USAGE.set("0", 0x27);
for (let i = 1; i <= 12; i++) KEY_USAGE.set(`f${i}`, 0x39 + i);

const DISPLAY = new Map([[0xe0, "Ctrl"], [0xe1, "Shift"], [0xe2, "Alt"], [0xe3, "Win"], [0xe4, "RCtrl"], [0xe5, "RShift"], [0xe6, "RAlt"], [0xe7, "RWin"]]);
for (const [name, usage] of KEY_USAGE) {
  if (!DISPLAY.has(usage)) DISPLAY.set(usage, name.length === 1 ? name.toUpperCase() : name[0].toUpperCase() + name.slice(1));
}
export const keyName = usage => DISPLAY.get(usage) ?? `0x${usage.toString(16).padStart(2, "0")}`;

/** "Ctrl+Shift+4" -> { modifiers: [0xe0, 0xe1], key: 0x21, label } */
export function parseCombo(text) {
  const parts = text.split("+").map(p => p.trim().toLowerCase()).filter(Boolean);
  if (text.trim().endsWith("+")) throw new Error(`"${text}": "+" itself is not supported as a key`);
  if (!parts.length) throw new Error("empty combo");
  const keyToken = parts.pop();
  const modifiers = [];
  for (const token of parts) {
    const usage = MODIFIER_USAGE[token];
    if (usage === undefined) throw new Error(`"${token}" is not a modifier (use ctrl, shift, alt or win)`);
    if (!modifiers.includes(usage)) modifiers.push(usage);
  }
  if (MODIFIER_USAGE[keyToken] !== undefined) throw new Error(`"${text}": a combo needs a non-modifier key last`);
  const key = KEY_USAGE.get(keyToken);
  if (key === undefined) throw new Error(`unknown key "${keyToken}"`);
  return { modifiers, key, label: [...modifiers, key].map(keyName).join("+") };
}

/** One step per non-empty line: "<combo> [waitMs]"; lines starting with # are ignored. */
export function parseSteps(text) {
  const steps = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const match = /^(\S+)(?:\s+(\d+))?$/.exec(line);
    if (!match) throw new Error(`line ${index + 1}: expected "<combo> [waitMs]"`);
    try { steps.push({ ...parseCombo(match[1]), waitMs: match[2] === undefined ? undefined : Number(match[2]) }); }
    catch (error) { throw new Error(`line ${index + 1}: ${error.message}`); }
  });
  return steps;
}

/** Each combo: modifiers down, key down, key up, modifiers up (reverse order). */
export function buildSequence(steps, { tickMs = 10, holdMs = 20, gapMs = 10 } = {}) {
  if (!(tickMs > 0)) throw new RangeError("tickMs must be positive");
  const ticks = ms => Math.max(1, Math.round(ms / tickMs));
  const actions = [];
  for (const step of steps) {
    for (const modifier of step.modifiers) actions.push({ status: 1, delay: ticks(gapMs), keyCode: modifier });
    actions.push({ status: 1, delay: ticks(holdMs), keyCode: step.key });
    actions.push({ status: 0, delay: ticks(gapMs), keyCode: step.key });
    for (const modifier of [...step.modifiers].reverse()) actions.push({ status: 0, delay: ticks(gapMs), keyCode: modifier });
    if (step.waitMs !== undefined) actions[actions.length - 1].delay = ticks(Math.max(gapMs, step.waitMs));
  }
  return actions;
}

/** "Ctrl↓ Shift↓ 4↓ 4↑ Ctrl↑ Shift↑" */
export const describeActions = actions => actions
  .filter(a => !(a.status === 0 && a.delay === 0 && a.keyCode === 0))
  .map(a => `${keyName(a.keyCode)}${a.status ? "↓" : "↑"}`).join(" ");

/**
 * Frames for writing `actions` into `macroId`: data frames first, then the mode record,
 * so a half-written macro is never marked valid.
 */
export function planWrite({ macroId, actions, offsetUnit = "action", repNum = 0, mode = 1 }) {
  if (!actions.length) throw new Error("no actions to write");
  actions.forEach(encodeAction); // range check
  const dataFrames = [];
  for (let chunk = 0; chunk * ACTIONS_PER_FRAME < actions.length; chunk++) {
    const slice = actions.slice(chunk * ACTIONS_PER_FRAME, (chunk + 1) * ACTIONS_PER_FRAME);
    const offset = offsetUnit === "byte" ? chunk * ACTIONS_PER_FRAME * 4 : chunk * ACTIONS_PER_FRAME;
    dataFrames.push({ offset, frame: buildWriteMacro({ macroId, offset, actions: slice }) });
  }
  const modeFrame = buildWriteMacroMode({ macroId, valid: 1, actNum: actions.length, repNum, mode });
  const warnings = [];
  if (dataFrames.length > 1) warnings.push(`${dataFrames.length} data frames: whether "offset" counts actions or bytes has not been measured on the device (assumed: ${offsetUnit}s).`);
  warnings.push("Delay unit (assumed ticks of tickMs) and mode/repeat values (copied from the existing macros: mode 1, repeat 0) have not been measured on the device.");
  return { dataFrames, modeFrame, warnings };
}

/** Decode the actions that planWrite's data frames would store (round-trip self-check). */
export function decodePlannedActions(plan, count) {
  const out = [];
  for (const { frame } of plan.dataFrames) {
    const bytes = asBytes(frame);
    for (let i = 4; i + 4 <= bytes.length; i += 4) out.push(decodeAction(bytes.subarray(i, i + 4)));
  }
  return out.slice(0, count);
}
