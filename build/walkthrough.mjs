/**
 * DEV-ONLY verification harness. Not part of the shipped app.
 * Drives the real UI with Chrome DevTools Protocol (Node built-ins only).
 * Simulates a first run with a fresh APPDATA and a Desktop copy of the app.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DESKTOP = execFileSync("powershell", ["-NoProfile", "-Command", "[Environment]::GetFolderPath('Desktop')"], { encoding: "utf8" }).trim();
const APP_DIR = path.join(DESKTOP, "SqueezeIt");
const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "sq-walk-"));
const APPDATA = path.join(TEST_ROOT, "appdata");
const SAMPLES = path.join(TEST_ROOT, "samples");
const CDP_PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

function record(name, status, detail = "") {
  results.push({ name, status, detail });
  console.log(`${status.padEnd(10)} ${name}${detail ? ` — ${detail}` : ""}`);
}
function sha(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function ps(script) {
  const r = spawnSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" });
  return { status: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name); const d = path.join(to, e.name);
    if (e.isDirectory()) copyTree(s, d); else fs.copyFileSync(s, d);
  }
}
function makeSamples() {
  const ffmpeg = "ffmpeg.exe";
  const video = path.join(SAMPLES, "holiday.mp4");
  const img = path.join(SAMPLES, "photo.png");
  const pdf = path.join(SAMPLES, "notes.pdf");
  const v = spawnSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=15", "-t", "3", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", video]);
  const i = spawnSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=640x480:rate=1", "-frames:v", "1", img]);
  if (v.status || i.status) throw new Error("sample generation failed");
  fs.writeFileSync(pdf, "%PDF-1.4\nnot a real pdf\n");
  return [video, img, pdf];
}

// ---- minimal CDP client ----
let wsSeq = 0;
const pending = new Map();
let ws;
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++wsSeq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function connectCdp() {
  let target;
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      target = list.find((t) => t.type === "page");
      if (target) break;
    } catch { /* not ready */ }
    await sleep(100);
  }
  if (!target) throw new Error("Chrome DevTools target not found");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    }
  };
  await cdp("Runtime.enable");
  await cdp("Page.enable");
}
async function evaluate(expression) {
  const r = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: false });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}
