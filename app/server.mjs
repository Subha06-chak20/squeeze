/**
 * SqueezeIt local server. Node built-ins only. No network calls, no uploads.
 * Binds 127.0.0.1 on a free port and requires a random token on every API call.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { resolveEngines, verifyEngines, PRODUCT_ROOT } from "./lib/engines.mjs";
import { loadSettings, saveSettings, log, workRoot } from "./lib/paths.mjs";
import { probeFile, scanFolder } from "./lib/analysis.mjs";
import { recommend, estimateOutputBytes } from "./lib/recommend.mjs";
import { chooseFiles, chooseFolder, chooseSaveTarget, createDesktopShortcut } from "./lib/dialogs.mjs";
import { outputName, uniquePath, targetExtension } from "./lib/naming.mjs";
import {
  buildVideoArgs,
  buildImageArgs,
  targetBitrates,
  hardwareTestArgs,
  HARDWARE_ENCODERS,
  parseProgress,
  parseSsim,
  qualityLabel,
} from "./lib/encoder.mjs";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
// Test hooks. In normal use these variables are unset: the token is random,
// the browser opens, and the port is chosen by the OS.
const token = process.env.SQUEEZEIT_TOKEN || crypto.randomBytes(32).toString("hex");
const engines = resolveEngines();
const settings = loadSettings();

function appVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(PRODUCT_ROOT, "package.json"), "utf8")).version || "1.1.0";
  } catch {
    return "1.1.0";
  }
}

const state = {
  lastSeen: Date.now(),
  notice: "",
  port: 0,
  hardwareEncoder: null,
  workDir: "",
  job: {
    running: false,
    cancelled: false,
    current: 0,
    done: 0,
    total: 0,
    percent: 0,
    etaSec: 0,
    elapsedSec: 0,
    activeName: "",
    phase: "Idle",
    startedAt: 0,
    fractions: new Map(),
    children: new Set(),
  },
  result: null,
};

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

/** Job folders left behind by a previous crash or forced close. */
function cleanStaleWork() {
  try {
    const root = workRoot();
    for (const name of fs.readdirSync(root)) {
      if (!name.startsWith("job-")) continue;
      try { fs.rmSync(path.join(root, name), { recursive: true, force: true }); } catch { /* still in use */ }
    }
  } catch { /* nothing to clean */ }
}

