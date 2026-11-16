/**
 * Stage the portable SqueezeIt folder. Dev mode uses locally installed tools;
 * release mode requires pinned engines.json + engines-input/ and verifies hashes.
 *
 *   npm run build -- --dev     # local development folder in dist/SqueezeIt
 *   npm run build              # pinned release folder
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEV = process.argv.includes("--dev");
const DIST = path.join(ROOT, "dist", "SqueezeIt");
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toLowerCase();
}
function where(command) {
  const result = spawnSync(process.platform === "win32" ? "where" : "which", [command], { encoding: "utf8" });
  return result.status === 0
    ? result.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
    : null;
}
function versionOf(command, flag = "-version") {
  const result = spawnSync(command, [flag], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  const text = `${result.stdout || ""}\n${result.stderr || ""}`;
  return (text.split(/\r?\n/).find((line) => line.trim()) || "unknown").trim().slice(0, 100);
}
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dest);
    else fs.copyFileSync(src, dest);
  }
}
function listFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out.sort();
}

function pins() {
  if (DEV) {
    const ffmpeg = where("ffmpeg");
    const ffprobe = where("ffprobe");
    if (!ffmpeg || !ffprobe) throw new Error("ffmpeg and ffprobe must be on PATH for a dev build.");
    const entries = {
      node: {
        file: "node/node.exe", path: process.execPath, version: versionOf(process.execPath, "--version"),
        url: "local Node.js installation", license: "MIT",
      },
      ffmpeg: {
        file: "bin/ffmpeg.exe", path: ffmpeg, version: versionOf(ffmpeg),
        url: "local ffmpeg installation", license: "GPL-3.0-or-later",
      },
      ffprobe: {
        file: "bin/ffprobe.exe", path: ffprobe, version: versionOf(ffprobe),
        url: "local ffprobe installation", license: "GPL-3.0-or-later",
      },
    };
    for (const entry of Object.values(entries)) entry.sha256 = sha256(entry.path);
    return entries;
  }

  const manifestPath = path.join(ROOT, "engines.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("Missing engines.json. Copy engines.example.json, pin every SHA-256, and place files in engines-input/.");
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const entries = {};
  for (const key of ["node", "ffmpeg", "ffprobe"]) {
    const spec = manifest[key];
    if (!spec) throw new Error(`engines.json is missing the ${key} entry.`);
    const source = path.join(ROOT, "engines-input", spec.file);
    if (!fs.existsSync(source)) throw new Error(`Missing pinned file: ${source}`);
    const actual = sha256(source);
    if (actual !== String(spec.sha256 || "").toLowerCase()) {
      throw new Error(`SHA-256 mismatch for ${spec.file}. Refusing to build.`);
    }
    entries[key] = {
      file: spec.file, path: source, version: spec.version,
      url: spec.url, license: spec.license, sha256: actual,
    };
    console.log(`Verified ${spec.file}`);
  }
  return entries;
}

function licensesText(entries) {
  const lines = [
    "SQUEEZEIT - LICENSES AND BUNDLED TOOLS",
    "========================================",
    "",
    `SqueezeIt version ${VERSION} is free software licensed GPL-3.0-or-later.`,
    "Its full source code, build scripts and license text are available with the",
    "project. You may share and change it under the GNU General Public License.",
    "",
  ];
  if (DEV) {
    lines.push("*** LOCAL DEVELOPMENT BUILD - ENGINES ARE NOT PINNED RELEASE FILES ***", "");
  }
  lines.push("Bundled tools:", "");
  for (const [name, entry] of Object.entries(entries)) {
    lines.push(
      `Name:     ${name}`,
      `File:     ${entry.file}`,
      `Version:  ${entry.version}`,
      `From:     ${entry.url}`,
      `License:  ${entry.license}`,
      `SHA-256:  ${entry.sha256}`,
      "",
    );
  }
  lines.push(
    "Node.js is licensed under the MIT license. FFmpeg and ffprobe from gyan.dev",
    "are GPL-licensed builds; their source is available from the URL above.",
    "SqueezeIt makes no network calls at runtime.",
    "",
  );
  return lines.join("\n");
}

function writeSums(dir) {
  const files = listFiles(dir);
  const body = [
    `# SHA-256 checksums for SqueezeIt ${VERSION}`,
    "# Check a file in PowerShell: Get-FileHash <file> -Algorithm SHA256",
    "",
    ...files.map((file) => `${sha256(path.join(dir, file))}  ${file}`),
  ];
  fs.writeFileSync(path.join(dir, "SHA256SUMS.txt"), `${body.join("\r\n")}\r\n`, "utf8");
  return files;
}

function main() {
  const entries = pins();
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  for (const name of ["Start SqueezeIt.vbs", "START-HERE.txt", "LICENSE", "package.json"]) {
    fs.copyFileSync(path.join(ROOT, name), path.join(DIST, name));
  }
  fs.writeFileSync(path.join(DIST, "LICENSES.txt"), licensesText(entries), "utf8");

  fs.mkdirSync(path.join(DIST, "app"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "app", "server.mjs"), path.join(DIST, "app", "server.mjs"));
  copyTree(path.join(ROOT, "app", "public"), path.join(DIST, "app", "public"));
  copyTree(path.join(ROOT, "app", "lib"), path.join(DIST, "app", "lib"));

  for (const entry of Object.values(entries)) {
    const target = path.join(DIST, entry.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(entry.path, target);
  }

  const files = writeSums(DIST);
  const bytes = files.reduce((sum, file) => sum + fs.statSync(path.join(DIST, file)).size, 0);
  console.log(`\nStaged ${files.length} files in ${DIST}`);
  console.log(`Total size: ${(bytes / 1048576).toFixed(1)} MB${DEV ? " (dev build)" : ""}`);
}

try {
  main();
} catch (error) {
  console.error(`BUILD FAILED: ${error.message}`);
  process.exit(1);
}
