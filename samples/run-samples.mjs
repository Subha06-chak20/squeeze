/**
 * Dev/CI harness: run compression across all generated samples and print a
 * before/after table. This mirrors the backend's basic encoding decisions so
 * the sample set can be smoke-tested without launching the GUI.
 *
 *   node samples/run-samples.mjs
 *   FFMPEG=/path/to/ffmpeg GS=/path/to/gswin64c node samples/run-samples.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const FFMPEG = process.env.FFMPEG ?? (process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const GS = process.env.GS ?? (process.platform === "win32" ? "gswin64c" : "gs");
const inDir = path.resolve("samples/generated");
const outDir = path.resolve("samples/out");
fs.mkdirSync(outDir, { recursive: true });

function exists(cmd) {
  const r = spawnSync(cmd, ["-version"], { encoding: "utf8" });
  return r.status === 0;
}
function run(cmd, args) {
  return spawnSync(cmd, args, { encoding: "utf8" });
}
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

const video = new Set(["mp4", "mov", "mkv", "avi", "webm", "m4v", "wmv", "flv"]);
const image = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff", "heic"]);
const audio = new Set(["mp3", "wav", "m4a", "flac"]);

let ok = 0, failed = 0;
const rows = [];

for (const name of fs.readdirSync(inDir).sort()) {
  const ext = path.extname(name).slice(1).toLowerCase();
  const input = path.join(inDir, name);
  const outExt = video.has(ext) ? "mp4" : ext === "tiff" ? "tif" : ext;
  const finalName = audio.has(ext) ? "mp3" : outExt;
  const output = path.join(outDir, name.replace(/\.[^.]+$/, "") + "_compressed." + finalName);
  const before = fs.statSync(input).size;
  let r;

  if (video.has(ext)) {
    r = run(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-i", input,
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "96k", output]);
  } else if (image.has(ext)) {
    const q = ext === "png" ? ["-compression_level", "9"] : ["-q:v", "6"];
    r = run(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-i", input, ...q, output]);
  } else if (audio.has(ext)) {
    r = run(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", "-i", input,
      "-c:a", "libmp3lame", "-q:a", "5", output]);
  } else if (ext === "pdf" && exists(GS)) {
    r = run(GS, ["-sDEVICE=pdfwrite", "-dPDFSETTINGS=/ebook", "-dNOPAUSE", "-dBATCH", "-dQUIET",
      `-sOutputFile=${output}`, input]);
  } else {
    rows.push([name, "skipped", "—", "—", "—"]);
    continue;
  }

  if (r.status !== 0) {
    rows.push([name, "FAILED", kb(before), "—", (r.stderr || "").trim().split(/\r?\n/).pop()?.slice(0, 40) || ""]);
    failed += 1;
    continue;
  }
  const after = fs.existsSync(output) ? fs.statSync(output).size : 0;
  const pct = before ? ((before - after) / before) * 100 : 0;
  rows.push([name, "ok", kb(before), kb(after), `${pct.toFixed(0)}% smaller`]);
  ok += 1;
}

console.log("File".padEnd(20), "Status".padEnd(9), "Before".padEnd(10), "After".padEnd(10), "Result");
console.log("-".repeat(70));
for (const row of rows) {
  console.log(row[0].padEnd(20), row[1].padEnd(9), row[2].padEnd(10), row[3].padEnd(10), row[4]);
}
console.log(`\n${ok} compressed, ${failed} failed. Output: ${outDir}`);
if (failed) process.exitCode = 1;
