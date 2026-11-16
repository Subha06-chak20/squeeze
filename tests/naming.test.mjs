import test from "node:test";
import assert from "node:assert/strict";
import { outputName, uniquePath, targetExtension } from "../app/lib/naming.mjs";

test("output name adds ' (smaller)' and keeps the extension", () => {
  assert.equal(outputName("holiday.mp4"), "holiday (smaller).mp4");
  assert.equal(outputName("photo.HEIC"), "photo (smaller).HEIC");
  assert.equal(outputName("noext"), "noext (smaller)");
});

test("WebP conversion changes the extension", () => {
  assert.equal(outputName("photo.png", { convertToWebp: true }), "photo (smaller).webp");
});

test("an explicit output extension wins", () => {
  assert.equal(outputName("holiday.mkv", { extension: "mp4" }), "holiday (smaller).mp4");
  assert.equal(outputName("scan.tiff", { extension: "png" }), "scan (smaller).png");
});

test("target extensions match what ffmpeg actually writes", () => {
  assert.equal(targetExtension("video", "mkv"), "mp4");
  assert.equal(targetExtension("video", "webm"), "mp4");
  assert.equal(targetExtension("image", "jpg"), "jpg");
  assert.equal(targetExtension("image", "png", true), "webp");
  assert.equal(targetExtension("image", "bmp"), "png");
  assert.equal(targetExtension("image", "tiff"), "png");
  assert.equal(targetExtension("image", "tif"), "png");
  assert.equal(targetExtension("image", "gif"), "gif");
});

test("uniquePath never overwrites", () => {
  const taken = new Set(["/out/photo (smaller).jpg", "/out/photo (smaller) (2).jpg"]);
  const exists = (p) => taken.has(p);
  assert.equal(uniquePath("/out", "photo (smaller).jpg", exists), "/out/photo (smaller) (3).jpg");
  assert.equal(uniquePath("/out", "new (smaller).jpg", exists), "/out/new (smaller).jpg");
});
