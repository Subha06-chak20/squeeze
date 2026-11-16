/** End-to-end smoke test: real server, real ffmpeg, real files, no browser. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "smoke-test-token";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "squeezeit-smoke-"));
const appData = path.join(tmp, "appdata");
const outDir = path.join(tmp, "output");
const samples = path.join(tmp, "samples");
fs.mkdirSync(samples, { recursive: true });
fs.mkdirSync(appData, { recursive: true });

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeSamples() {
  const ffmpeg = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const video = path.join(samples, "clip.mp4");
  const image = path.join(samples, "photo.png");
  const pdf = path.join(samples, "notes.pdf");
  const v = spawnSync(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
    "-i", "testsrc2=size=320x180:rate=15", "-t", "2",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", video,
  ]);
  const i = spawnSync(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
    "-i", "testsrc2=size=640x480:rate=1", "-frames:v", "1", image,
  ]);
  if (v.status !== 0 || i.status !== 0) throw new Error("Could not create ffmpeg sample files.");
  fs.writeFileSync(pdf, "%PDF-1.4\nnot a real pdf\n");
  return [video, image, pdf];
}

async function main() {
  const paths = makeSamples();
  const before = paths.map((p) => sha256(p));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, [path.join(ROOT, "app", "server.mjs")], {
    cwd: ROOT,
    env: {
      ...process.env,
      APPDATA: appData,
      SQUEEZEIT_TOKEN: TOKEN,
      SQUEEZEIT_NO_BROWSER: "1",
      SQUEEZEIT_SKIP_SHORTCUT: "1",
      SQUEEZEIT_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let serverLog = "";
  child.stdout.on("data", (d) => { serverLog += d; });
  child.stderr.on("data", (d) => { serverLog += d; });

  const call = async (route, body = {}, withToken = true) => {
    const headers = { "Content-Type": "application/json" };
    if (withToken) headers["x-squeezeit-token"] = TOKEN;
    const response = await fetch(`${base}/api/${route}`, {
      method: "POST", headers, body: JSON.stringify(body),
    });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  };

  let ready = false;
  for (let i = 0; i < 100; i += 1) {
    try {
      const response = await fetch(`${base}/api/status`, { headers: { "x-squeezeit-token": TOKEN } });
      if (response.status === 200) { ready = true; break; }
    } catch { /* not listening yet */ }
    await sleep(100);
  }
  if (!ready) throw new Error(`Server did not start.\n${serverLog}`);
  console.log("PASS  server starts and answers with a token");

  const denied = await call("status", {}, false);
  if (denied.status !== 403) throw new Error(`Request without a token returned ${denied.status}.`);
  console.log("PASS  request without token is rejected");

  const analyzed = await call("analyze", { paths });
  const items = analyzed.data.items || [];
  if (items.length !== 3) throw new Error(`Expected 3 analysed paths, got ${items.length}.`);
  if (!items[0].supported || !items[1].supported || items[2].supported) {
    throw new Error("Video/image should be supported; PDF should not.");
  }
  if (items[2].supportedText !== "Not supported in this version.") {
    throw new Error("PDF was not labelled plainly.");
  }
  console.log("PASS  video + image analysed; PDF reported as not supported");

  const supported = items.filter((item) => item.supported).map((item) => ({
    ...item, slider: 50,
  }));
  const started = await call("start", { items: supported, settings: { outputDir: outDir } });
  if (started.status !== 200) throw new Error(`Start failed: ${JSON.stringify(started.data)}`);
  console.log("PASS  batch started");

  let progress;
  for (let i = 0; i < 600; i += 1) {
    progress = (await call("progress")).data;
    if (!progress.running) break;
    await sleep(100);
  }
  if (progress.running) throw new Error("Job did not finish in time.");
  console.log("PASS  job finished");

  const { result } = (await call("result")).data;
  if (!result || result.succeeded !== 2 || result.failed !== 0) {
    throw new Error(`Unexpected result: ${JSON.stringify(result)}`);
  }
  console.log("PASS  both files compressed");

  const allowedLabels = ["Looks the same", "Smaller, some detail lost.", "Smaller. Not checked."];
  const labels = result.done.map((entry) => entry.label);
  if (!labels.every((label) => allowedLabels.includes(label))) {
    throw new Error(`Unexpected quality labels: ${labels.join(", ")}`);
  }
  console.log(`PASS  quality labels are based on measurement (${labels.join(" / ")})`);

  const outputs = fs.existsSync(result.outputDir) ? fs.readdirSync(result.outputDir).filter((name) => !name.startsWith(".squeezeit-")) : [];
  if (!outputs.some((name) => name.endsWith(" (smaller).mp4")) ||
      !outputs.some((name) => name.endsWith(" (smaller).png"))) {
    throw new Error(`Missing output files: ${outputs.join(", ")}`);
  }
  console.log("PASS  output names use ' (smaller)' and keep extensions");

  if (fs.readdirSync(result.outputDir).some((name) => name.startsWith(".squeezeit-"))) {
    throw new Error("A partial temporary file was left behind.");
  }
  console.log("PASS  no partial files remain");

  if (fs.existsSync(path.join(path.dirname(paths[0]), "Smaller files"))) {
    throw new Error("An output folder was created beside the original.");
  }
  if (fs.existsSync(outDir)) {
    throw new Error("The suggested save folder was written to without asking.");
  }
  console.log("PASS  nothing is written beside the originals or into the save folder");

  paths.forEach((file, index) => {
    if (sha256(file) !== before[index]) throw new Error(`Original was modified: ${file}`);
  });
  console.log("PASS  originals are unchanged");

  // A maximum-size limit must actually keep each output under the budget.
  const videoItem = supported.find((item) => item.kind === "video");
  const imageItem = supported.find((item) => item.kind === "image");
  const waitForDone = async () => {
    let progress;
    for (let i = 0; i < 600; i += 1) {
      progress = (await call("progress")).data;
      if (!progress.running) break;
      await sleep(100);
    }
    if (progress.running) throw new Error("A size-limited job did not finish in time.");
    return (await call("result")).data.result;
  };

  const videoMax = 30 * 1024;
  await call("start", {
    items: [{ ...videoItem, slider: 50 }],
    settings: { maxBytes: videoMax },
  });
  let limited = await waitForDone();
  if (limited.succeeded !== 1 || !limited.done[0] || limited.done[0].after > videoMax) {
    throw new Error(`Video did not fit the limit: ${JSON.stringify(limited)}`);
  }
  console.log(`PASS  video respects the size limit (${limited.done[0].after} <= ${videoMax} bytes)`);

  const imageMax = 20 * 1024;
  await call("start", {
    items: [{ ...imageItem, slider: 50 }],
    settings: { maxBytes: imageMax },
  });
  limited = await waitForDone();
  if (limited.succeeded !== 1 || !limited.done[0] || limited.done[0].after > imageMax) {
    throw new Error(`Image did not fit the limit: ${JSON.stringify(limited)}`);
  }
  console.log(`PASS  image respects the size limit (${limited.done[0].after} <= ${imageMax} bytes)`);

  await call("start", {
    items: [{ ...videoItem, slider: 50 }],
    settings: { maxBytes: 100 * 1024 * 1024 },
  });
  limited = await waitForDone();
  if (limited.skipped !== 1 || !/already under/i.test(limited.failures[0] || "")) {
    throw new Error(`Small file should have been skipped: ${JSON.stringify(limited)}`);
  }
  console.log("PASS  a file already below the limit is skipped with a clear reason");
  await call("settings", { maxBytes: null });

  // Stop mid-batch: a longer video gives us time to press Stop.
  const ffmpeg = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const longVideo = path.join(samples, "long.mp4");
  const made = spawnSync(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
    "-i", "testsrc2=size=1280x720:rate=30", "-t", "20",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", longVideo,
  ]);
  if (made.status !== 0) throw new Error("Could not create the long sample video.");
  const stopOut = path.join(tmp, "stop-output");
  const longItem = (await call("analyze", { paths: [longVideo] })).data.items[0];
  await call("start", {
    items: [{ ...longItem, slider: 50 }],
    settings: { outputDir: stopOut },
  });
  await sleep(150);
  await call("stop");
  let stopped;
  for (let i = 0; i < 300; i += 1) {
    stopped = (await call("progress")).data;
    if (!stopped.running) break;
    await sleep(100);
  }
  if (stopped.running) throw new Error("Stop did not end the job.");
  const stoppedResult = (await call("result")).data.result || {};
  const stoppedDir = stoppedResult.outputDir || "";
  const leftovers = stoppedDir && fs.existsSync(stoppedDir)
    ? fs.readdirSync(stoppedDir).filter((name) => name.startsWith(".squeezeit-"))
    : [];
  if (leftovers.length) throw new Error(`Partial files left after Stop: ${leftovers.join(", ")}`);
  if (fs.existsSync(stopOut)) throw new Error("A stopped job left a file in the save folder.");
  console.log("PASS  Stop ends the job and leaves no partial files");

  child.kill();
  await sleep(200);
  console.log(`\nSmoke test passed. Temporary files: ${tmp}`);
}

main().catch((error) => {
  console.error(`\nSMOKE FAILED: ${error.message}`);
  process.exit(1);
});
