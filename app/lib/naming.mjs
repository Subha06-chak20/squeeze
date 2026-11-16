/** Pure naming helpers. `exists` is injected so this module does no I/O. */

const LOSSLESS_TO_PNG = new Set(["bmp", "tiff", "tif"]);

/**
 * The extension of the file we will actually write.
 * Videos always become MP4 (H.264/AAC); BMP and TIFF become lossless PNG,
 * which is much smaller and opens everywhere. Everything else keeps its format.
 */
export function targetExtension(kind, imageExt = "", convertToWebp = false) {
  if (kind === "video") return "mp4";
  const ext = String(imageExt || "").toLowerCase();
  if (convertToWebp) return "webp";
  if (LOSSLESS_TO_PNG.has(ext)) return "png";
  return ext || "jpg";
}

/** Original name + " (smaller)", keeping the extension exactly as written. */
export function outputName(originalName, options = {}) {
  const { suffix = " (smaller)", convertToWebp = false, extension = "" } = options;
  const dot = originalName.lastIndexOf(".");
  const stem = dot > 0 ? originalName.slice(0, dot) : originalName;
  const originalExt = dot > 0 ? originalName.slice(dot + 1) : "";
  const wanted = String(extension || "").replace(/^\./, "");
  const finalExt = wanted || (convertToWebp ? "webp" : originalExt);
  return finalExt ? `${stem}${suffix}.${finalExt}` : `${stem}${suffix}`;
}

/**
 * Never overwrite: try name, then "name (2)", "name (3)"...
 * `exists(candidatePath)` is a synchronous predicate supplied by the caller.
 */
export function uniquePath(directory, name, exists) {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let candidate = `${directory}/${name}`;
  let counter = 2;
  while (exists(candidate)) {
    candidate = `${directory}/${stem} (${counter})${ext}`;
    counter += 1;
  }
  return candidate;
}

export function joinPath(...parts) {
  return parts.join("/").replace(/\/+/g, "/");
}
