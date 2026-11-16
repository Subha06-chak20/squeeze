/**
 * Pure recommendation logic. No filesystem, no timers, no side effects.
 * Every number here is an estimate shown to the user with the word "about".
 */

export const VIDEO_EXTENSIONS = [
  "mp4", "mov", "mkv", "avi", "webm", "m4v", "wmv", "flv",
];
export const IMAGE_EXTENSIONS = [
  "jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff", "tif",
];
export const NOT_SUPPORTED_TEXT = "Not supported in this version.";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function extensionOf(nameOrPath) {
  const clean = String(nameOrPath).split(/[\\/]/).pop() ?? "";
  const dot = clean.lastIndexOf(".");
  return dot > 0 ? clean.slice(dot + 1).toLowerCase() : "";
}

export function kindOf(nameOrPath) {
  const ext = extensionOf(nameOrPath);
  if (VIDEO_EXTENSIONS.includes(ext)) return "video";
  if (IMAGE_EXTENSIONS.includes(ext)) return "image";
  return "unsupported";
}

/** Slider 0 = smaller file, 100 = better quality. CRF 28 -> 18, middle 23. */
export function sliderToCrf(slider) {
  return Math.round(28 - (clamp(slider, 0, 100) / 100) * 10);
}

/** Plain-language name for the current slider position. */
export function sliderLabel(slider) {
  if (slider < 35) return "Smaller file";
  if (slider > 65) return "Better quality";
  return "A bit of both";
}

/**
 * Rough output size in bytes. Videos use bitrate x duration; images use a
 * simple format table. Always clamped so we never promise growth.
 */
export function estimateOutputBytes(analysis, slider) {
  const size = Math.max(1, analysis.size || 0);
  const s = clamp(slider, 0, 100) / 100;
  let factor;
  if (analysis.kind === "video") {
    factor = 0.35 + s * 0.55;
    const bitrate =
      (analysis.bitrateKbps || analysis.videoBitrateKbps || 0) * 1000;
    const duration = analysis.durationSec || 0;
    if (bitrate > 0 && duration > 0) {
      const derived = (bitrate * duration) / 8;
      return Math.round(clamp(derived * factor, size * 0.05, size));
    }
    return Math.round(size * clamp(factor, 0.35, 0.95));
  }
  const tables = {
    jpg: [0.45, 0.9], jpeg: [0.45, 0.9], webp: [0.4, 0.85],
    png: [0.6, 0.95], gif: [0.7, 0.98], bmp: [0.25, 0.8],
    tiff: [0.3, 0.85], tif: [0.3, 0.85],
  };
  const [low, high] = tables[analysis.imageExt || "jpg"] ?? [0.45, 0.9];
  factor = low + s * (high - low);
  return Math.round(clamp(size * factor, size * 0.05, size));
}

function savingsText(original, estimate) {
  if (!original) return "About the same size.";
  const pct = Math.round((1 - estimate / original) * 100);
  if (pct < 5) return "Already as small as it can get.";
  return `Will get about ${pct}% smaller. Expected to look the same.`;
}

/**
 * Return { slider, estimatedBytes, reason } for one analysed file.
 * Pure: the same input always produces the same output.
 */
export function recommend(analysis) {
  const size = Math.max(1, analysis.size || 0);
  if (analysis.kind === "unsupported") {
    return {
      slider: 50,
      estimatedBytes: size,
      reason: NOT_SUPPORTED_TEXT,
    };
  }

  let slider;
  if (analysis.kind === "video") {
    const width = analysis.width || 1920;
    const height = analysis.height || 1080;
    const fps = analysis.fps || 30;
    const bitrate = (analysis.bitrateKbps || analysis.videoBitrateKbps || 0) * 1000;
    const pixelsPerSecond = Math.max(1, width * height * fps);
    const bpp = bitrate / pixelsPerSecond; // bits per pixel per frame

    if (bpp === 0) {
      slider = 50;
    } else if (bpp < 0.07) {
      slider = 80;
    } else if (bpp > 0.14) {
      slider = 25;
    } else {
      // 0.07 -> 78 (keep quality), 0.14 -> 25 (make smaller)
      slider = Math.round(78 - ((bpp - 0.07) / 0.07) * 53);
    }
    if (width >= 3840) slider = clamp(slider - 12, 10, 100); // 4K push
    slider = clamp(slider, 10, 90);
  } else {
    slider = size > 8 * 1024 * 1024 ? 42 : 55;
  }

  const estimatedBytes = estimateOutputBytes(analysis, slider);
  let reason = savingsText(size, estimatedBytes);
  if (analysis.kind === "video" && slider >= 75 && reason.includes("about")) {
    reason = "Already small. Keeping more quality makes sense.";
  }

  return {
    slider,
    estimatedBytes,
    reason,
  };
}
