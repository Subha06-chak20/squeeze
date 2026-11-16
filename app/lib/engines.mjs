/** Locate and verify the bundled engines. In development we fall back to PATH. */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PRODUCT_ROOT = path.resolve(HERE, "..", "..");

export function resolveEngines() {
  const nodeBundled = path.join(PRODUCT_ROOT, "node", "node.exe");
  const ffmpegBundled = path.join(PRODUCT_ROOT, "bin", "ffmpeg.exe");
  const ffprobeBundled = path.join(PRODUCT_ROOT, "bin", "ffprobe.exe");
  return {
    node: fs.existsSync(nodeBundled) ? nodeBundled : process.execPath,
    ffmpeg: fs.existsSync(ffmpegBundled) ? ffmpegBundled : "ffmpeg",
    ffprobe: fs.existsSync(ffprobeBundled) ? ffprobeBundled : "ffprobe",
  };
}

function probe(command, flag = "-version") {
  try {
    const result = spawnSync(command, [flag], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
    });
    if (result.error) return { ok: false, message: result.error.message };
    if (result.status !== 0) return { ok: false, message: "It did not start." };
    const firstLine = (result.stdout || result.stderr || "")
      .split(/\r?\n/)
      .find((line) => line.trim());
    return { ok: true, version: (firstLine || "Ready").slice(0, 120) };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

export function verifyEngines(engines) {
  const names = [
    ["SqueezeIt's own copy of Node.js", engines.node, "--version"],
    ["ffmpeg.exe", engines.ffmpeg, "-version"],
    ["ffprobe.exe", engines.ffprobe, "-version"],
  ];
  return names.map(([name, command, flag]) => {
    const result = probe(command, flag);
    return {
      name,
      path: command,
      ok: result.ok,
      detail: result.ok
        ? result.version
        : `Windows could not start ${name}. Restore the file and allow it in your antivirus, then start SqueezeIt again.`,
    };
  });
}
