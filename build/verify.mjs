/** Verify a staged SqueezeIt folder: exact file list and every SHA-256. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = process.argv[2] || path.join(ROOT, "dist", "SqueezeIt");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toLowerCase();
}
function listFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out.sort();
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  assert(fs.existsSync(TARGET), `No folder at ${TARGET}`);
  const required = [
    "Start SqueezeIt.vbs", "START-HERE.txt", "LICENSES.txt", "SHA256SUMS.txt",
    "node/node.exe", "bin/ffmpeg.exe", "bin/ffprobe.exe",
    "app/server.mjs", "app/public/index.html", "app/public/app.js", "app/public/style.css",
    "app/lib/recommend.mjs",
  ];
  const files = listFiles(TARGET);
  for (const name of required) assert(files.includes(name), `Missing file: ${name}`);

  const sums = fs.readFileSync(path.join(TARGET, "SHA256SUMS.txt"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64})\s{2}(.+)$/);
      assert(match, `Bad checksum line: ${line}`);
      return { hash: match[1], name: match[2] };
    });

  assert(sums.length === files.length - 1,
    `SHA256SUMS lists ${sums.length} files but folder has ${files.length - 1} others`);
  for (const { hash, name } of sums) {
    const file = path.join(TARGET, name);
    assert(fs.existsSync(file), `Checksum listed for missing file: ${name}`);
    assert(sha256(file) === hash, `Checksum mismatch: ${name}`);
  }
  const unhashed = files.filter((file) => !sums.some((sum) => sum.name === file));
  assert(unhashed.length === 1 && unhashed[0] === "SHA256SUMS.txt",
    `Unexpected unhashed files: ${unhashed.join(", ")}`);
  console.log(`Verified ${sums.length} hashes across ${files.length} files.`);
} catch (error) {
  console.error(`VERIFY FAILED: ${error.message}`);
  process.exit(1);
}
