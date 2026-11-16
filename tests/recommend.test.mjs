import test from "node:test";
import assert from "node:assert/strict";
import {
  kindOf, extensionOf, sliderToCrf, sliderLabel,
  estimateOutputBytes, recommend, NOT_SUPPORTED_TEXT,
} from "../app/lib/recommend.mjs";

const video = (over = {}) => ({
  kind: "video", size: 200 * 1024 * 1024, durationSec: 200,
  width: 1920, height: 1080, fps: 30, bitrateKbps: 8000, ...over,
});

test("detects video and image extensions, rejects PDFs", () => {
  assert.equal(kindOf("My Video 🎬.MP4"), "video");
  assert.equal(kindOf("scan.TIF"), "image");
  assert.equal(kindOf("photo.HEIC"), "unsupported");
  assert.equal(kindOf("report.pdf"), "unsupported");
  assert.equal(extensionOf("a.b.JPEG"), "jpeg");
  assert.equal(kindOf("no-extension"), "unsupported");
});

test("slider maps to CRF 28 / 23 / 18", () => {
  assert.equal(sliderToCrf(0), 28);
  assert.equal(sliderToCrf(50), 23);
  assert.equal(sliderToCrf(100), 18);
  assert.equal(sliderLabel(10), "Smaller file");
  assert.equal(sliderLabel(50), "A bit of both");
  assert.equal(sliderLabel(90), "Better quality");
});

test("higher quality slider always estimates a larger file", () => {
  for (const a of [video(), { kind: "image", size: 4_000_000, imageExt: "jpg" }]) {
    let previous = 0;
    for (const slider of [0, 25, 50, 75, 100]) {
      const bytes = estimateOutputBytes(a, slider);
      assert.ok(bytes > 0, "estimate must be positive");
      assert.ok(bytes >= previous, `estimate must not shrink as quality rises (${slider})`);
      assert.ok(bytes <= a.size, "estimate must not exceed original size");
      previous = bytes;
    }
  }
});

test("high bitrate video suggests a smaller setting", () => {
  // 18 Mbps for 200 s is about 450 MB, so keep the fixture consistent.
  const result = recommend(video({ bitrateKbps: 18000, size: 450 * 1024 * 1024 }));
  assert.ok(result.slider <= 30, `slider was ${result.slider}`);
  assert.match(result.reason, /about \d+% smaller/);
  assert.match(result.reason, /Expected to look the same/);
});

test("low bitrate video suggests keeping quality and says so", () => {
  const result = recommend(video({ bitrateKbps: 800, size: 20 * 1024 * 1024 }));
  assert.ok(result.slider >= 75, `slider was ${result.slider}`);
  assert.match(result.reason, /Already small\. Keeping more quality makes sense\./);
});

test("4K video pushes the suggestion toward smaller", () => {
  const hd = recommend(video({ bitrateKbps: 10000 }));
  // Four times the pixels need roughly four times the bitrate.
  const uhd = recommend(video({ bitrateKbps: 40000, width: 3840, height: 2160, size: 800 * 1024 * 1024 }));
  assert.ok(uhd.slider < hd.slider, "4K should suggest a smaller setting");
});

test("unsupported files are labelled plainly", () => {
  const result = recommend({ kind: "unsupported", size: 1024 });
  assert.equal(result.reason, NOT_SUPPORTED_TEXT);
});

test("recommendation is pure and deterministic", () => {
  const input = video();
  assert.deepEqual(recommend(input), recommend(input));
  assert.equal(input.bitrateKbps, 8000, "input must not be mutated");
});