async function screenshot(file) {
  const r = await cdp("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(file, Buffer.from(r.data, "base64"));
}

function driveOpenDialog(filePath) {
  // The dialog keeps the custom title set by app/lib/dialogs.mjs.
  const script = `
    for ($i=0; $i -lt 60; $i++) {
      $ws = New-Object -ComObject WScript.Shell
      if ($ws.AppActivate('Choose files to make smaller')) {
        Start-Sleep -Milliseconds 400
        $ws.SendKeys('${filePath}')
        Start-Sleep -Milliseconds 400
        $ws.SendKeys('{ENTER}')
        break
      }
      Start-Sleep -Milliseconds 250
    }
  `;
  return spawnSync("powershell", ["-NoProfile", "-STA", "-Command", script], { encoding: "utf8" });
}

async function waitFor(fn, timeout = 30000, label = "condition") {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return true;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  fs.mkdirSync(APPDATA, { recursive: true });
  fs.mkdirSync(SAMPLES, { recursive: true });
  if (fs.existsSync(APP_DIR)) throw new Error(`Refusing to overwrite existing ${APP_DIR}`);
  if (fs.existsSync(path.join(DESKTOP, "SqueezeIt.lnk"))) throw new Error("An existing SqueezeIt shortcut is present; aborting");

  // Step 1: extract (simulated by copying the staged folder to the Desktop)
  copyTree(path.join(ROOT, "dist", "SqueezeIt"), APP_DIR);
  record("Step 1-2: folder appears on Desktop", fs.existsSync(path.join(APP_DIR, "Start SqueezeIt.vbs")) ? "PASS" : "FAIL");

  const originals = makeSamples();
  const before = originals.map(sha);
  const appFilesBefore = fs.readdirSync(APP_DIR, { withFileTypes: true }).map((e) => e.name).sort();

  // Step 3: double-click the .vbs via the Windows shell association
  const logFile = path.join(APPDATA, "SqueezeIt", "SqueezeIt.log");
  const env = { ...process.env, APPDATA };
  ps(`$env:APPDATA='${APPDATA}'; $env:SQUEEZEIT_TEST_LOG_TOKEN='1'; Invoke-Item '${path.join(APP_DIR, "Start SqueezeIt.vbs")}'`);
  let url = null;
  await waitFor(async () => {
    if (!fs.existsSync(logFile)) return false;
    const text = fs.readFileSync(logFile, "utf8");
    const match = text.match(/SqueezeIt ready at (http:\/\/127\.0\.0\.1:\d+\/\?t=[a-f0-9]+)/);
    if (match) { url = match[1]; return true; }
    return false;
  }, 30000, "app startup");
  record("Step 3: double-click Start SqueezeIt.vbs starts app", "PASS", url.replace(/t=.*/, "t=***"));

  // Step 5: desktop shortcut
  const shortcut = ps(`$ws=New-Object -ComObject WScript.Shell; $s=$ws.CreateShortcut('${path.join(DESKTOP, "SqueezeIt.lnk")}'); $s.TargetPath`);
  if (shortcut.out.toLowerCase().endsWith("start squeezeit.vbs")) {
    record("Step 5: Desktop icon points to Start SqueezeIt.vbs", "PASS", shortcut.out);
  } else {
    record("Step 5: Desktop icon points to Start SqueezeIt.vbs", "FAIL", `Target was '${shortcut.out}'`);
  }

  // Browser + CDP
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${path.join(TEST_ROOT, "chrome")}`,
    "--no-first-run", "--no-default-browser-check", "--new-window", url,
  ], { detached: true, stdio: "ignore" });
  await connectCdp();
  await waitFor(async () => (await evaluate("document.readyState")) === "complete", 20000, "page load");
  await sleep(1000);
  record("Step 3/4: browser shows SqueezeIt page on 127.0.0.1", (await evaluate("location.href")).startsWith("http://127.0.0.1:") ? "PASS" : "FAIL");
  await screenshot(path.join(TEST_ROOT, "01-first-screen.png"));

  // Step 6: welcome panel
  const welcomeVisible = await evaluate("!document.getElementById('welcome').hidden && document.getElementById('welcome').innerText.includes('Welcome to SqueezeIt')");
  if (welcomeVisible) {
    await evaluate("document.getElementById('welcome-close').click()");
    await sleep(300);
    record("Step 6: welcome panel shown with Got it button", "PASS");
  } else {
    record("Step 6: welcome panel shown with Got it button", "FAIL", "welcome panel was not visible");
  }
  const homeVisible = await evaluate("!document.getElementById('home').hidden && !!document.getElementById('choose-files') && !!document.getElementById('choose-folder')");
  record("Step 6: home shows Choose files / Choose a folder", homeVisible ? "PASS" : "FAIL");
  await screenshot(path.join(TEST_ROOT, "02-home.png"));

  // Network snapshot while running
  const nodePid = ps(`(Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -like '*app\\server.mjs*' } | Select-Object -First 1).ProcessId`).out;
  const net = nodePid ? ps(`Get-NetTCPConnection -OwningProcess ${nodePid} -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Established' } | Select-Object RemoteAddress,RemotePort | Format-Table -HideTableHeaders | Out-String`).out : "";
  const nonLocal = net.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("127.") && !l.startsWith("::1"));
  record("Check: no outbound network connection", nonLocal.length ? "FAIL" : "PASS", nonLocal.length ? nonLocal.join("; ") : "only loopback listeners");

  // Step 7: choose files (native dialog driven by SendKeys), then check list
  const keysPromise = (async () => {
    await sleep(800);
    driveOpenDialog(originals[0]);
  })();
  await evaluate("document.getElementById('choose-files').click()");
  await keysPromise;
  await waitFor(async () => (await evaluate("!document.getElementById('ready').hidden")), 30000, "file list");
  const rowCount = await evaluate("document.querySelectorAll('#file-list li').length");
  record("Step 7: Choose files shows a file list", rowCount === 1 ? "PASS" : "FAIL", `${rowCount} row(s)`);
  await screenshot(path.join(TEST_ROOT, "03-file-list.png"));

  // Step 8: make files smaller
  await evaluate("document.getElementById('start').click()");
  await waitFor(async () => (await evaluate("!document.getElementById('working').hidden")), 10000, "working screen");
  record("Step 8: working screen shows progress", "PASS");
  await screenshot(path.join(TEST_ROOT, "04-working.png"));
  await waitFor(async () => (await evaluate("!document.getElementById('finished').hidden")), 120000, "finished screen");
  const summary = await evaluate("document.getElementById('summary').innerText");
  record("Step 8: finished screen shows sizes", /went from/.test(summary) ? "PASS" : "FAIL", summary);
  await screenshot(path.join(TEST_ROOT, "05-done.png"));

  // Step 9: the new copy lives in a temporary folder, never beside the original
  const tempText = await evaluate("document.getElementById('output-path').innerText");
  const tempDir = tempText.slice(tempText.indexOf("): ") + 3).trim();
  const outputs = fs.existsSync(tempDir) ? fs.readdirSync(tempDir).filter((f) => !f.startsWith(".squeezeit-")).map((f) => path.join(tempDir, f)) : [];
  record("Step 9: temporary folder with (smaller) copy", outputs.some((f) => f.includes(" (smaller).")) ? "PASS" : "FAIL",
    outputs.map((f) => path.basename(f)).join(", ") || tempText);
  record("Step 9: temporary folder is inside %TEMP%", tempDir.startsWith(os.tmpdir()) ? "PASS" : "FAIL", tempDir);
  const besideOriginal = path.join(path.dirname(originals[0]), "Smaller files");
  record("Check: nothing was created beside the original", fs.existsSync(besideOriginal) ? "FAIL" : "PASS",
    fs.existsSync(besideOriginal) ? besideOriginal : "no output folder next to the source");
  const saveButtons = await evaluate("document.querySelectorAll('#done-list .row-save').length");
  record("Step 9: every result row has a Save button", saveButtons === outputs.length ? "PASS" : "FAIL", `${saveButtons} button(s)`);
  const saveState = await evaluate("document.getElementById('save-state').innerText");
  record("Step 9: the page says nothing is saved yet", /Not saved yet/.test(saveState) ? "PASS" : "FAIL", saveState);
  originals.forEach((file, i) => {
    record(`Check: original ${path.basename(file)} unchanged`, sha(file) === before[i] ? "PASS" : "FAIL");
  });
  const appFilesAfter = fs.readdirSync(APP_DIR, { withFileTypes: true }).map((e) => e.name).sort();
  record("Check: no files written inside app folder", JSON.stringify(appFilesBefore) === JSON.stringify(appFilesAfter) ? "PASS" : "FAIL",
    JSON.stringify(appFilesBefore) === JSON.stringify(appFilesAfter) ? "" : `added: ${appFilesAfter.filter((f) => !appFilesBefore.includes(f)).join(", ")}`);

  // Stop mid-job via a second batch with a long video
  const longVideo = path.join(SAMPLES, "long.mp4");
  spawnSync("ffmpeg.exe", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30", "-t", "25", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", longVideo]);
  const keysPromise2 = (async () => {
    await sleep(800);
    driveOpenDialog(longVideo);
  })();
  await evaluate("document.getElementById('make-more').click()");
  await evaluate("document.getElementById('choose-files').click()");
  await keysPromise2;
  await waitFor(async () => (await evaluate("!document.getElementById('ready').hidden")), 30000, "second file list");
  await evaluate("document.getElementById('start').click()");
  await sleep(700);
  await evaluate("document.getElementById('stop').click()");
  await waitFor(async () => (await evaluate("!document.getElementById('finished').hidden")), 30000, "stopped screen");
  const stopText = await evaluate("document.getElementById('output-path').innerText");
  const stopDir = stopText.slice(stopText.indexOf("): ") + 3).trim();
  const tempLeft = fs.existsSync(stopDir) ? fs.readdirSync(stopDir).filter((f) => f.startsWith(".squeezeit-")) : [];
  record("Check: Stop leaves no partial file", tempLeft.length === 0 ? "PASS" : "FAIL", tempLeft.join(", "));

  // Auto-exit after the tab closes (~60 s)
  await cdp("Page.close").catch(() => {});
  chrome.kill();
  let exited = false;
  for (let i = 0; i < 90; i++) {
    const alive = ps(`(Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -like '*app\\server.mjs*' } | Measure-Object).Count`).out;
    if (alive === "0") { exited = true; break; }
    await sleep(1000);
  }
  record("Check: server exits about 60 s after tab closes", exited ? "PASS" : "FAIL", exited ? "exited" : "still running after 90 s");

  // Second start via the desktop icon
  ps(`$env:APPDATA='${APPDATA}'; Invoke-Item '${path.join(DESKTOP, "SqueezeIt.lnk")}'`);
  let restarted = false;
  for (let i = 0; i < 50; i++) {
    const alive = ps(`(Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -like '*app\\server.mjs*' } | Measure-Object).Count`).out;
    if (alive !== "0") { restarted = true; break; }
    await sleep(200);
  }
  record("Check: desktop icon starts the app a second time", restarted ? "PASS" : "FAIL", restarted ? "started" : "did not start");

  console.log(`\nEvidence: ${TEST_ROOT}`);
  const pass = results.filter((r) => r.status === "PASS").length;
  console.log(`Summary: ${pass}/${results.length} passed`);
}

main().catch((e) => {
  console.error(`WALKTHROUGH TEST ERROR: ${e.message}`);
  console.error(`Evidence: ${TEST_ROOT}`);
  process.exit(1);
});
