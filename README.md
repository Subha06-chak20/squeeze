# SqueezeIt

SqueezeIt is a free, open-source, fully offline Windows application for compressing videos and images. It runs locally as a lightweight Node.js server (`127.0.0.1`) paired with a browser UI. Nothing is uploaded, no user account is required, and the application makes no outbound network connections.

---

## Current Status & Verification State

> [!IMPORTANT]
> To ensure transparency and integrity, features and behaviors are only documented as working when verified in code or tests. Unverified areas are explicitly stated below.

| Area / Feature | Status | Details |
|---|---|---|
| **Core Compression** | **Verified** | Server-side video (H.264/AAC) and image (JPEG/PNG/WebP) compression via FFmpeg passes all 22 unit tests (`npm test`) and full smoke test (`npm run smoke`). |
| **Original File Safety** | **Verified** | Verified by SHA-256 before and after processing. Outputs are written only to a private `%TEMP%` scratch directory until explicitly saved. Nothing is saved beside originals. |
| **Stop Mid-Job** | **Verified** | Stopping a job immediately kills worker processes and wipes partial (`.squeezeit-*`) scratch files. |
| **SSIM Quality Metric** | **Verified** | Output quality labels ("Looks the same") are computed using measured FFmpeg SSIM filters, not hardcoded guesses. |
| **Development Path** | **Pure Node.js** | The earlier Rust/Tauri path was completely abandoned. The application is pure Node.js (standard library only; zero runtime npm dependencies). |
| **Bundled Engines** | **Unconfirmed Origin** | The repository includes copies of `node.exe`, `ffmpeg.exe`, and `ffprobe.exe` used for local testing, but their provenance has not been verified against official upstream releases. Release packaging requires pinning SHA-256 hashes via `engines.json`. |
| **Native "Choose Files" Dialog** | **Unverified / Treated as Broken** | The native Windows file selection dialog failed to appear during automated verification runs. Until resolved and verified on a clean machine, treat this UI dialog path as broken. |
| **Clean-PC & SmartScreen** | **Unverified** | Testing on a clean Windows 10/11 machine without developer tools, Windows SmartScreen behavior with unsigned binaries, and long-idle auto-exit have not yet been fully validated. |

---

## Getting Started on a New Windows PC

You can clone this repository onto any Windows machine and immediately run, develop, and test SqueezeIt.

### 1. Prerequisites

- **Operating System:** Windows 10 or 11 (64-bit).
- **Node.js:** Node.js v20+ (v22+ or v24 LTS recommended, with native `node:test` support).
  - Verify with: `node --version`
