# Transfer report — SqueezeIt 1.1.0 TEST zip

This report records the gates and checks that were actually run in this task,
and the checks that were not. No app code was modified. The zip was not
uploaded, published, or sent anywhere.

## 1. Gate results

| Gate | Result | Evidence |
|---|---|---|
| G1 — engine hashes and honest status | **PASS** | `scripts\engines.json` exists. Its `status` is exactly `"LOCAL TEST ONLY - not release-verified"`. SHA-256 values were recomputed with `Get-FileHash` against the actual files and all three matched: `bin\ffmpeg.exe` `ad8f211b…942e`, `bin\ffprobe.exe` `9df3b0b5…5015`, `node\node.exe` `e3be0545…6e50`. No hash was changed. |
| G2 — server starts, prints URL, serves page | **PASS** | Started with `node\node.exe app\server.mjs` bound to `127.0.0.1` (OS-chosen port). The application log printed `SqueezeIt ready at http://127.0.0.1:59407/?t=…`. One request to that exact URL returned **HTTP 200**, `Content-Type: text/html; charset=utf-8`, and the body contained `SqueezeIt` and `Choose files`. The server was stopped afterward (verified process gone). The first attempt failed only because the test harness read an empty log file; that was a harness bug, not a gate result, and the corrected request above passed. A check for the literal `<title>SqueezeIt</title>` was false because the real title is `SqueezeIt — make big files small`; the gate's "contains the SqueezeIt page" requirement was met. Test-only environment hooks used for this gate: a temporary `APPDATA`, `SQUEEZEIT_TEST_LOG_TOKEN=1`, `SQUEEZEIT_NO_BROWSER=1`, `SQUEEZEIT_SKIP_SHORTCUT=1`. |
| G3 — native "Choose files" dialog visible | **PASS** | Invoked `/api/dialog/files` on a freshly started server. Window enumeration found a window titled exactly **`Choose files to make smaller`**, class `#32770`, **`visible=True`**, **`topmost=True`**, non-zero rectangle `8,31,1154,676`. The server answered `/api/status` in 1 ms while the dialog was open, so it was not frozen. The dialog was then deliberately force-closed, which is why the API result file recorded `"The file picker could not open…"`; that error is a consequence of the cleanup, not a failure to display the dialog. Confirmation came from the OS window state of the window created by the server-side call, not from the generic title "Open". |

All three gates passed, so the zip was created.

## 2. Zip

| Property | Value |
|---|---|
| Path | `release\SqueezeIt-1.1.0-windows-TEST.zip` |
| Version source | `package.json` → `1.1.0` |
| Size in bytes | **217,940,781** |
| SHA-256 of zip | `d96e7fabb5fc6e319100ca83902d53bb2b95709efd668619dcb0d4bae8ef6b9c` |
| Compression | Normal (`Compress-Archive -CompressionLevel Optimal`) |
| Root folder inside zip | `SqueezeIt` — every entry is prefixed `SqueezeIt\`; 21 file entries total |

"TEST" is retained in the filename because the engine hashes are explicitly
labelled local-test-only and are not release-verified.

## 3. Staged folder and extracted verification

`build\stage.mjs --dev` was run against the current source. It reported
`Staged 20 files in dist\SqueezeIt` (the 21st file,
`SHA256SUMS.txt`, is generated after that count). The staged file list matched
Step 1 exactly, with nothing else.

The zip was extracted to a temporary folder outside the project
(`%TEMP%\opencode\squeezeit-zipcheck-…`). Results:

- **File list:** 21 expected / 21 actual; **0 missing**, **0 extra**.
  `LICENSE`, `LICENSES.txt`, `START-HERE.txt`, `Start SqueezeIt.vbs`,
  `SHA256SUMS.txt`, `package.json`, `node\node.exe`, `bin\ffmpeg.exe`,
  `bin\ffprobe.exe`, `app\server.mjs`, `app\public\{app.js,favicon.svg,index.html,style.css}`,
  `app\lib\{analysis,dialogs,encoder,engines,naming,paths,recommend}.mjs`.
- **Hash check:** 20 entries in `SHA256SUMS.txt`, **0 failures**. Every extracted
  file matched its recorded SHA-256.
- **Engine first lines from the extracted copy:**
  - `node\node.exe --version` → `v24.13.1`
  - `bin\ffmpeg.exe -version` → `ffmpeg version 8.1.2-full_build-www.gyan.dev Copyright (c) 2000-2026 the FFmpeg developers`
  - `bin\ffprobe.exe -version` → `ffprobe version 8.1.2-full_build-www.gyan.dev Copyright (c) 2007-2026 the FFmpeg developers`
- **Forbidden content:** no `settings.json`, no `*.log`, no files named `sample*`.
- The temporary extraction folder was deleted afterwards (verified gone).

Note: after Step 2 changed the staged `START-HERE.txt`, its hash in
`SHA256SUMS.txt` was stale. `SHA256SUMS.txt` in `dist\SqueezeIt` was therefore
regenerated (same header/format as `build\stage.mjs`) so that Step 4's hash
comparison would be meaningful. The new line for that file is
`b18921bc2881a1a34d5f3f1452ef176e4886ced6982043b9a798136bc1dae097  START-HERE.txt`.

## 4. START-HERE.txt changes (staged copy only)

Only `dist\SqueezeIt\START-HERE.txt` was changed; the project-root
`START-HERE.txt` was left untouched. No other content was added.

**Old text replaced:**

```
* To remove SqueezeIt, just delete the SqueezeIt folder and the Desktop icon.
  There is nothing else to uninstall.
