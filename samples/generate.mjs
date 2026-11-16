/** Development helper: make a small video and picture with local ffmpeg. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(ROOT, "samples", "generated");
fs.mkdirSync(out, { recursive: true });
const ffmpeg = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

const jobs = [
  ["sample.mp4", ["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=15", "-t", "3", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]],
  ["sample.png", ["-f", "lavfi", "-i", "testsrc2=size=640x480:rate=1", "-frames:v", "1"]],
  ["sample.jpg", ["-f", "lavfi", "-i", "testsrc2=size=640x480:rate=1", "-frames:v", "1", "-q:v", "3"]],
];
for (const [name, args] of jobs) {
  const result = spawnSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", ...args, path.join(out, name)], { encoding: "utf8" });
  console.log(result.status === 0 ? `OK   ${name}` : `SKIP ${name}: ${result.stderr?.trim().split(/\r?\n/).pop() || "ffmpeg failed"}`);
}
