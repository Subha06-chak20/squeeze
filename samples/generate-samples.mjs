/**
 * Create a small test file for every supported format.
 * Run: node samples/generate-samples.mjs
 * Needs ffmpeg on PATH (or set FFMPEG=/path/to/ffmpeg).
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";

const FFMPEG = process.env.FFMPEG ?? (process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const out = path.resolve("samples/generated");
fs.mkdirSync(out, { recursive: true });

function run(args) {
  const r = spawnSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error((r.stderr || "").trim().split(/\r?\n/).pop() || "ffmpeg failed");
}

function makeVideo(name, extra = []) {
  run(["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=15", "-t", "2",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", ...extra,
    path.join(out, name)]);
}

function makeImage(name, extra = []) {
  run(["-f", "lavfi", "-i", "gradients=size=480x320", "-frames:v", "1", ...extra, path.join(out, name)]);
}

function tryIt(label, fn) {
  try { fn(); console.log(`OK      ${label}`); }
  catch (e) { console.log(`SKIP    ${label} (${e.message.slice(0, 90)})`); }
}

// --- video ---
const videos = [
  ["sample.mp4", []],
  ["sample.mov", ["-c:v", "mpeg4"]],
  ["sample.mkv", []],
  ["sample.avi", ["-c:v", "mpeg4"]],
  ["sample.webm", ["-c:v", "libvpx-vp9"]],
  ["sample.m4v", ["-c:v", "mpeg4"]],
  ["sample.flv", ["-c:v", "libx264"]],
  ["sample.wmv", ["-c:v", "wmv2", "-f", "asf"]],
];
for (const [name, extra] of videos) tryIt(name, () => makeVideo(name, extra));

// --- image ---
tryIt("sample.jpg", () => makeImage("sample.jpg", ["-q:v", "3"]));
tryIt("sample.jpeg", () => makeImage("sample.jpeg", ["-q:v", "3"]));
tryIt("sample.png", () => makeImage("sample.png"));
tryIt("sample.webp", () => makeImage("sample.webp", ["-c:v", "libwebp", "-quality", "90"]));
tryIt("sample.gif", () => makeImage("sample.gif"));
tryIt("sample.bmp", () => makeImage("sample.bmp"));
tryIt("sample.tiff", () => makeImage("sample.tiff"));
tryIt("sample.heic", () => makeImage("sample.heic", ["-c:v", "libx265", "-tag:v", "hvc1", "-f", "heic"]));

// --- audio ---
tryIt("sample.mp3", () => run(["-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "libmp3lame", path.join(out, "sample.mp3")]));
tryIt("sample.wav", () => run(["-f", "lavfi", "-i", "sine=frequency=440:duration=2", path.join(out, "sample.wav")]));
tryIt("sample.m4a", () => run(["-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "aac", path.join(out, "sample.m4a")]));
tryIt("sample.flac", () => run(["-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "flac", path.join(out, "sample.flac")]));

// --- PDF (hand-written, tiny, valid) ---
tryIt("sample.pdf", () => {
  const text = "BT /F1 24 Tf 72 700 Td (SqueezeIt sample PDF) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  fs.writeFileSync(path.join(out, "sample.pdf"), pdf);
});

// --- Office files (minimal zip containers, enough to exercise detection) ---
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function makeZip(entries) {
  const parts = []; const central = []; let offset = 0;
  for (const [name, content] of entries) {
    const nameBuf = Buffer.from(name); const data = Buffer.from(content); const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cdBuf = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}
tryIt("sample.docx", () => fs.writeFileSync(path.join(out, "sample.docx"), makeZip([["[Content_Types].xml", "<Types/>"], ["word/document.xml", "<document/>"]])));
tryIt("sample.pptx", () => fs.writeFileSync(path.join(out, "sample.pptx"), makeZip([["[Content_Types].xml", "<Types/>"], ["ppt/presentation.xml", "<presentation/>"]])));
tryIt("sample.xlsx", () => fs.writeFileSync(path.join(out, "sample.xlsx"), makeZip([["[Content_Types].xml", "<Types/>"], ["xl/workbook.xml", "<workbook/>"]])));

const files = fs.readdirSync(out);
console.log(`\n${files.length} sample files in ${out}`);
