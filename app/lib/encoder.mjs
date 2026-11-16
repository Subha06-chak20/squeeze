/** Pure ffmpeg argument builders and output parsers. No I/O. */

import { sliderToCrf } from "./recommend.mjs";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const HARDWARE_ENCODERS = ["h264_nvenc", "h264_amf", "h264_qsv", "h264_mf"];

export const PROGRESS_ARGS = ["-progress", "pipe:1", "-nostats", "-hide_banner"];

export function aspectFilter(aspect, maxWidth, width) {
  const filters = [];
  if (maxWidth && width && maxWidth < width) {
    filters.push(`scale=${maxWidth}:-2`);
  }
  switch (aspect) {
    case "square":
      filters.push("scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:black");
      break;
    case "widescreen":
      filters.push("scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:black");
      break;
    case "vertical":
      filters.push("scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black");
      break;
    default:
      break;
  }
  return filters.join(",");
}

/** Encoder arguments for CPU or a detected hardware encoder. */
export function videoCodecArgs(slider, hardwareEncoder = null) {
  const crf = sliderToCrf(slider);
  switch (hardwareEncoder) {
    case "h264_nvenc":
      return ["-c:v", "h264_nvenc", "-preset", "p4", "-cq", String(crf), "-pix_fmt", "yuv420p"];
    case "h264_amf":
      return ["-c:v", "h264_amf", "-quality", "balanced", "-rc", "cqp", "-cqp", String(crf), "-pix_fmt", "yuv420p"];
    case "h264_qsv":
      return ["-c:v", "h264_qsv", "-preset", "medium", "-global_quality", String(crf), "-pix_fmt", "yuv420p"];
    case "h264_mf":
      return ["-c:v", "h264_mf", "-b:v", `${Math.round(600 + slider * 18)}k`, "-pix_fmt", "yuv420p"];
    default:
      return ["-c:v", "libx264", "-preset", "veryfast", "-crf", String(crf), "-pix_fmt", "yuv420p"];
  }
}

/**
 * Bitrates that keep an MP4 close to (but under) a byte budget. The small
 * safety margin leaves room for the MP4 container and encoder variance.
 */
export function targetBitrates({ maxBytes, durationSec, audioKbps = 128 }) {
  const seconds = Math.max(0.2, Number(durationSec) || 0);
  const budget = (Math.max(0, Number(maxBytes) || 0) * 8) / seconds;
  const audio = clamp(Math.round(Math.min(budget * 0.08, Number(audioKbps) * 1000)), 24000, 128000);
  const video = Math.max(30000, Math.floor(budget * 0.92 - audio));
  return {
    videoKbps: Math.max(30, Math.round(video / 1000)),
    audioKbps: Math.round(audio / 1000),
  };
}

/** Constant-bitrate codec options, used when the user sets a size limit. */
export function videoBitrateCodecArgs(bitrateKbps, hardwareEncoder = null) {
  const k = Math.max(30, Math.round(Number(bitrateKbps) || 30));
  const max = Math.round(k * 1.15);
  const buffer = Math.round(k * 2);
  switch (hardwareEncoder) {
    case "h264_nvenc":
      return ["-c:v", "h264_nvenc", "-preset", "p4", "-rc", "vbr", "-b:v", `${k}k`, "-maxrate", `${max}k`, "-bufsize", `${buffer}k`, "-pix_fmt", "yuv420p"];
    case "h264_amf":
      return ["-c:v", "h264_amf", "-quality", "balanced", "-rc", "vbr", "-b:v", `${k}k`, "-maxrate", `${max}k`, "-bufsize", `${buffer}k`, "-pix_fmt", "yuv420p"];
    case "h264_qsv":
      return ["-c:v", "h264_qsv", "-preset", "medium", "-b:v", `${k}k`, "-maxrate", `${max}k`, "-bufsize", `${buffer}k`, "-pix_fmt", "yuv420p"];
    case "h264_mf":
      return ["-c:v", "h264_mf", "-b:v", `${k}k`, "-pix_fmt", "yuv420p"];
    default:
      return ["-c:v", "libx264", "-preset", "veryfast", "-b:v", `${k}k`, "-maxrate", `${max}k`, "-bufsize", `${buffer}k`, "-pix_fmt", "yuv420p"];
  }
}

