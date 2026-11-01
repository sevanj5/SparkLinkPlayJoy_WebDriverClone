import {
  buildSpaceInfoQuery, buildReadMacroMode, buildReadMacro, parseSpaceInfo, parseMacroMode,
  parseMacroData, isReadOnlyFrame, isUnsupportedReply, asBytes, hex,
} from "./macro-protocol.mjs";

const $ = id => document.getElementById(id);
const logEl = $("log");
let device = null;
let busy = false;
const lines = [];

function log(text, cls = "") {
  lines.push(text);
  if (lines.length === 1) logEl.textContent = "";
  const span = document.createElement("span");
  if (cls) span.className = cls;
  span.textContent = text + "\n";
  logEl.append(span);
  logEl.scrollTop = logEl.scrollHeight;
}

function setEnabled(on) {
  for (const id of ["space", "mode", "data", "all"]) $(id).disabled = !on || busy;
}

if (!navigator.hid) {
  $("deviceInfo").textContent = "WebHID is not available. Use Chrome or Edge on http://127.0.0.1 (see README).";
  $("connect").disabled = true;
}

$("connect").addEventListener("click", async () => {
  try {
    const filters = $("allHid").checked ? [] : [{ usagePage: 0xffb0, usage: 1 }];
    const picked = await navigator.hid.requestDevice({ filters });
    if (!picked.length) return log("No device selected.", "mut");
    if (device?.opened) await device.close();
    device = picked[0];
    if (!device.opened) await device.open();
    const cols = (device.collections ?? []).map(c => `0x${c.usagePage.toString(16)}/${c.usage} out:${c.outputReports?.length ?? 0} in:${c.inputReports?.length ?? 0}`).join("; ");
    $("deviceInfo").textContent = `${device.productName || "(unnamed)"}  VID ${device.vendorId} (0x${device.vendorId.toString(16)})  PID ${device.productId} (0x${device.productId.toString(16)})  collections: ${cols}`;
    log(`Connected: ${$("deviceInfo").textContent}`, "ok");
    setEnabled(true);
  } catch (error) {
    log(`Connect failed: ${error.message}`, "bad");
  }
});

/** Send one read-only frame and wait for the next input report. */
function query(frame, timeoutMs = 1500) {
  if (!isReadOnlyFrame(frame)) throw new Error("Refusing to send: frame is not on the read-only allowlist");
  return new Promise(async (resolve, reject) => {
    const timer = setTimeout(() => { device.removeEventListener("inputreport", onReport); resolve(null); }, timeoutMs);
    function onReport(event) {
      clearTimeout(timer);
      device.removeEventListener("inputreport", onReport);
      resolve({ reportId: event.reportId, bytes: asBytes(event.data) });
    }
    device.addEventListener("inputreport", onReport);
    try {
      await device.sendReport(0, frame);
    } catch (error) {
      clearTimeout(timer);
      device.removeEventListener("inputreport", onReport);
      reject(error);
    }
  });
}

async function run(label, frame, parse) {
  if (!device || busy) return null;
  busy = true; setEnabled(true);
  try {
    log(`\n> ${label}`);
    log(`  tx ${hex(frame, 16)} …`, "mut");
    const reply = await query(frame);
    if (!reply) { log("  no response within 1.5 s", "bad"); return null; }
    log(`  rx (reportId ${reply.reportId}, ${reply.bytes.length} bytes) ${hex(reply.bytes)}`, "mut");
    if (isUnsupportedReply(frame, reply.bytes)) {
      log("  firmware answered 0xFF: this command is not supported by the device", "bad");
      return { parsed: null, unsupported: true, bytes: reply.bytes };
    }
    const echoed = reply.bytes[0] === frame[0] && reply.bytes[1] === frame[1];
    log(`  header echo ${echoed ? "matches" : "DIFFERS"} (tx ${hex(frame, 2)} / rx ${hex(reply.bytes, 2)})`, echoed ? "ok" : "bad");
    const parsed = parse(reply.bytes);
    log(`  parsed ${JSON.stringify(parsed)}`);
    return { parsed, bytes: reply.bytes };
  } catch (error) {
    log(`  error: ${error.message}`, "bad");
    return null;
  } finally {
    busy = false; setEnabled(!!device);
  }
}

const macroId = () => Number($("macroId").value) || 0;
const offset = () => Number($("offset").value) || 0;

$("space").addEventListener("click", () => run("macro space info", buildSpaceInfoQuery(), parseSpaceInfo));
$("mode").addEventListener("click", () => run(`macro mode, id ${macroId()}`, buildReadMacroMode(macroId()), parseMacroMode));
$("data").addEventListener("click", () => run(`macro data, id ${macroId()} offset ${offset()}`, buildReadMacro(macroId(), offset()), parseMacroData));

const SCAN_IDS = 16; // upstream mouse bundle lists macro keys M0-M15; used when the device can't report a count

$("all").addEventListener("click", async () => {
  const info = await run("macro space info", buildSpaceInfoQuery(), parseSpaceInfo);
  let count = info?.parsed?.macroCount;
  if (!count) {
    log(`Macro count unavailable (${info?.unsupported ? "query unsupported" : "no answer"}); scanning IDs 0-${SCAN_IDS - 1} directly.`, "mut");
    count = SCAN_IDS;
  }
  let supported = 0;
  for (let id = 0; id < count; id++) {
    const mode = await run(`macro mode, id ${id}`, buildReadMacroMode(id), parseMacroMode);
    if (mode?.unsupported) { log(`Mode read is unsupported too; stopping scan at id ${id}.`, "bad"); break; }
    if (!mode) continue;
    supported++;
    if (mode.parsed.valid && mode.parsed.actNum > 0) await run(`macro data, id ${id} offset 0`, buildReadMacro(id, 0), parseMacroData);
  }
  log(`\nDone. ${supported} mode reads answered.`, "ok");
});

$("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(lines.join("\n")); log("(log copied)", "mut"); }
  catch { log("Copy failed; select the log text manually.", "bad"); }
});
$("clear").addEventListener("click", () => { lines.length = 0; logEl.textContent = "Nothing yet."; });