/** Scratch copies are never kept after the app closes; only saved copies stay. */
process.on("exit", () => {
  if (!state.workDir) return;
  try { fs.rmSync(state.workDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function plainError(res, message, code = 400) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: message }));
}
function json(res, value) {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

function openBrowser(url) {
  if (process.env.SQUEEZEIT_NO_BROWSER === "1") return;
  try {
    spawn("cmd.exe", ["/c", "start", "", url], { detached: true, windowsHide: true, stdio: "ignore" }).unref();
  } catch (error) {
    log(`Could not open browser: ${error.message}`);
  }
}

function detectHardware() {
  for (const encoder of HARDWARE_ENCODERS) {
    try {
      const result = spawnSync(engines.ffmpeg, hardwareTestArgs(encoder), {
        encoding: "utf8",
        windowsHide: true,
        timeout: 12000,
      });
      if (result.status === 0) {
        log(`Fast video encoder available: ${encoder}`);
        return encoder;
      }
    } catch (error) {
      log(`Hardware check failed for ${encoder}: ${error.message}`);
    }
  }
  log("No fast video encoder available; using the standard one.");
  return null;
}

function diskSpace(targetPath) {
  try {
    const stats = fs.statfsSync(targetPath);
    return stats.bsize * stats.bavail;
  } catch {
    return null;
  }
}

function nearestExistingDir(dir) {
  let current = String(dir || "");
  while (current) {
    try {
      if (fs.existsSync(current) && fs.statSync(current).isDirectory()) return current;
    } catch {
      // keep walking up
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/** HTML shown when an engine is missing or blocked. */
function errorPage(failures) {
  const lines = failures
    .map((f) => `<li><strong>${escapeHtml(f.name)}</strong><br>${escapeHtml(f.detail)}</li>`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SqueezeIt cannot start</title>
<style>:root{color-scheme:light dark}body{font:18px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:700px;margin:60px auto;padding:0 20px;color:#16181d;background:#f6f5f2}
.card{background:#fff;border:1px solid #e3e1db;border-radius:18px;padding:28px 32px;box-shadow:0 18px 50px rgba(20,20,30,.08)}
h1{font-size:30px;margin:0 0 8px}li{margin:16px 0}button{font-size:18px;padding:12px 20px;cursor:pointer;border:0;border-radius:12px;background:#4f46e5;color:#fff}
@media(prefers-color-scheme:dark){body{color:#f4f4f6;background:#121319}.card{background:#1c1e26;border-color:#2e3140}}</style></head>
<body><main class="card"><h1>SqueezeIt cannot start</h1>
<p>One of the files SqueezeIt needs is missing or was blocked. Nothing is broken, and your files are safe. Restore these files, then double-click Start SqueezeIt again:</p>
<ul>${lines}</ul>
<p>If your antivirus removed a file, restore it and add the SqueezeIt folder as an exception.</p>
<button onclick="fetch('/api/ack');document.querySelector('.card').innerHTML='<h1>You can close this tab.</h1>'">Close</button>
</main></body></html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function startErrorServer(failures) {
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith("/api/ack")) {
      res.writeHead(200);
      res.end("ok");
      setTimeout(() => process.exit(0), 100);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(errorPage(failures));
  });
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    log(`Engine problem, showing help page on ${port}`);
    openBrowser(`http://127.0.0.1:${port}/`);
  });
  setTimeout(() => process.exit(0), 10 * 60 * 1000).unref();
}

function setupFirstRun() {
  if (process.env.SQUEEZEIT_SKIP_SHORTCUT === "1") return;
  if (!settings.shortcutCreated) {
    const vbs = path.join(PRODUCT_ROOT, "Start SqueezeIt.vbs");
    try {
      if (createDesktopShortcut(vbs, PRODUCT_ROOT)) {
        settings.shortcutCreated = true;
        saveSettings(settings);
        log("Desktop shortcut created.");
      } else {
        state.notice =
          "We could not put a SqueezeIt icon on your Desktop. You can still start it from the SqueezeIt folder.";
      }
    } catch (error) {
      log(`Shortcut failed: ${error.message}`);
      state.notice =
        "We could not put a SqueezeIt icon on your Desktop. You can still start it from the SqueezeIt folder.";
    }
  }
}

const STATIC_FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/favicon.svg": ["favicon.svg", "image/svg+xml; charset=utf-8"],
};

function sendStatic(res, filename, contentType) {
  try {
    const data = fs.readFileSync(path.join(PUBLIC_DIR, filename));
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 8 * 1024 * 1024) break;
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function authorized(req, url) {
  const supplied = url.searchParams.get("t") || req.headers["x-squeezeit-token"];
  if (supplied !== token) return false;
  const origin = req.headers.origin;
  if (origin && origin !== `http://127.0.0.1:${state.port}`) return false;
  return true;
}

function overallPercent() {
  const job = state.job;
  if (!job.total) return 0;
  let sum = 0;
  for (const fraction of job.fractions.values()) sum += clamp(Number(fraction) || 0, 0, 1);
  return clamp((sum / job.total) * 100, 0, 100);
}

function sanitizeSettings(patch) {
  if (!patch || typeof patch !== "object") return;
  if ("outputDir" in patch) {
    settings.outputDir = patch.outputDir ? String(patch.outputDir).trim() || null : null;
  }
  if ("aspect" in patch && ["original", "square", "widescreen", "vertical"].includes(patch.aspect)) {
    settings.aspect = patch.aspect;
  }
  if ("maxWidth" in patch) {
    const width = Number(patch.maxWidth);
    settings.maxWidth = Number.isFinite(width) && width >= 64 ? Math.round(width) : null;
  }
  if ("parallelJobs" in patch) {
    const jobs = Number(patch.parallelJobs);
    settings.parallelJobs = Number.isFinite(jobs) ? clamp(Math.round(jobs), 1, 8) : 1;
  }
  if ("convertToWebp" in patch) settings.convertToWebp = Boolean(patch.convertToWebp);
  if ("maxBytes" in patch) {
    const bytes = Number(patch.maxBytes);
    settings.maxBytes = Number.isFinite(bytes) && bytes >= 1024 ? Math.round(bytes) : null;
  }
  if ("maxSizeUnit" in patch && ["KB", "MB", "GB"].includes(patch.maxSizeUnit)) {
    settings.maxSizeUnit = patch.maxSizeUnit;
  }
  if ("theme" in patch && ["auto", "light", "dark"].includes(patch.theme)) settings.theme = patch.theme;
}

function sanitizeItems(raw) {
  const seen = new Set();
  const items = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!item || typeof item.path !== "string" || !item.path.trim()) continue;
    const filePath = item.path;
    const key = filePath.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const slider = Number(item.slider);
    items.push({
      ...item,
      path: filePath,
      name: item.name || path.basename(filePath),
      size: Number(item.size) || stat.size,
      slider: clamp(Number.isFinite(slider) ? slider : 50, 0, 100),
      supported: item.supported !== false,
    });
  }
  return items;
}

async function handleApi(req, res, url, body) {
  const route = url.pathname;

  if (route === "/api/status") {
    return json(res, {
      ok: true,
      version: appVersion(),
      notice: state.notice,
      welcomeSeen: settings.welcomeSeen,
      settings,
      hardware: Boolean(state.hardwareEncoder),
      hardwareEncoder: state.hardwareEncoder || "",
    });
  }
  if (route === "/api/ack-welcome") {
    settings.welcomeSeen = true;
    saveSettings(settings);
    return json(res, { ok: true });
  }
  if (route === "/api/settings") {
    sanitizeSettings(body);
    saveSettings(settings);
    return json(res, { settings });
  }
  if (route === "/api/dialog/files") {
    return json(res, await chooseFiles());
  }
  if (route === "/api/dialog/folder") {
    return json(res, await chooseFolder());
  }
  if (route === "/api/scan-folder") {
    const result = scanFolder(body.path || "");
    return json(res, result);
  }
  if (route === "/api/analyze") {
    const seen = new Set();
    const paths = (Array.isArray(body.paths) ? body.paths : [])
      .filter((p) => typeof p === "string" && p.trim())
      .map((p) => p.trim())
      .filter((p) => {
        const key = p.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 600);
    const items = paths.map((filePath) => {
      const analysis = probeFile(engines.ffprobe, filePath);
      const advice = recommend(analysis);
      return { ...analysis, ...advice };
    });
    return json(res, { items });
  }
  if (route === "/api/estimate") {
    const rawSlider = Number(body.slider);
    const slider = clamp(Number.isFinite(rawSlider) ? rawSlider : 50, 0, 100);
    const items = Array.isArray(body.items) ? body.items : [];
    const cap = Number(settings.maxBytes) || Infinity;
    return json(res, {
      estimates: items.map((item) => ({
        path: item.path,
        name: item.name,
        bytes: Math.min(estimateOutputBytes(item, slider), cap),
      })),
    });
  }
  if (route === "/api/check-space") {
    const dirs = Array.isArray(body.outputDirs) && body.outputDirs.length
      ? body.outputDirs
      : [workRoot()];
    const needed = Number(body.estimatedBytes) || 0;
    const checked = [...new Set(dirs.filter((d) => typeof d === "string" && d))].map((dir) => {
      const realDir = nearestExistingDir(dir);
      const free = realDir ? diskSpace(realDir) : null;
      return { dir, free, enough: free == null ? true : free >= needed };
    });
    return json(res, { checked });
  }
  if (route === "/api/start") {
    if (state.job.running) return plainError(res, "A batch is already running.", 409);
    const items = sanitizeItems(body.items).filter((item) => item.supported);
    if (!items.length) return plainError(res, "Choose at least one file first.");
    if (body.settings && typeof body.settings === "object") sanitizeSettings(body.settings);
    const jobSettings = { ...settings };
    const previousWork = state.workDir;
    state.workDir = path.join(workRoot(), `job-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`);
    try {
      fs.mkdirSync(state.workDir, { recursive: true });
    } catch (error) {
      return plainError(res, `We could not make a temporary folder: ${error.message}`, 500);
    }
    if (previousWork && previousWork !== state.workDir) {
      try { fs.rmSync(previousWork, { recursive: true, force: true }); } catch { /* leftovers are fine */ }
    }
    state.result = null;
    void runJob(items, jobSettings);
    return json(res, { started: true, total: items.length });
  }
  if (route === "/api/progress") {
    const job = state.job;
    const elapsedSec = job.startedAt ? Math.max(0, (Date.now() - job.startedAt) / 1000) : 0;
    const percent = job.running ? overallPercent() : (job.total ? 100 : 0);
    let etaSec = 0;
    if (job.running && percent > 2) {
      etaSec = Math.max(0, (elapsedSec / (percent / 100)) - elapsedSec);
    }
    job.percent = percent;
    job.elapsedSec = elapsedSec;
    job.etaSec = etaSec;
    return json(res, {
      running: job.running,
      current: job.current,
      done: job.done,
      total: job.total,
      percent,
      etaSec,
      elapsedSec,
      activeName: job.activeName,
      phase: job.phase,
      cancelled: job.cancelled,
    });
  }
  if (route === "/api/stop") {
    state.job.cancelled = true;
    state.job.phase = "Stopping";
    for (const child of state.job.children) {
      try { child.kill(); } catch { /* already gone */ }
    }
    return json(res, { stopped: true });
  }
  if (route === "/api/result") {
    return json(res, { result: state.result });
  }
  if (route === "/api/save-copy") {
    const available = (state.result?.done || [])
      .map((entry) => entry.path)
      .filter((filePath) => typeof filePath === "string" && filePath);
    const wanted = Array.isArray(body.paths) && body.paths.length ? body.paths : available;
    const files = wanted.filter(
      (filePath) => typeof filePath === "string" && available.includes(filePath) && fs.existsSync(filePath),
    );
    if (!files.length) return plainError(res, "There are no new files to save yet.");
    const picked = await chooseSaveTarget(files, state.result?.defaultSaveDir || "");
    if (picked.error) return plainError(res, picked.error);
    if (!picked.paths || !picked.paths.length) return json(res, { ok: true, cancelled: true });
    const target = picked.paths[0];
    const remember = (savedTo, savedList) => {
      if (!state.result) return;
      state.result.savedTo = savedTo;
      const known = new Set(state.result.savedPaths || []);
      for (const filePath of savedList) known.add(filePath);
      state.result.savedPaths = [...known];
      const dirs = new Set(state.result.savedDirs || []);
      dirs.add(savedTo);
      state.result.savedDirs = [...dirs];
    };
    try {
      if (files.length === 1) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(files[0], target);
        const folder = path.dirname(target);
        remember(folder, files);
        log(`Saved a copy to ${target}`);
        return json(res, { ok: true, count: 1, savedTo: folder, paths: files });
      }
      fs.mkdirSync(target, { recursive: true });
      for (const file of files) {
        const destination = uniquePath(target, path.basename(file), (candidate) => fs.existsSync(candidate));
        fs.copyFileSync(file, path.normalize(destination));
      }
      remember(target, files);
      log(`Saved ${files.length} copies to ${target}`);
      return json(res, { ok: true, count: files.length, savedTo: target, paths: files });
    } catch (error) {
      return plainError(res, `We could not save the copy: ${error.message}`, 500);
    }
  }
  if (route === "/api/open-folder") {
    let target = String(body.path || "");
    if (!target && state.result?.outputDir) target = state.result.outputDir;
    try {
      if (target && fs.existsSync(target) && fs.statSync(target).isFile()) target = path.dirname(target);
      if (target && !fs.existsSync(target)) target = nearestExistingDir(path.dirname(target)) || "";
    } catch {
      target = "";
    }
    if (target) {
      try {
        spawn("explorer.exe", [target], { detached: true, windowsHide: true, stdio: "ignore" }).unref();
      } catch { /* nothing else to do */ }
    }
    return json(res, { ok: Boolean(target), path: target });
  }
  if (route === "/api/heartbeat") {
    state.lastSeen = Date.now();
    return json(res, { ok: true });
  }
  return plainError(res, "Unknown request.", 404);
}

/** Run ffmpeg, streaming progress, tracking the child so Stop can kill it. */
function runFfmpeg(args, onProgress) {
  return new Promise((resolve) => {
    const child = spawn(engines.ffmpeg, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    state.job.children.add(child);
    let stderr = "";
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) onProgress(line);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 24000) stderr = stderr.slice(-24000);
    });
    child.on("error", () => {
      state.job.children.delete(child);
      resolve({ code: -1, stderr });
    });
    child.on("close", (code) => {
      state.job.children.delete(child);
      resolve({ code: code ?? -1, stderr });
    });
  });
}

function measureQuality(item, temp, durationSec) {
  const common = [
    "-y", "-hide_banner", "-loglevel", "info",
  ];
  let args;
  if (item.kind === "video") {
    const middle = Math.max(0, (durationSec || 0) / 2 - 5);
    args = [
      ...common, "-ss", String(middle), "-t", "10", "-i", item.path,
      "-ss", "0", "-t", "10", "-i", temp,
      "-lavfi", "[0:v][1:v]ssim", "-f", "null", "-",
    ];
  } else {
    args = [
      ...common, "-i", item.path, "-i", temp,
      "-lavfi", "[0:v][1:v]ssim", "-f", "null", "-",
    ];
  }
  try {
    const result = spawnSync(engines.ffmpeg, args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return parseSsim(`${result.stdout || ""}\n${result.stderr || ""}`);
  } catch {
    return null;
  }
}

function sizeText(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

async function processItem(item, settings, onFraction) {
  let before = item.size || 0;
  try {
    before = fs.statSync(item.path).size;
  } catch {
    // Fall back to the size recorded during analysis.
  }
  const maxBytes = Number(settings.maxBytes) || 0;
  const duration = item.durationSec || 0;
  if (maxBytes > 0 && before <= maxBytes) {
    return {
      name: item.name,
      status: "skipped",
      reason: `Already under your ${sizeText(maxBytes)} limit.`,
    };
  }

  const imageExt = String(item.imageExt || "").toLowerCase();
  const convert = Boolean(settings.convertToWebp) && item.kind === "image";
  // A lossless picture cannot be squeezed to a byte budget without changing
  // format, so a size limit switches it to plain JPEG (or WebP if requested).
  const lossyNeeded = maxBytes > 0 && item.kind === "image"
    && ["png", "bmp", "tiff", "tif", "gif"].includes(imageExt);
  const ext = lossyNeeded && !convert ? "jpg" : targetExtension(item.kind, item.imageExt, convert);

  const outputDir = state.workDir;
  try {
    fs.mkdirSync(outputDir, { recursive: true });
  } catch {
    return {
      name: item.name,
      status: "failed",
      reason: "We could not create the folder for the smaller copy.",
    };
  }
  const temp = path.join(outputDir, `.squeezeit-${crypto.randomUUID()}.${ext}`);
  const hardware = item.kind === "video" && (item.slider <= 65 || maxBytes > 0)
    ? state.hardwareEncoder
    : null;

  const baseArgs = {
    input: item.path,
    output: temp,
    slider: item.slider,
    aspect: settings.aspect || "original",
    maxWidth: settings.maxWidth || null,
    width: item.width || null,
  };
  const progressHandler = (line) => {
    const progress = parseProgress(line, duration);
    if (progress.percent > 0) onFraction(Math.max(0.04, progress.percent / 100));
  };

  const runOnce = async ({
    slider = item.slider,
    bitrateKbps = 0,
    audioKbps = 128,
    maxWidth = baseArgs.maxWidth,
    progress = progressHandler,
    startFraction = 0.04,
  } = {}) => {
    cleanup(temp);
    onFraction(startFraction);
    const common = { ...baseArgs, slider, maxWidth };
    let args = item.kind === "video"
      ? buildVideoArgs({ ...common, hardwareEncoder: hardware, bitrateKbps, audioKbps })
      : buildImageArgs({ ...common, ext, convertToWebp: convert });
    let run = await runFfmpeg(args, progress);
    if (state.job.cancelled) return { cancelled: true };

    // A hardware encoder that fails is retried with the standard CPU encoder.
    if (run.code !== 0 && hardware) {
      log(`Fast encoder failed for ${item.name}; retrying with standard encoder.`);
      cleanup(temp);
      args = item.kind === "video"
        ? buildVideoArgs({ ...common, hardwareEncoder: null, bitrateKbps, audioKbps })
        : buildImageArgs({ ...common, ext, convertToWebp: convert });
      run = await runFfmpeg(args, progress);
      if (state.job.cancelled) return { cancelled: true };
    }
    if (run.code !== 0) return { failed: true };
    try {
      return { after: fs.statSync(temp).size };
    } catch {
      return { failed: true };
    }
  };

  let attempt;
  if (item.kind === "video" && maxBytes > 0 && duration > 0) {
    const rates = targetBitrates({ maxBytes, durationSec: duration });
    attempt = await runOnce({ bitrateKbps: rates.videoKbps, audioKbps: rates.audioKbps });
    if (!attempt.cancelled && !attempt.failed && attempt.after > maxBytes) {
      // Constant-bitrate encoding has some variance — try once more, lower.
      attempt = await runOnce({
        bitrateKbps: Math.max(30, Math.round(rates.videoKbps * 0.8)),
        audioKbps: rates.audioKbps,
        progress: () => {},
        startFraction: 0.55,
      });
    }
  } else if (item.kind === "image" && maxBytes > 0) {
    const qualities = [98, 92, 85, 72, 56, 42, 30, 20];
    for (let i = 0; i < qualities.length; i += 1) {
      const shrink = i < 4 ? 1 : 0.82 ** (i - 3);
      const scaled = baseArgs.width ? Math.max(16, Math.round(baseArgs.width * shrink)) : null;
      const maxWidth = baseArgs.maxWidth && scaled
        ? Math.min(baseArgs.maxWidth, scaled)
        : (scaled || baseArgs.maxWidth);
      attempt = await runOnce({
        slider: qualities[i],
        maxWidth,
        progress: () => {},
        startFraction: 0.05 + (i / qualities.length) * 0.85,
      });
      if (attempt.cancelled || attempt.failed || attempt.after <= maxBytes) break;
    }
  } else {
    attempt = await runOnce();
  }

  if (state.job.cancelled || attempt?.cancelled) {
    cleanup(temp);
    return { name: item.name, status: "cancelled" };
  }
  if (!attempt || attempt.failed) {
    cleanup(temp);
    return {
      name: item.name,
      status: "failed",
      reason: "We could not make a smaller copy of this file. It may be damaged or open in another program.",
    };
  }

  const after = attempt.after;
  if (after >= before) {
    cleanup(temp);
    return {
      name: item.name,
      status: "skipped",
      reason: "Already as small as it can get.",
    };
  }
  if (maxBytes > 0 && after > maxBytes) {
    cleanup(temp);
    return {
      name: item.name,
      status: "failed",
      reason: `We could not get this file under ${sizeText(maxBytes)}.`,
    };
  }

  onFraction(0.96);
  const ssim = measureQuality(item, temp, duration);
  const label = qualityLabel(ssim);
  const finalName = outputName(item.name, { extension: ext });
  const finalPath = path.normalize(uniquePath(outputDir, finalName, (candidate) => fs.existsSync(candidate)));
  try {
    fs.renameSync(temp, finalPath);
  } catch (error) {
    cleanup(temp);
    return { name: item.name, status: "failed", reason: `We could not save the new file: ${error.message}` };
  }
  onFraction(1);

  return {
    name: item.name,
    status: "done",
    before,
    after,
    saved: Math.max(0, before - after),
    percentSaved: before > 0 ? Math.round((1 - after / before) * 1000) / 10 : 0,
    label,
    ext,
    path: finalPath,
  };
}

function cleanup(temp) {
  try {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  } catch { /* best effort */ }
}

async function runJob(items, jobSettings) {
  const job = state.job;
  job.running = true;
  job.cancelled = false;
  job.current = 0;
  job.done = 0;
  job.total = items.length;
  job.percent = 0;
  job.etaSec = 0;
  job.elapsedSec = 0;
  job.activeName = "";
  job.phase = "Preparing";
  job.startedAt = Date.now();
  job.fractions = new Map();

  const results = new Array(items.length);
  let cursor = 0;
  const workers = Math.max(1, Math.min(8, Number(jobSettings.parallelJobs) || 1));

  async function worker() {
    while (cursor < items.length && !job.cancelled) {
      const index = cursor++;
      const item = items[index];
      job.current = Math.max(job.current, index + 1);
      job.activeName = item.name;
      job.phase = "Compressing";
      job.fractions.set(item.path, 0.02);
      try {
        results[index] = await processItem(item, jobSettings, (fraction) => {
          job.fractions.set(item.path, clamp(fraction, 0, 1));
        });
      } catch (error) {
        log(`Job error for ${item.name}: ${error.message}`);
        results[index] = {
          name: item.name,
          status: "failed",
          reason: "Something went wrong with this file. Your original is safe.",
        };
      }
      job.fractions.set(item.path, 1);
      job.done = Math.min(job.total, job.done + 1);
      job.activeName = "";
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));

  let totalBefore = 0;
  let totalAfter = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const failures = [];
  const done = [];

  for (const result of results) {
    if (!result) continue;
    if (result.status === "done") {
      succeeded += 1;
      totalBefore += result.before;
      totalAfter += result.after;
      done.push(result);
    } else if (result.status === "skipped") {
      skipped += 1;
      failures.push(`${result.name}: ${result.reason}`);
    } else if (result.status === "failed") {
      failed += 1;
      failures.push(`${result.name}: ${result.reason}`);
    }
  }

  const first = done[0];
  const outputDir = first ? path.dirname(first.path) : state.workDir;
  state.result = {
    succeeded,
    failed,
    skipped,
    totalBefore,
    totalAfter,
    totalSaved: Math.max(0, totalBefore - totalAfter),
    percentSaved: totalBefore > 0 ? Math.round((1 - totalAfter / totalBefore) * 1000) / 10 : 0,
    failures,
    outputDir,
    temporary: true,
    defaultSaveDir: jobSettings.outputDir || null,
    savedTo: "",
    savedPaths: [],
    savedDirs: [],
    cancelled: job.cancelled,
    elapsedSec: Math.max(0, Math.round((Date.now() - job.startedAt) / 1000)),
    done: done.map((entry) => ({
      name: entry.name,
      label: entry.label,
      before: entry.before,
      after: entry.after,
      saved: entry.saved,
      percentSaved: entry.percentSaved,
      ext: entry.ext,
      path: entry.path,
    })),
  };
  job.running = false;
  job.percent = 100;
  job.done = job.total;
  job.phase = job.cancelled ? "Stopped" : "Finished";
  job.activeName = "";
  log(`Job finished: ${succeeded} done, ${failed} failed, ${skipped} skipped.`);
}

function startMainServer() {
  state.hardwareEncoder = detectHardware();
  cleanStaleWork();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${state.port}`);
    state.lastSeen = Date.now();
    const staticFile = STATIC_FILES[url.pathname];
    if (staticFile) return sendStatic(res, staticFile[0], staticFile[1]);
    if (!url.pathname.startsWith("/api/")) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    if (!authorized(req, url)) return plainError(res, "This page is not allowed to control SqueezeIt.", 403);
    const body = req.method === "POST" ? await readBody(req) : {};
    try {
      await handleApi(req, res, url, body);
    } catch (error) {
      log(`API error ${url.pathname}: ${error.message}`);
      plainError(res, "Something went wrong. Your files are safe.", 500);
    }
  });

  server.listen(Number(process.env.SQUEEZEIT_PORT) || 0, "127.0.0.1", () => {
    state.port = server.address().port;
    setupFirstRun();
    const url = `http://127.0.0.1:${state.port}/?t=${token}`;
    // DEV TEST HOOK: exposing the token in the log is disabled by default.
    const loggableUrl = process.env.SQUEEZEIT_TEST_LOG_TOKEN === "1"
      ? url
      : url.replace(/t=.*/, "t=***");
    log(`SqueezeIt ready at ${loggableUrl}`);
    openBrowser(url);
  });

  const timer = setInterval(() => {
    const idle = Date.now() - state.lastSeen > 60_000;
    if (idle && !state.job.running) {
      log("No browser activity for 60 seconds; closing.");
      clearInterval(timer);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1000).unref();
    }
  }, 5000);
  timer.unref();
}

const checks = verifyEngines(engines);
const broken = checks.filter((check) => !check.ok);
if (broken.length) {
  log(`Startup check failed: ${broken.map((b) => b.name).join(", ")}`);
  startErrorServer(broken);
} else {
  startMainServer();
}
