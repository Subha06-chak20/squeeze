/** File analysis with ffprobe and recursive folder scanning. */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { kindOf, extensionOf, NOT_SUPPORTED_TEXT } from "./recommend.mjs";

const SKIP_DIRS = new Set(["Smaller files", "$RECYCLE.BIN", "System Volume Information"]);

export function probeFile(ffprobe, filePath) {
  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    // The file may have vanished; analysis will report it as unreadable.
  }
  const kind = kindOf(filePath);
  const analysis = {
    path: filePath,
    name: path.basename(filePath),
    kind,
    size,
    supported: kind !== "unsupported",
    supportedText: kind === "unsupported" ? NOT_SUPPORTED_TEXT : "",
    error: "",
    imageExt: extensionOf(filePath),
  };
  if (kind === "unsupported") return analysis;

  try {
    const result = spawnSync(
      ffprobe,
      ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath],
      { encoding: "utf8", windowsHide: true, timeout: 60000, maxBuffer: 20 * 1024 * 1024 },
    );
    if (result.status !== 0 || result.error) {
      analysis.error = "We could not read this file. It may be damaged or open in another program.";
      analysis.supported = false;
      analysis.supportedText = "This file could not be read.";
      return analysis;
    }
    const json = JSON.parse(result.stdout || "{}");
    const format = json.format || {};
    const stream =
      (json.streams || []).find((s) => s.codec_type === "video") || {};
    analysis.durationSec = Number(format.duration) || 0;
    analysis.videoBitrateKbps = Number(stream.bit_rate) / 1000 || 0;
    analysis.bitrateKbps = Number(format.bit_rate) / 1000 || analysis.videoBitrateKbps;
    analysis.width = Number(stream.width) || 0;
    analysis.height = Number(stream.height) || 0;
    analysis.frames = Number(stream.nb_frames) || 0;
    const rate = String(stream.r_frame_rate || stream.avg_frame_rate || "0/1");
    const [num, den] = rate.split("/").map(Number);
    analysis.fps = den ? num / den : 0;
  } catch {
    analysis.error = "We could not read this file. It may be damaged or open in another program.";
    analysis.supported = false;
    analysis.supportedText = "This file could not be read.";
  }
  return analysis;
}

export function scanFolder(folder, options = {}) {
  const supportedOnly = options.supportedOnly ?? false;
  const files = [];
  const notes = [];
  const walk = (dir, depth = 0) => {
    if (depth > 24) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      notes.push(`Could not look inside: ${dir}`);
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        if (entry.name.startsWith(".squeezeit-")) continue;
        const kind = kindOf(entry.name);
        const supported = kind !== "unsupported";
        if (supportedOnly && !supported) continue;
        let size = 0;
        try {
          size = fs.statSync(full).size;
        } catch {
          notes.push(`Could not read: ${entry.name}`);
          continue;
        }
        files.push({
          path: full,
          name: entry.name,
          kind,
          size,
          supported,
          supportedText: supported ? "" : NOT_SUPPORTED_TEXT,
        });
      }
    }
  };
  walk(folder);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, notes };
}
