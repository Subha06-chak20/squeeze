/** DEV probe: does SendKeys drive the native OpenFileDialog? */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dialogsUrl = pathToFileURL(path.join(ROOT, "app", "lib", "dialogs.mjs")).href;
const out = path.join(os.tmpdir(), "sq-dialog-probe-result.txt");
fs.rmSync(out, { force: true });
const file = process.argv[2];
const child = spawn(process.execPath, ["--input-type=module", "-e",
  `import {chooseFiles} from ${JSON.stringify(dialogsUrl)};
   import fs from "node:fs";
   const r = chooseFiles();
   fs.writeFileSync(${JSON.stringify(out)}, JSON.stringify(r));`], { stdio: "ignore" });

async function keys() {
  await new Promise((r) => setTimeout(r, 2500));
  const script = `
    $ws = New-Object -ComObject WScript.Shell
    $found = $false
    for ($i = 0; $i -lt 20; $i++) {
      $found = $ws.AppActivate('Choose files to make smaller')
      if ($found) { break }
      Start-Sleep -Milliseconds 250
    }
    Write-Output "activate=$found"
    Start-Sleep -Milliseconds 800
    $ws.SendKeys('%n')
    Start-Sleep -Milliseconds 400
    $ws.SendKeys('${file}')
    Start-Sleep -Milliseconds 500
    $ws.SendKeys('{ENTER}')
  `;
  const listed = spawnSync("powershell", ["-NoProfile", "-Command",
    "Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object ProcessName,MainWindowTitle | Format-Table -AutoSize | Out-String"], { encoding: "utf8" });
  console.log("windows:\n", (listed.stdout || "").trim());
  const r = spawnSync("powershell", ["-NoProfile", "-STA", "-Command", script], { encoding: "utf8" });
  console.log("keys:", (r.stdout || "").trim(), (r.stderr || "").trim());
}
await keys();
for (let i = 0; i < 100; i++) {
  if (fs.existsSync(out)) break;
  await new Promise((r) => setTimeout(r, 100));
}
console.log("result:", fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "NO RESULT");
// Kill the whole tree so a still-open native dialog is not left behind.
spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
child.kill();
