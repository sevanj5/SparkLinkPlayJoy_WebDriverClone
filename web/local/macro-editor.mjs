import { parseSteps, buildSequence, planWrite, decodePlannedActions, describeActions, keyName } from "./macro-combo.mjs";
import { hex } from "./macro-protocol.mjs";

const $ = id => document.getElementById(id);
const num = (id, fallback) => { const v = Number($(id).value); return Number.isFinite(v) && v > 0 ? v : fallback; };

function render() {
  const status = $("status"), warnings = $("warnings"), table = $("actions"), frames = $("frames");
  warnings.replaceChildren(); table.replaceChildren(); frames.textContent = "";
  try {
    const steps = parseSteps($("steps").value);
    if (!steps.length) throw new Error("add at least one combo");
    const tickMs = num("tick", 10);
    const actions = buildSequence(steps, { tickMs, holdMs: num("hold", 20), gapMs: num("gap", 10) });
    const slot = Number($("slot").value);
    if (!Number.isInteger(slot) || slot < 0 || slot > 255) throw new Error("macro slot must be 0-255");
    const plan = planWrite({ macroId: slot, actions, offsetUnit: $("unit").value });
    const roundTrip = JSON.stringify(decodePlannedActions(plan, actions.length)) === JSON.stringify(actions);

    status.className = roundTrip ? "ok" : "bad";
    status.textContent = `${steps.map(s => s.label).join("  →  ")}  =  ${actions.length} actions in ${plan.dataFrames.length} data frame(s)` +
      (roundTrip ? "  ·  decode of the built frames matches" : "  ·  ROUND-TRIP MISMATCH, do not use");

    for (const text of plan.warnings) {
      const p = document.createElement("p"); p.className = "warn"; p.textContent = "⚠ " + text; warnings.append(p);
    }

    table.innerHTML = "<tr><th>#</th><th>key</th><th>action</th><th>delay (ticks)</th><th>≈ ms</th></tr>";
    actions.forEach((a, i) => {
      const row = table.insertRow();
      for (const text of [i, keyName(a.keyCode), a.status ? "down ↓" : "up ↑", a.delay, a.delay * tickMs]) row.insertCell().textContent = text;
    });

    const out = [`# ${describeActions(actions)}`];
    plan.dataFrames.forEach(({ offset, frame }, i) => out.push(`data ${i + 1}/${plan.dataFrames.length} (offset ${offset}):\n${hex(frame, 4 + Math.min(15, actions.length - i * 15) * 4)}`));
    out.push(`mode (written last, marks the macro valid):\n${hex(plan.modeFrame, 9)}`);
    frames.textContent = out.join("\n\n");
    frames.className = "";
  } catch (error) {
    status.className = "bad"; status.textContent = error.message; frames.textContent = "";
  }
}

for (const id of ["steps", "slot", "tick", "hold", "gap", "unit"]) $(id).addEventListener("input", render);
render();
