# Release checklist — SqueezeIt 1.0.0

Run in `<repo-root>` on 2026-11-16. Environment: Windows, Node 24.13.1,
FFmpeg/ffprobe 8.1.2 on PATH. No pinned release `engines.json` or
`engines-input/` is present, so the **release** build was not run; a **dev**
folder was staged with local tools.

Legend: **PASS** = actually run here · **FAIL** = run and wrong ·
**NOT TESTED** = could not be run here.

## Code and tests

| Check | Result | Evidence |
|---|---|---|
| Pure logic unit tests | **PASS** | `npm test`: 18/18 passing (`node --test`, no npm packages). |
| Frontend syntax | **PASS** | `node --check app/public/app.js` passes; HTML/CSS reviewed. |
| No runtime dependencies | **PASS** | package.json has no `dependencies`; runtime imports are all `node:` built-ins or local `./lib/*.mjs`. |
| Dev folder staging | **PASS** | `npm run build -- --dev` staged 18 files into `dist/SqueezeIt` using local engines. |
| Staged file list and hashes | **PASS** | `npm run verify`: 18 hashes across 19 files, SHA256SUMS excludes itself only. |
| Pinned release build with SHA-256 enforcement | **NOT TESTED** | `engines.json` / `engines-input/` not supplied here. Code path exists and stops on mismatch. |

## End-to-end smoke test (real server + ffmpeg)

| Check | Result | Evidence |
|---|---|---|
| Server starts, token accepted | **PASS** | smoke test. |
| Request without token rejected | **PASS** | returned 403. |
| Video + image analysed; PDF reported "Not supported in this version." | **PASS** | smoke test. |
| Batch starts and finishes | **PASS** | 2 files succeeded, 0 failed. |
| Output names use " (smaller)" and keep extensions | **PASS** | `clip (smaller).mp4`, `photo (smaller).png`. |
| Quality labels backed by measured SSIM | **PASS** | both outputs labelled "Looks the same" after SSIM ≥ 0.98 checks. |
| No partial files after a job | **PASS** | no `.squeezeit-*` files remained. |
| Originals unchanged | **PASS** | SHA-256 of each original identical before/after. |
| Stop mid-batch kills encoder and leaves no partial file | **PASS** | longer video stopped mid-encode; output folder had no temp files. |
| Engine startup check stops with a plain message | **PARTIALLY TESTED** | observed when Node was probed with the wrong flag: the browser error page was started. After fixing the flag, all three engines passed. |
| Auto-exit after 60 s idle | **NOT TESTED** | implemented, not waited out in tests. |
| Desktop shortcut created once on first run | **NOT TESTED** | skipped in tests via env hook; PowerShell COM code not executed here. |
| Native file/folder dialogs | **NOT TESTED** | no interactive desktop session in this environment. |
| Browser UI rendering, keyboard and screen-reader labels | **NOT TESTED** | static review only; no browser session here. |
| 1000-file batch / very large files | **NOT TESTED** | not exercised. |
| Verification through WhatsApp | **NOT TESTED** | no real release zip or WhatsApp client here. |
| Offline operation (network fully disabled) | **NOT TESTED at OS level** | code makes no outbound calls; server binds only 127.0.0.1. |

## Summary

The core product — local server, token gate, engine checks, analysis,
recommendation, encoding, SSIM-backed labels, naming, original safety and Stop
cleanup — is implemented and **verified by tests and a real smoke run**. The
parts that need a human desktop (dialogs, shortcut, browser UI, WhatsApp,
offline VM) and a pinned release build remain **NOT TESTED** here.

Do not call this a verified release until those items are completed on a clean
Windows machine with the pinned engines.