/** Quality arguments for images (slider 0 = smaller, 100 = better). */
export function imageQualityArgs(slider, ext, convertToWebp = false) {
  const s = clamp(slider, 0, 100);
  const format = convertToWebp ? "webp" : String(ext || "jpg").toLowerCase();
  if (format === "webp") {
    return ["-c:v", "libwebp", "-quality", String(Math.round(25 + s * 0.72)), "-compression_level", "6"];
  }
  if (format === "png") {
    // PNG is lossless, so the slider deliberately does not change quality here.
    // Always use maximum compression so the copy is never bigger than the original.
    return ["-c:v", "png", "-compression_level", "9", "-pred", "mixed"];
  }
  if (format === "gif") {
    return ["-c:v", "gif"];
  }
  // jpeg / jpg: q:v 31 (small) down to 2 (best)
  return ["-c:v", "mjpeg", "-q:v", String(clamp(Math.round(31 - s * 0.29), 2, 31))];
}

export function buildVideoArgs({ input, output, slider, hardwareEncoder = null, aspect = "original", maxWidth = null, width = null, bitrateKbps = 0, audioKbps = 128 }) {
  const args = ["-y", ...PROGRESS_ARGS, "-i", input, "-map", "0:v:0", "-map", "0:a?", "-sn", "-dn"];
  const filter = aspectFilter(aspect, maxWidth, width);
  if (filter) args.push("-vf", filter);
  args.push(...(bitrateKbps > 0
    ? videoBitrateCodecArgs(bitrateKbps, hardwareEncoder)
    : videoCodecArgs(slider, hardwareEncoder)));
  args.push(
    "-c:a", "aac", "-b:a", `${Math.max(24, Math.round(Number(audioKbps) || 128))}k`,
    "-map_metadata", "0",
    "-movflags", "+faststart",
    output,
  );
  return args;
}

export function buildImageArgs({ input, output, slider, ext, convertToWebp = false, aspect = "original", maxWidth = null, width = null }) {
  const args = ["-y", ...PROGRESS_ARGS, "-i", input];
  const filter = aspectFilter(aspect, maxWidth, width);
  if (filter) args.push("-vf", filter, "-frames:v", "1");
  args.push(...imageQualityArgs(slider, ext, convertToWebp), "-map_metadata", "0", output);
  return args;
}

/** Parse one `-progress` chunk. Returns { elapsedSec, percent, speed, etaSec }. */
export function parseProgress(chunk, durationSec) {
  let elapsedSec = 0;
  let speed = 0;
  const us = /out_time_us=(\d+)/.exec(chunk);
  const ms = /out_time_ms=(\d+)/.exec(chunk); // some builds report microseconds here
  const clock = /out_time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(chunk);
  const sp = /speed=([\d.]+)x/.exec(chunk);
  if (us) elapsedSec = Number(us[1]) / 1_000_000;
  else if (clock) elapsedSec = Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  else if (ms) elapsedSec = Number(ms[1]) / 1_000_000;
  if (sp) speed = Number(sp[1]);
  const percent = durationSec > 0 ? clamp((elapsedSec / durationSec) * 100, 0, 100) : 0;
  const etaSec = speed > 0 && durationSec > 0
    ? Math.max(0, (durationSec - elapsedSec) / speed)
    : 0;
  return { elapsedSec, percent, speed, etaSec };
}

/** Last "SSIM ... All:0.98" value, or null when not available. */
export function parseSsim(output) {
  const matches = [...String(output).matchAll(/All:([0-9.]+)/g)];
  if (!matches.length) return null;
  const value = Number(matches[matches.length - 1][1]);
  return Number.isFinite(value) ? value : null;
}

export function qualityLabel(ssim) {
  if (ssim == null) return "Smaller. Not checked.";
  if (ssim >= 0.98) return "Looks the same";
  return "Smaller, some detail lost.";
}

/** One-frame hardware test encode. */
export function hardwareTestArgs(encoder) {
  return [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=black:s=64x64:d=0.04",
    "-c:v", encoder, "-frames:v", "1", "-f", "null", "-",
  ];
}
