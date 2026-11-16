import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVideoArgs, buildImageArgs, videoCodecArgs, imageQualityArgs,
  targetBitrates, videoBitrateCodecArgs,
  parseProgress, parseSsim, qualityLabel, hardwareTestArgs,
  aspectFilter, HARDWARE_ENCODERS,
} from "../app/lib/encoder.mjs";

test("CPU video args use H.264, AAC 128k, faststart and progress output", () => {
  const args = buildVideoArgs({ input: "in.mp4", output: "out.mp4", slider: 50 });
  assert.ok(args.includes("libx264"));
  assert.ok(args.includes("-crf"));
  assert.ok(args.includes("23"));
  assert.ok(args.includes("aac"));
  assert.ok(args.includes("128k"));
  assert.ok(args.includes("+faststart"));
  assert.ok(args.includes("pipe:1"));
  assert.ok(args.includes("-nostats"));
  assert.ok(args.includes("-hide_banner"));
  assert.equal(args[args.length - 1], "out.mp4");
});

test("hardware args use the chosen encoder", () => {
  for (const encoder of HARDWARE_ENCODERS) {
    const args = videoCodecArgs(40, encoder);
    assert.equal(args[0], "-c:v");
    assert.equal(args[1], encoder);
  }
  assert.equal(videoCodecArgs(50)[1], "libx264");
});

test("image args keep format or convert to WebP", () => {
  const jpg = buildImageArgs({ input: "in.JPG", output: "out.JPG", slider: 50, ext: "JPG" });
  assert.ok(jpg.includes("-q:v"));
  const webp = buildImageArgs({ input: "in.png", output: "out.webp", slider: 50, ext: "png", convertToWebp: true });
  assert.ok(webp.includes("libwebp"));
  assert.ok(imageQualityArgs(100, "png").includes("png"));
});

test("a size limit turns into a bitrate budget that fits the duration", () => {
  const rates = targetBitrates({ maxBytes: 10 * 1024 * 1024, durationSec: 60 });
  // 10 MiB over 60 s is about 1.4 Mbit/s total, including audio.
  assert.ok(rates.videoKbps > 900 && rates.videoKbps < 1400, JSON.stringify(rates));
  assert.ok(rates.audioKbps >= 24 && rates.audioKbps <= 128);
  const tighter = targetBitrates({ maxBytes: 1024 * 1024, durationSec: 60 });
  assert.ok(tighter.videoKbps < rates.videoKbps);
  assert.ok(targetBitrates({ maxBytes: 0, durationSec: 0 }).videoKbps >= 30);
});

test("bitrate args are produced for every encoder", () => {
  for (const encoder of HARDWARE_ENCODERS.concat([null])) {
    const args = videoBitrateCodecArgs(800, encoder);
    assert.equal(args[0], "-c:v");
    assert.ok(args.includes("-b:v"));
    assert.ok(args.includes("800k"));
    assert.ok(args.includes(encoder || "libx264"));
  }
  const limited = buildVideoArgs({ input: "in.mp4", output: "out.mp4", slider: 50, bitrateKbps: 800, audioKbps: 64 });
  assert.ok(limited.includes("800k"));
  assert.ok(limited.includes("64k"));
  assert.ok(!limited.includes("-crf"));
});

test("aspect options produce a filter", () => {
  assert.equal(aspectFilter("original", null, 1920), "");
  assert.match(aspectFilter("square", null, 1920), /512:512/);
  assert.match(aspectFilter("widescreen", null, 1920), /1280:720/);
  assert.match(aspectFilter("vertical", null, 1920), /720:1280/);
  assert.match(aspectFilter("original", 1000, 1920), /scale=1000:-2/);
});

test("progress parsing yields percent and time remaining", () => {
  const parsed = parseProgress("out_time_us=30000000\nspeed=2.0x", 60);
  assert.equal(parsed.elapsedSec, 30);
  assert.ok(Math.abs(parsed.percent - 50) < 0.01);
  assert.ok(Math.abs(parsed.etaSec - 15) < 0.01);
  assert.equal(parseProgress("", 60).percent, 0);
});

test("quality claims require measured SSIM of at least 0.98", () => {
  assert.equal(parseSsim("SSIM Y:0.99 All:0.9842"), 0.9842);
  assert.equal(parseSsim("no numbers here"), null);
  assert.equal(qualityLabel(0.99), "Looks the same");
  assert.equal(qualityLabel(0.98), "Looks the same");
  assert.equal(qualityLabel(0.93), "Smaller, some detail lost.");
  assert.equal(qualityLabel(null), "Smaller. Not checked.");
});

test("hardware test encodes one frame", () => {
  for (const encoder of HARDWARE_ENCODERS) {
    const args = hardwareTestArgs(encoder);
    assert.ok(args.includes(encoder));
    assert.ok(args.includes("1"));
  }
});
