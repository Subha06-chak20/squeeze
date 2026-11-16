/** App data, settings and logging. Never writes inside the SqueezeIt folder. */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function appDataDir() {
  const base = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  const dir = path.join(base, "SqueezeIt");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function settingsPath() {
  return path.join(appDataDir(), "settings.json");
}

export function logPath() {
  return path.join(appDataDir(), "SqueezeIt.log");
}

/**
 * Scratch space for freshly compressed files. Nothing is written beside the
 * user's originals; a copy is only made when the user saves one.
 */
export function workRoot() {
  const dir = path.join(os.tmpdir(), "SqueezeIt");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function log(message) {
  try {
    const line = `${new Date().toISOString()} ${message}\n`;
    fs.appendFileSync(logPath(), line, "utf8");
  } catch {
    // Logging must never break the app.
  }
}

export const DEFAULT_SETTINGS = {
  welcomeSeen: false,
  shortcutCreated: false,
  outputDir: null,
  aspect: "original",
  maxWidth: null,
  parallelJobs: 1,
  convertToWebp: false,
  maxBytes: null,
  maxSizeUnit: "MB",
  theme: "auto",
};

export function loadSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
  } catch (error) {
    log(`Could not save settings: ${error.message}`);
  }
}
