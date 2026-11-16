/** Native Windows file/folder dialogs. The browser never uploads file contents. */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";

const FILE_FILTER =
  "Videos and pictures|*.mp4;*.mov;*.mkv;*.avi;*.webm;*.m4v;*.wmv;*.flv;" +
  "*.jpg;*.jpeg;*.png;*.webp;*.gif;*.bmp;*.tiff;*.heic|All files|*.*";

/**
 * Windows will not hand the foreground to a background process, so a dialog
 * started from the local server can open BEHIND the browser and look like
 * "nothing happened". This helper re-asserts topmost + foreground while the
 * dialog is open.
 */
const FORCE_VISIBLE = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class SqueezeTop {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public static void Force(string title) {
    IntPtr h = FindWindow(null, title);
    if (h == IntPtr.Zero) return;
    SetWindowPos(h, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002);
    BringWindowToTop(h);
    SetForegroundWindow(h);
  }
}
"@
Add-Type -AssemblyName System.Windows.Forms
$force = New-Object System.Windows.Forms.Timer
$force.Interval = 250
$force.add_Tick({ [SqueezeTop]::Force('__TITLE__') })
$force.Start()
`;

function forceVisible(title) {
  return FORCE_VISIBLE.replace("__TITLE__", title);
}

function parsePaths(text) {
  return (text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Blocking helper for short startup jobs such as the desktop shortcut. */
function runPowerShellSync(script) {
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-STA", "-Command", script],
    { encoding: "utf8" },
  );
  if (result.error || result.status !== 0) {
    return { ok: false, paths: [], error: result.error?.message || "That did not work." };
  }
  return { ok: true, paths: parsePaths(result.stdout) };
}

/**
 * Dialog helper that does NOT block the server. While a dialog is open the
 * page can keep polling progress, and the 60-second idle check keeps working.
 */
function runPowerShell(script) {
  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-STA", "-Command", script],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: false },
    );
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.on("error", (error) => {
      resolve({ ok: false, paths: [], error: error.message });
    });
    child.on("close", (code) => {
      if (code !== 0) {
        resolve({
          ok: false,
          paths: [],
          error: "The file picker could not open. Try again, or close and reopen SqueezeIt.",
        });
        return;
      }
      resolve({ ok: true, paths: parsePaths(out) });
    });
  });
}

const FILES_TITLE = "Choose files to make smaller";
const FOLDER_TITLE = "Choose a folder of files to make smaller";
const SAVE_TITLE = "Save a copy";

const esc = (s) => String(s).replaceAll("'", "''");

export function chooseFiles() {
  const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
${forceVisible(FILES_TITLE)}
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Multiselect = $true
$d.Title = '${FILES_TITLE}'
$d.Filter = '${FILE_FILTER}'
$answer = $d.ShowDialog()
$force.Stop()
if ($answer -eq [System.Windows.Forms.DialogResult]::OK) {
  $d.FileNames | ForEach-Object { Write-Output $_ }
}
`;
  return runPowerShell(script);
}

export function chooseFolder() {
  const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
${forceVisible(FOLDER_TITLE)}
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = '${FOLDER_TITLE}'
$d.ShowNewFolderButton = $false
$answer = $d.ShowDialog()
$force.Stop()
if ($answer -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $d.SelectedPath
}
`;
  return runPowerShell(script);
}

/** Ask where to put a copy: a file name for one file, a folder for several. */
export function chooseSaveTarget(files, startDir = "") {
  const list = Array.isArray(files) ? files.filter(Boolean) : [];
  if (!list.length) return Promise.resolve({ ok: true, paths: [] });
  const initial = startDir && fs.existsSync(startDir) ? `$d.InitialDirectory = '${esc(startDir)}'` : "";

  if (list.length === 1) {
    const name = String(list[0]).split(/[\\/]/).pop() || "smaller copy";
    const ext = (name.match(/\.([^.\\/]+)$/) || [])[1] || "";
    const filter = ext ? `${ext.toUpperCase()} file|*.${ext}|All files|*.*` : "All files|*.*";
    const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
${forceVisible(SAVE_TITLE)}
$d = New-Object System.Windows.Forms.SaveFileDialog
$d.Title = '${SAVE_TITLE}'
$d.FileName = '${esc(name)}'
$d.Filter = '${filter}'
$d.AddExtension = $true
$d.OverwritePrompt = $true
${initial}
$answer = $d.ShowDialog()
$force.Stop()
if ($answer -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $d.FileName
}
`;
    return runPowerShell(script);
  }

  const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
${forceVisible(FOLDER_TITLE)}
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'Choose where to put the copies'
$d.ShowNewFolderButton = $true
${initial}
$answer = $d.ShowDialog()
$force.Stop()
if ($answer -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $d.SelectedPath
}
`;
  return runPowerShell(script);
}

/** First-run desktop shortcut via WScript.Shell COM. */
export function createDesktopShortcut(targetVbs, productRoot) {
  const esc = (s) => String(s).replaceAll("'", "''");
  const script = `
$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcut = $ws.CreateShortcut((Join-Path $desktop 'SqueezeIt.lnk'))
$shortcut.TargetPath = '${esc(targetVbs)}'
$shortcut.WorkingDirectory = '${esc(productRoot)}'
$shortcut.Description = 'SqueezeIt - make files smaller'
$shortcut.Save()
Write-Output 'ok'
`;
  const result = runPowerShellSync(script);
  return result.ok && result.paths.includes("ok");
}