- **FFmpeg & FFprobe:** Installed and accessible on your system `PATH` for development.
  - Install via winget:
    ```powershell
    winget install Gyan.FFmpeg
    ```
  - Or download from [gyan.dev/ffmpeg/builds](https://www.gyan.dev/ffmpeg/builds/) and add its `bin/` directory to your user `PATH`.
  - Verify with:
    ```powershell
    ffmpeg -version
    ffprobe -version
    ```
- **Git:** Git for Windows.

### 2. Clone the Repository

```powershell
git clone https://github.com/<owner>/squeezeit.git
cd squeezeit
```

Because SqueezeIt relies entirely on Node.js built-in modules (`http`, `fs`, `path`, `crypto`, `child_process`), there are **no runtime npm dependencies to install**. Running `npm install` is optional (audits 0 dependencies).

### 3. Run the Development Server

You can run the server directly using your system Node.js:

```powershell
node app/server.mjs
```

**How engine resolution works:**
`app/lib/engines.mjs` checks whether bundled binaries exist under `node/node.exe` and `bin/ffmpeg.exe`. If they are not found, it automatically falls back to your active system `node` executable (`process.execPath`) and `ffmpeg`/`ffprobe` available on your `PATH`.

When started:
1. The server binds `127.0.0.1` on a free, OS-assigned port (or `SQUEEZEIT_PORT`).
2. Generates a cryptographically random session token.
3. Automatically opens your default web browser to `http://127.0.0.1:<port>/?t=<token>`.

### 4. Environment Variables

The server supports several environment variables for testing and automation:

| Variable | Default | Purpose |
|---|---|---|
| `SQUEEZEIT_PORT` | `0` (random free port) | Set a fixed port for the local HTTP server. |
| `SQUEEZEIT_NO_BROWSER` | `0` | Set to `1` to prevent automatically launching the system browser. |
| `SQUEEZEIT_SKIP_SHORTCUT` | `0` | Set to `1` to skip automatic desktop shortcut creation. |
| `SQUEEZEIT_TOKEN` | Random 32-byte hex | Specify a fixed session authorization token. |
| `SQUEEZEIT_TEST_LOG_TOKEN` | `0` | Set to `1` to log the full token URL in console output instead of `t=***`. |

Example:
```powershell
$env:SQUEEZEIT_NO_BROWSER="1"
$env:SQUEEZEIT_PORT="8080"
node app/server.mjs
```

---

## Testing & Quality Assurance

SqueezeIt includes unit tests and an automated end-to-end smoke test that runs without requiring browser interactions.

### Run Unit Tests
Executes 22 unit tests using Node's built-in test runner across format recommendations, FFmpeg argument generation, bitrate allocation, and naming:
```powershell
npm test
```

### Run End-to-End Smoke Test
Launches a test server, analyzes media files, runs real video and image compression, verifies byte limits and SSIM calculation, tests early job cancellation ("Stop"), and confirms no partial files or unwanted artifacts are left behind:
```powershell
npm run smoke
```

---

## Building the Portable Application

SqueezeIt is packaged as a zero-install portable Windows folder.

### Development Build (Local Tools)
To create a local test folder using your machine's installed Node and FFmpeg:
```powershell
npm run build -- --dev
```
This stages the distribution folder into `dist/SqueezeIt`:
- Copies the launcher: `Start SqueezeIt.vbs`
- Copies the backend: `app/server.mjs`, `app/lib/`, `app/public/`
- Copies local `node.exe` into `node/` and `ffmpeg.exe` / `ffprobe.exe` into `bin/`
- Generates `LICENSES.txt` and `SHA256SUMS.txt`

To verify the staged files and checksums:
```powershell
npm run verify
```

To launch the staged build:
Double-click `dist\SqueezeIt\Start SqueezeIt.vbs` (or run it from PowerShell). It starts the bundled Node server silently without displaying a black command window.

### Production Release Build (Pinned Engines)
For an official release build:
1. Copy `engines.example.json` to `engines.json`.
2. Download verified release binaries for Node.js (Windows x64 zip) and FFmpeg/FFprobe (gyan.dev essentials release).
3. Place them in `engines-input/`:
   - `engines-input/node/node.exe`
   - `engines-input/bin/ffmpeg.exe`
   - `engines-input/bin/ffprobe.exe`
4. Update `engines.json` with the exact upstream versions, download URLs, and expected SHA-256 hashes.
5. Run:
   ```powershell
   npm run build
   ```
   The build script verifies each binary's SHA-256 hash before creating `dist/SqueezeIt`. It refuses to build if any hash does not match.

---

## Project Structure

```
.
├── .gitignore               # Ignores node_modules, dist, release, engines-input, logs
├── LICENSE                  # GNU General Public License v3.0
├── README.md                # Project documentation and developer guide
├── RELEASE-CHECKLIST.md     # Verification status checklist
├── VERIFY-WALKTHROUGH.md    # Manual verification walk-through instructions
├── package.json             # Scripts: test, build, verify, smoke
├── engines.example.json     # Pinned engine manifest template for official releases
├── Start SqueezeIt.vbs      # VBScript launcher that hides console window
├── START-HERE.txt           # Plain-text user instructions for portable bundle
├── app/
│   ├── server.mjs           # HTTP server, routing, job manager, and engine verifier
│   ├── lib/
│   │   ├── analysis.mjs     # FFprobe metadata extraction and directory scanning
│   │   ├── dialogs.mjs      # Windows file dialogs and shortcut creation
│   │   ├── encoder.mjs      # FFmpeg command builders, progress and SSIM parsers
│   │   ├── engines.mjs      # Engine discovery, fallback to PATH, and probe checks
│   │   ├── naming.mjs       # Safe output naming and collision avoidance
│   │   ├── paths.mjs        # AppData settings and scratch space management
│   │   └── recommend.mjs    # Format filtering and compression preset rules
│   └── public/              # Browser frontend (vanilla HTML5, CSS3, ES modules)
│       ├── index.html       # Single-page interface markup
│       ├── app.js           # Frontend logic, state, and API requests
│       ├── style.css        # Responsive layout and theme styling
│       └── favicon.svg      # SqueezeIt application icon
├── build/
│   ├── stage.mjs            # Stages the portable folder in dist/SqueezeIt
│   ├── verify.mjs           # Validates staged files against SHA256SUMS
│   ├── smoke.mjs            # End-to-end compression and server smoke tests
│   └── dialog-probe.mjs     # Test probe for Windows file dialog automation
├── tests/
│   ├── encoder.test.mjs     # Unit tests for FFmpeg arguments and progress parsing
│   ├── naming.test.mjs      # Unit tests for output file naming and uniqueness
│   └── recommend.test.mjs   # Unit tests for format handling and preset calculations
└── scripts/
    └── engines.json         # Local test engine hash reference
```

---

## Security & Privacy Model

- **Local-Only Binding:** The HTTP server binds exclusively to `127.0.0.1`. It never listens on external interfaces (`0.0.0.0`).
- **Token Protection:** Every API request must include the session token in the `x-squeezeit-token` header or `?t=` query parameter. Requests lacking a valid token are rejected with HTTP 403.
- **Zero External Connections:** The application contains no telemetry, analytics, updater calls, or remote network dependencies.
- **Temporary File Isolation:** Working files are encoded inside `%TEMP%\SqueezeIt\job-<id>`. Files are only copied to the destination folder when explicitly requested by the user.

---

## License

SqueezeIt is licensed under the **GNU General Public License v3.0 or later** ([GPL-3.0-or-later](LICENSE)).
Third-party bundled components (Node.js, FFmpeg) are distributed under their respective MIT and GPL licenses as detailed in `LICENSES.txt` upon staging.