```

**New text:**

```
* Keep the SqueezeIt folder where you first started it. The desktop icon points to that location. If you move the folder, delete the old icon and start SqueezeIt again from the new location.

* Only run one copy of SqueezeIt at a time.

* Windows may require a web browser (Chrome or Edge) to be installed.

* To remove SqueezeIt, close it first, then delete these three places:

  1. The SqueezeIt app folder. Open File Explorer, find the folder named
     SqueezeIt (it is on the Desktop unless you moved it), right-click it and
     choose Delete.

  2. The Desktop icon named SqueezeIt. Right-click it on the Desktop and
     choose Delete.

  3. The settings and log folder, %APPDATA%\SqueezeIt. Open File Explorer,
     go to your own user folder, then AppData, then Roaming, then SqueezeIt,
     and delete that SqueezeIt folder. If AppData is not visible, choose
     Hidden items in the View menu of File Explorer.

  The temporary work folder, %TEMP%\SqueezeIt, is also safe to delete.
  Open File Explorer, go to your own user folder, then AppData, then Local,
  then Temp, then SqueezeIt, and delete that SqueezeIt folder. It holds only
  temporary work files. There is nothing else to uninstall.
```

No terminal command appears in these user instructions.

## 5. Absolute-path search

Searched the extracted `app\` tree (all files), `START-HERE.txt`,
`Start SqueezeIt.vbs` and `LICENSES.txt` for the literal strings `D:\`,
`C:\Users\` and `dist\`. **Result: no matches.** No placeholder paths were
found either.

## 6. What was NOT tested

The following were not tested in this task and are not claimed:

- a second Windows PC;
- a standard user account on a clean machine;
- networking disabled at OS level;
- the desktop shortcut on a second launch;
- closing the browser tab and confirming the 60-second auto-exit;
- Stop mid-job;
- original-file integrity after a real compression job;
- Windows SmartScreen behaviour;
- whether the Visual C++ runtime is required;
- whether a browser is present/installed on the target machine;
- a pinned release build (`engines.json` + `engines-input\` are not in the project);
- Windows 10 specifically;
- native dialog click-through (file selection itself);
- large/1000-file batches, accessibility, and WhatsApp transfer.

## 7. Provenance

`scripts\engines.json` states `"status": "LOCAL TEST ONLY - not release-verified"`.
The hashes were taken from local copies, and `README.md` records that the
original download source of the bundled binaries is **not confirmed**.

- `bin\ffmpeg.exe` — origin **not confirmed against an official release**.
  (`README.md` notes its hash matched a locally installed Gyan.FFmpeg 8.1.2
  build, but that is not an official-release confirmation.)
- `bin\ffprobe.exe` — origin **not confirmed against an official release**.
- `node\node.exe` — origin **not confirmed against an official release**.

## 8. Final verdict

**Not ready for non-technical testers.**

All three gates passed and the zip was built and verified, but the clean-PC
items listed in section 6 have not been tested, so the condition for
"Ready for a technical tester on a second PC" is not met.
