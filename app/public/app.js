"use strict";

const token = new URLSearchParams(location.search).get("t") || "";
const $ = (id) => document.getElementById(id);

const state = {
  items: [],
  estimates: new Map(),
  settings: {},
  status: {},
  pollTimer: null,
  estimateTimer: null,
  noticeTimer: null,
  outputDir: "",
  defaultSaveDir: "",
  savedTo: "",
  savedDirs: new Set(),
  savedPaths: new Set(),
  doneEntries: [],
  busy: false,
  sliderTouched: false,
  pollErrors: 0,
};

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return "0 B";
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unit]}`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatEta(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total < 60) return `${Math.max(1, total)} sec`;
  return `${Math.ceil(total / 60)} min`;
}

function extensionOf(name) {
  const clean = String(name || "").split(/[\\/]/).pop() || "";
  const dot = clean.lastIndexOf(".");
  return dot > 0 ? clean.slice(dot + 1).toUpperCase() : "FILE";
}

function parentName(filePath) {
  const parts = String(filePath || "").split(/[\\/]/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : "";
}

function samePath(a, b) {
  return String(a || "").toLowerCase() === String(b || "").toLowerCase();
}

async function api(route, body = {}) {
  const response = await fetch(`/api/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-squeezeit-token": token },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

/* ------------------------------------------------------------------ */
/* Screens, notices and theme                                          */
/* ------------------------------------------------------------------ */

const SCREENS = ["welcome", "home", "ready", "working", "finished"];

function show(screen) {
  for (const name of SCREENS) {
    const element = $(name);
    if (element) element.hidden = name !== screen;
  }
  try {
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch {
    window.scrollTo(0, 0);
  }
}

function showNotice(text, kind = "info") {
  const box = $("notice");
  if (!text) {
    box.hidden = true;
    return;
  }
  $("notice-text").textContent = text;
  box.classList.toggle("error", kind === "error");
  box.hidden = false;
  clearTimeout(state.noticeTimer);
  state.noticeTimer = setTimeout(() => { box.hidden = true; }, kind === "error" ? 12000 : 7000);
}

function hideNotice() {
  clearTimeout(state.noticeTimer);
  $("notice").hidden = true;
}

function applyTheme(theme) {
  const wanted = ["auto", "light", "dark"].includes(theme) ? theme : "auto";
  state.settings.theme = wanted;
  const root = document.documentElement;
  if (wanted === "auto") delete root.dataset.theme;
  else root.dataset.theme = wanted;
  const label = wanted === "auto" ? "automatic" : wanted;
  $("theme-toggle").setAttribute("aria-label", `Change theme. Currently ${label}.`);
  $("theme-toggle").setAttribute("title", `Theme: ${label}`);
  $("theme-label").textContent = `Theme: ${label}`;
}

async function cycleTheme() {
  const order = { auto: "light", light: "dark", dark: "auto" };
  const next = order[state.settings.theme || "auto"] || "light";
  applyTheme(next);
  try {
    await api("settings", { theme: next });
  } catch {
    showNotice("The theme changed, but we could not remember it.", "error");
  }
}

/* ------------------------------------------------------------------ */
/* Options                                                             */
/* ------------------------------------------------------------------ */

const SIZE_FACTORS = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };

function readMaxBytes() {
  const amount = Number($("opt-max-size").value);
  const factor = SIZE_FACTORS[$("opt-max-unit").value] || SIZE_FACTORS.MB;
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.max(1024, Math.round(amount * factor));
}

function maxSizeText(bytes) {
  const unit = $("opt-max-unit").value;
  const amount = (Number(bytes) || 0) / (SIZE_FACTORS[unit] || SIZE_FACTORS.MB);
  return `${Math.round(amount * 100) / 100} ${unit}`;
}

function populateOptions() {
  const settings = state.settings;
  $("opt-output").value = settings.outputDir || "";
  $("opt-aspect").value = settings.aspect || "original";
  $("opt-width").value = settings.maxWidth || "";
  $("opt-jobs").value = String(settings.parallelJobs || 1);
  $("opt-webp").checked = Boolean(settings.convertToWebp);
  $("opt-max-unit").value = ["KB", "MB", "GB"].includes(settings.maxSizeUnit) ? settings.maxSizeUnit : "MB";
  const maxBytes = Number(settings.maxBytes) || 0;
  $("opt-max-size").value = maxBytes
    ? String(Math.round((maxBytes / SIZE_FACTORS[$("opt-max-unit").value]) * 100) / 100)
    : "";
}

function readOptions() {
  return {
    outputDir: $("opt-output").value.trim() || null,
    aspect: $("opt-aspect").value,
    maxWidth: $("opt-width").value ? Number($("opt-width").value) : null,
    parallelJobs: Number($("opt-jobs").value),
    convertToWebp: $("opt-webp").checked,
    maxBytes: readMaxBytes() || null,
    maxSizeUnit: $("opt-max-unit").value,
  };
}

async function saveOptions(notify = false) {
  const result = await api("settings", readOptions());
  state.settings = { ...state.settings, ...(result.settings || {}) };
  if (notify) showNotice("Options saved.");
}

/* ------------------------------------------------------------------ */
/* File list and estimates                                             */
/* ------------------------------------------------------------------ */

function estimateFor(item) {
  const key = String(item.path || "").toLowerCase();
  const saved = state.estimates.get(key);
  let bytes = Number.isFinite(saved) ? saved
    : (Number.isFinite(item.estimatedBytes) ? item.estimatedBytes : Number(item.size) || 0);
  const cap = Number(state.settings.maxBytes) || 0;
  if (cap > 0) bytes = Math.min(bytes, cap);
  return bytes;
}

function supportedItems() {
  return state.items.filter((item) => item.supported);
}

function suggestedSlider(items) {
  const values = items
    .filter((item) => item.supported && Number.isFinite(Number(item.slider)))
    .map((item) => Number(item.slider))
    .sort((a, b) => a - b);
  if (!values.length) return 50;
  return Math.round(values[Math.floor(values.length / 2)]);
}

function kindClass(item) {
  if (item.kind === "video") return "video";
  if (item.kind === "image") return "image";
  return "other";
}

function fileMeta(item) {
  const parts = [];
  if (item.width && item.height) parts.push(`${item.width}×${item.height}`);
  if (item.kind === "video" && item.durationSec) parts.push(formatDuration(item.durationSec));
  if (item.kind === "video" && Number(item.fps) > 0) parts.push(`${Math.round(Number(item.fps))} fps`);
  const folder = parentName(item.path);
  if (folder) parts.push(folder);
  if (item.error && item.supported) parts.push(item.error);
  return parts.join(" · ");
}

function renderList() {
  const list = $("file-list");
  list.textContent = "";

  if (!state.items.length) {
    $("empty-list").hidden = false;
    return;
  }
  $("empty-list").hidden = true;

  for (const item of state.items) {
    const row = document.createElement("li");
    row.className = `file-row${item.supported ? "" : " unsupported"}`;

    const badge = document.createElement("span");
    badge.className = `file-kind ${kindClass(item)}`;
    badge.textContent = extensionOf(item.name);
    badge.setAttribute("aria-hidden", "true");

    const main = document.createElement("div");
    main.className = "file-main";

    const name = document.createElement("div");
    name.className = "file-name";
    name.textContent = item.name;
    name.title = item.path || item.name;

    const meta = document.createElement("div");
    meta.className = "file-meta";
    const metaText = document.createElement("span");
    metaText.textContent = fileMeta(item);
    meta.append(metaText);

    const suggested = Math.round(Number(item.slider));
    if (item.supported && Number.isFinite(suggested) && suggested !== Number($("quality").value)) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "suggestion";
      chip.textContent = `Suggested ${suggested}%`;
      chip.title = "Use the quality level SqueezeIt recommends for this file";
      chip.addEventListener("click", () => {
        state.sliderTouched = true;
        $("quality").value = String(suggested);
        updateQualityUI();
        void refreshEstimates();
      });
      meta.append(chip);
    }

    main.append(name, meta);

    const side = document.createElement("div");
    side.className = "file-side";
    if (item.supported) {
      const size = Number(item.size) || 0;
      const estimate = Math.min(size || estimateFor(item), estimateFor(item));
      const sizes = document.createElement("div");
      sizes.className = "file-sizes";
      const before = document.createElement("span");
      before.className = "size-before";
      before.textContent = formatBytes(size);
      const arrow = document.createElement("span");
      arrow.className = "size-arrow";
      arrow.textContent = "→";
      arrow.setAttribute("aria-hidden", "true");
      const after = document.createElement("span");
      after.className = "size-after";
      after.textContent = `about ${formatBytes(estimate)}`;
      sizes.append(before, arrow, after);

      const savedPct = size > 0 ? Math.max(0, Math.round((1 - estimate / size) * 100)) : 0;
      const pill = document.createElement("span");
      pill.className = `saving-pill${savedPct > 0 ? "" : " neutral"}`;
      pill.textContent = savedPct > 0 ? `${savedPct}% smaller` : "Already small";
      side.append(sizes, pill);
    } else {
      const note = document.createElement("span");
      note.className = "not-supported";
      note.textContent = item.supportedText || "Not supported in this version.";
      side.append(note);
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${item.name}`);
    remove.title = "Remove from the list";
    remove.addEventListener("click", () => {
      state.items = state.items.filter((entry) => !samePath(entry.path, item.path));
      state.estimates.delete(String(item.path || "").toLowerCase());
      render();
      if (!state.items.length) show("home");
    });

    row.append(badge, main, side, remove);
    list.append(row);
  }
}

function renderSummary() {
  const supported = supportedItems();
  const skipped = state.items.length - supported.length;
  const totalSize = supported.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
  const estimate = supported.reduce((sum, item) => sum + Math.min(Number(item.size) || estimateFor(item), estimateFor(item)), 0);
  const savedPct = totalSize > 0 ? Math.max(0, Math.round((1 - estimate / totalSize) * 100)) : 0;

  $("total-files").textContent = String(supported.length);
  $("total-before").textContent = formatBytes(totalSize);
  $("total-after").textContent = formatBytes(estimate);
  $("savings-badge").textContent = `${savedPct}%`;

  const pieces = [`${supported.length} ${supported.length === 1 ? "file" : "files"} ready`];
  if (skipped) pieces.push(`${skipped} skipped`);
  $("ready-sub").textContent = pieces.join(" · ");

  const start = $("start");
  start.disabled = state.busy || supported.length === 0;
  start.title = supported.length ? "" : "Add a video or a picture first";
}

function render() {
  renderList();
  renderSummary();
}

function updateQualityUI() {
  const slider = $("quality");
  const value = Number(slider.value);
  slider.style.setProperty("--range-progress", `${value}%`);
  $("quality-value").textContent = value < 35 ? "Smallest" : value > 65 ? "Best looking" : "Balanced";
  const limit = readMaxBytes();
  if (limit) {
    $("quality-help").textContent = `A ${maxSizeText(limit)} limit is set — each file will be made to fit it. The slider is ignored while a limit is active.`;
    return;
  }
  $("quality-help").textContent = value < 35
    ? "Smaller files. We will check how they look before calling it done."
    : value > 65
      ? "Better quality. The files will not shrink as much, but details stay sharp."
      : "A bit of both. We will check how the new files look.";
}

async function refreshEstimates() {
  const supported = supportedItems();
  if (!supported.length) {
    state.estimates.clear();
    renderSummary();
    return;
  }
  try {
    const { estimates } = await api("estimate", {
      items: supported,
      slider: Number($("quality").value),
    });
    const next = new Map();
    for (const entry of estimates || []) {
      if (entry && entry.path) next.set(String(entry.path).toLowerCase(), Number(entry.bytes) || 0);
    }
    state.estimates = next;
    renderList();
    renderSummary();
  } catch {
    // Keep the previous estimates; the next change will try again.
  }
}

function scheduleEstimates() {
  clearTimeout(state.estimateTimer);
  state.estimateTimer = setTimeout(() => { void refreshEstimates(); }, 140);
}

/* ------------------------------------------------------------------ */
/* Adding files                                                        */
/* ------------------------------------------------------------------ */

function setHomeBusy(busy) {
  $("choose-files").disabled = busy;
  $("choose-folder").disabled = busy;
}

function showScan(text) {
  const line = $("home-status");
  line.hidden = !text;
  if (text) $("home-status-text").textContent = text;
}

async function addPaths(paths, note = "") {
  const incoming = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === "string" && p.trim());
  const seen = new Set(state.items.map((item) => String(item.path || "").toLowerCase()));
  const fresh = [];
  for (const path of incoming) {
    const key = path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(path);
  }

  if (!fresh.length) {
    if (note) showNotice(note);
    else if (incoming.length) showNotice("Those files are already in the list.");
    return;
  }

  const wasEmpty = state.items.length === 0;
  const BATCH = 6;
  try {
    for (let index = 0; index < fresh.length; index += BATCH) {
      const chunk = fresh.slice(index, index + BATCH);
      showScan(`Checking ${Math.min(index + chunk.length, fresh.length)} of ${fresh.length} files…`);
      const { items } = await api("analyze", { paths: chunk });
      for (const item of items || []) {
        if (!item || !item.path) continue;
        if (state.items.some((entry) => samePath(entry.path, item.path))) continue;
        state.items.push(item);
      }
    }

    if (wasEmpty && !state.sliderTouched) {
      $("quality").value = String(suggestedSlider(state.items));
      updateQualityUI();
    }

    await refreshEstimates();
    render();

    if (!state.items.length) {
      show("home");
      showNotice("No files were added. Try choosing a video or a picture.", "error");
    } else {
      show("ready");
      if (note) showNotice(note);
    }
  } catch (error) {
    showNotice(error.message, "error");
    if (state.items.length) {
      render();
      show("ready");
    }
  } finally {
    showScan("");
  }
}

async function withBusy(work) {
  if (state.busy) return;
  state.busy = true;
  setHomeBusy(true);
  renderSummary();
  try {
    await work();
  } finally {
    state.busy = false;
    setHomeBusy(false);
    renderSummary();
  }
}

const DIALOG_HINT = "Look for the Windows file window — it can open behind this browser.";

function hideDialogHint() {
  if ($("notice-text").textContent === DIALOG_HINT) hideNotice();
}

/** Shows a gentle hint if the native Windows dialog takes a moment to appear. */
async function withDialogHint(task) {
  const hint = setTimeout(() => showNotice(DIALOG_HINT), 1500);
  try {
    return await task();
  } finally {
    clearTimeout(hint);
    hideDialogHint();
  }
}

async function chooseFiles() {
  await withDialogHint(() => withBusy(async () => {
    const result = await api("dialog/files");
    if (result.error) {
      showNotice(result.error, "error");
      return;
    }
    await addPaths(result.paths || []);
  }));
}

async function chooseFolder() {
  await withDialogHint(() => withBusy(async () => {
    const picked = await api("dialog/folder");
    if (picked.error) {
      showNotice(picked.error, "error");
      return;
    }
    if (!picked.paths || !picked.paths.length) return;
    showScan("Looking inside the folder…");
    const scanned = await api("scan-folder", { path: picked.paths[0] });
    const paths = (scanned.files || []).map((file) => file.path);
    const note = (scanned.notes || []).join(" ");
    if (!paths.length) {
      showNotice("That folder has no videos or pictures in it.", "error");
      return;
    }
    await addPaths(paths, note);
  }));
}

async function saveCopy(paths = []) {
  await withDialogHint(() => withBusy(async () => {
    const result = await api("save-copy", Array.isArray(paths) && paths.length ? { paths } : {});
    if (result.error) {
      showNotice(result.error, "error");
      return;
    }
    if (result.cancelled) return;
    const saved = Array.isArray(result.paths) ? result.paths : [];
    for (const filePath of saved) state.savedPaths.add(filePath);
    for (const dir of (Array.isArray(result.savedDirs) ? result.savedDirs : (result.savedTo ? [result.savedTo] : []))) {
      state.savedDirs.add(dir);
    }
    if (result.savedTo) state.savedTo = result.savedTo;
    renderDoneList(state.doneEntries);
    renderSaveState();
    if (result.count > 1) {
      showNotice(`Saved ${result.count} copies to ${result.savedTo}`);
    } else {
      showNotice(`Saved a copy to ${result.savedTo}`);
    }
  }));
}

/* ------------------------------------------------------------------ */
/* Running a batch                                                     */
/* ------------------------------------------------------------------ */

function resetWorking(total) {
  $("working-count").textContent = `Getting ready for ${total} ${total === 1 ? "file" : "files"}…`;
  $("working-file").textContent = "";
  $("working-time").textContent = "Working…";
  $("working-percent").textContent = "0%";
  $("progress-fill").style.width = "0%";
  $("progressbar").setAttribute("aria-valuenow", "0");
  $("stop").disabled = false;
  $("stop").textContent = "Stop";
}

async function startJob() {
  if (state.busy) return;
  const supported = supportedItems();
  if (!supported.length) {
    showNotice("Add at least one video or picture first.", "error");
    return;
  }

  state.busy = true;
  $("start").disabled = true;
  try {
    await saveOptions();
    await refreshEstimates();
    const slider = Number($("quality").value);
    const items = supported.map((item) => ({
      ...item,
      slider,
      estimatedBytes: estimateFor(item),
    }));
    const estimatedBytes = items.reduce((sum, item) => sum + (Number(item.estimatedBytes) || 0), 0);

    const spaces = await api("check-space", { estimatedBytes, outputDirs: [] });
    const short = (spaces.checked || []).filter((entry) => entry.enough === false);
    if (short.length) {
      const okay = window.confirm("There may not be enough room on your drive for the smaller copies. Continue anyway?");
      if (!okay) return;
    }

    await api("start", { items, settings: state.settings });
    resetWorking(items.length);
    show("working");
    startPolling();
  } catch (error) {
    showNotice(error.message, "error");
    show("ready");
  } finally {
    state.busy = false;
    $("start").disabled = supportedItems().length === 0;
  }
}

function updateWorking(progress) {
  const total = Number(progress.total) || 0;
  const done = Number(progress.done) || 0;
  const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
  $("working-percent").textContent = `${Math.round(percent)}%`;
  $("progress-fill").style.width = `${percent}%`;
  $("progressbar").setAttribute("aria-valuenow", String(Math.round(percent)));

  if (total) $("working-count").textContent = `${done} of ${total} ${total === 1 ? "file" : "files"} finished`;
  const active = progress.activeName ? `Now: ${progress.activeName}` : (progress.phase || "");
  $("working-file").textContent = active;

  if (progress.cancelled) {
    $("working-time").textContent = "Stopping…";
    $("stop").disabled = true;
  } else {
    const eta = Number(progress.etaSec) || 0;
    $("working-time").textContent = eta > 0
      ? `About ${formatEta(eta)} left`
      : percent > 90 ? "Almost done…" : "Working…";
  }
}

function startPolling() {
  clearInterval(state.pollTimer);
  state.pollErrors = 0;

  const tick = async () => {
    try {
      const progress = await api("progress");
      state.pollErrors = 0;
      if (!progress.running) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        await showResult();
        return;
      }
      updateWorking(progress);
    } catch {
      state.pollErrors += 1;
      if (state.pollErrors > 8) {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        showNotice("We lost contact with the local engine. Your originals are safe.", "error");
        show("ready");
      }
    }
  };

  state.pollTimer = setInterval(() => { void tick(); }, 500);
  void tick();
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

function renderDoneList(entries) {
  const list = $("done-list");
  list.textContent = "";
  const items = Array.isArray(entries) ? entries : [];
  $("done-details").hidden = items.length === 0;
  $("done-details-count").textContent = items.length ? `(${items.length} ${items.length === 1 ? "file" : "files"})` : "";

  for (const entry of items) {
    const row = document.createElement("li");
    row.className = "result-row";

    const name = document.createElement("div");
    name.className = "result-name";
    const strong = document.createElement("strong");
    strong.textContent = entry.name;
    const note = document.createElement("small");
    note.textContent = entry.label || "";
    name.append(strong, note);

    const right = document.createElement("div");
    right.className = "result-right";

    const saving = document.createElement("div");
    saving.className = "result-saving";
    const sizes = document.createElement("span");
    sizes.textContent = `${formatBytes(entry.before)} → ${formatBytes(entry.after)}`;
    const pill = document.createElement("span");
    pill.className = "saving-pill";
    pill.textContent = `−${entry.percentSaved || 0}%`;
    saving.append(sizes, pill);

    const alreadySaved = state.savedPaths.has(entry.path);
    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn small row-save";
    save.textContent = alreadySaved ? "Saved" : "Save";
    save.disabled = alreadySaved;
    save.title = alreadySaved
      ? "Saved — click Save all to make another copy"
      : "Save this copy where you like";
    save.addEventListener("click", () => { void saveCopy([entry.path]); });

    right.append(saving, save);
    row.append(name, right);
    list.append(row);
  }
}

function renderSaveState() {
  const box = $("save-state");
  const total = state.doneEntries.length;
  const savedCount = state.doneEntries.filter((entry) => state.savedPaths.has(entry.path)).length;
  box.textContent = "";
  if (!total) {
    box.hidden = true;
    return;
  }

  box.classList.toggle("saved", savedCount > 0);
  if (savedCount === 0) {
    box.textContent = "Not saved yet. These copies are in a temporary folder and are deleted when SqueezeIt closes — click Save to keep the ones you want.";
  } else {
    const dirs = [...state.savedDirs];
    const text = total === 1
      ? "Saved."
      : (savedCount === total ? "All files saved." : `${savedCount} of ${total} saved.`);
    const lead = document.createElement("span");
    lead.textContent = `${text} `;
    box.append(lead);
    if (dirs.length === 1) {
      const label = document.createElement("span");
      label.textContent = "Saved to: ";
      const where = document.createElement("strong");
      where.textContent = dirs[0];
      box.append(label, where);
    } else if (dirs.length > 1) {
      const note = document.createElement("span");
      note.textContent = "The copies are in the folders you picked.";
      box.append(note);
    }
    if (savedCount < total) {
      const rest = document.createElement("span");
      rest.textContent = " The rest are still only in the temporary folder.";
      box.append(rest);
    }
  }
  box.hidden = false;
}

function renderFailures(failures) {
  const box = $("failures");
  const list = $("failure-list");
  list.textContent = "";
  const entries = Array.isArray(failures) ? failures : [];
  for (const failure of entries) {
    const item = document.createElement("li");
    item.textContent = failure;
    list.append(item);
  }
  box.hidden = entries.length === 0;
}

async function showResult() {
  try {
    const { result } = await api("result");
    if (!result) {
      show("home");
      return;
    }
    state.outputDir = result.outputDir || "";
    state.defaultSaveDir = result.defaultSaveDir || "";
    state.savedTo = result.savedTo || "";
    state.savedDirs = new Set(Array.isArray(result.savedDirs) ? result.savedDirs : (result.savedTo ? [result.savedTo] : []));
    state.savedPaths = new Set(Array.isArray(result.savedPaths) ? result.savedPaths : []);
    state.doneEntries = Array.isArray(result.done) ? result.done : [];
    const cancelled = Boolean(result.cancelled);
    $("finished-title").textContent = cancelled ? "Stopped" : "Done!";

    if (result.succeeded > 0) {
      const savedText = result.percentSaved > 0 ? ` — ${result.percentSaved}% smaller` : "";
      const stoppedText = cancelled ? " You stopped early." : "";
      $("summary").textContent = `${result.succeeded} ${result.succeeded === 1 ? "file" : "files"} went from ${formatBytes(result.totalBefore)} to ${formatBytes(result.totalAfter)}${savedText}.${stoppedText}`;
    } else if (cancelled) {
      $("summary").textContent = "You stopped before any file finished. Your originals are unchanged.";
    } else if (result.failed > 0) {
      $("summary").textContent = "We could not make these files smaller. Your originals are safe — see the list below.";
    } else {
      $("summary").textContent = "Everything here is already as small as it can get — no new files were needed.";
    }

    $("done-count").textContent = String(result.succeeded || 0);
    $("saved-amount").textContent = formatBytes(result.totalSaved || 0);
    $("saved-percent").textContent = `${result.percentSaved || 0}%`;
    $("open-folder").disabled = !result.outputDir;
    $("open-folder").title = result.outputDir ? "" : "No output folder was created";
    $("save-copy").disabled = !(Array.isArray(result.done) && result.done.length);

    const pathBox = $("output-path");
    if (result.outputDir) {
      pathBox.textContent = "";
      const label = document.createElement("span");
      label.textContent = "Temporary folder (cleared when SqueezeIt closes): ";
      const where = document.createElement("strong");
      where.textContent = result.outputDir;
      pathBox.append(label, where);
      pathBox.hidden = false;
    } else {
      pathBox.textContent = "";
      pathBox.hidden = true;
    }

    renderDoneList(state.doneEntries);
    renderSaveState();
    renderFailures(result.failures);
    show("finished");
  } catch (error) {
    showNotice(error.message, "error");
    show("home");
  }
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

function wire() {
  $("welcome-close").addEventListener("click", async () => {
    try { await api("ack-welcome"); } catch { /* cosmetic only */ }
    show("home");
  });

  $("choose-files").addEventListener("click", () => { void chooseFiles(); });
  $("choose-folder").addEventListener("click", () => { void chooseFolder(); });

  $("add-more").addEventListener("click", () => {
    show("home");
    showNotice("Choose more files to add to your list.");
  });

  $("clear-list").addEventListener("click", () => {
    if (!state.items.length) return;
    if (!window.confirm("Remove every file from the list?")) return;
    state.items = [];
    state.estimates.clear();
    state.sliderTouched = false;
    render();
    show("home");
  });

  $("opt-output-pick").addEventListener("click", async () => {
    try {
      const picked = await api("dialog/folder");
      if (picked.error) {
        showNotice(picked.error, "error");
        return;
      }
      if (picked.paths && picked.paths.length) {
        $("opt-output").value = picked.paths[0];
        await saveOptions(true);
      }
    } catch (error) {
      showNotice(error.message, "error");
    }
  });

  for (const id of ["opt-aspect", "opt-width", "opt-jobs", "opt-webp", "opt-output", "opt-max-size", "opt-max-unit"]) {
    $(id).addEventListener("change", async () => {
      try {
        await saveOptions();
        updateQualityUI();
        if (id === "opt-webp" || id === "opt-max-size" || id === "opt-max-unit") await refreshEstimates();
      } catch (error) {
        showNotice(error.message, "error");
      }
    });
  }

  $("quality").addEventListener("input", () => {
    state.sliderTouched = true;
    updateQualityUI();
    scheduleEstimates();
  });
  $("quality").addEventListener("change", () => {
    state.sliderTouched = true;
    updateQualityUI();
    void refreshEstimates();
  });

  $("start").addEventListener("click", () => { void startJob(); });

  $("stop").addEventListener("click", async () => {
    $("stop").disabled = true;
    $("stop").textContent = "Stopping…";
    $("working-time").textContent = "Stopping…";
    try {
      await api("stop");
    } catch {
      showNotice("We could not stop straight away. Please wait a moment.", "error");
    }
  });

  $("open-folder").addEventListener("click", async () => {
    try {
      const result = await api("open-folder", { path: state.outputDir });
      if (!result.ok) showNotice("We could not find the folder. It may have been moved.", "error");
    } catch (error) {
      showNotice(error.message, "error");
    }
  });

  $("save-copy").addEventListener("click", () => { void saveCopy(); });

  $("make-more").addEventListener("click", () => {
    state.items = [];
    state.estimates.clear();
    state.outputDir = "";
    state.savedTo = "";
    state.savedDirs.clear();
    state.savedPaths.clear();
    state.doneEntries = [];
    state.sliderTouched = false;
    $("quality").value = "50";
    updateQualityUI();
    render();
    show("home");
  });

  $("notice-close").addEventListener("click", hideNotice);
  $("theme-toggle").addEventListener("click", () => { void cycleTheme(); });
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function loadStatus() {
  const status = await api("status");
  state.status = status;
  state.settings = status.settings || {};
  applyTheme(state.settings.theme || "auto");
  populateOptions();
  updateQualityUI();

  $("version").textContent = status.version || "1.1.0";
  const fastNames = {
    h264_nvenc: "NVIDIA fast video encoding ready",
    h264_amf: "AMD fast video encoding ready",
    h264_qsv: "Intel fast video encoding ready",
    h264_mf: "Windows fast video encoding ready",
  };
  $("hardware-note").textContent = status.hardwareEncoder
    ? (fastNames[status.hardwareEncoder] || "Fast video encoding ready")
    : "Standard video encoding";

  if (status.notice) showNotice(status.notice);
  if (!status.welcomeSeen) {
    show("welcome");
    return;
  }
  // If a batch already finished on this server (for example the page was
  // reloaded), go straight back to the results instead of an empty home screen.
  try {
    const { result } = await api("result");
    if (result && (result.succeeded || result.failed || result.skipped)) {
      await showResult();
      return;
    }
  } catch { /* show the normal home screen */ }
  show("home");
}

async function boot() {
  wire();
  try {
    await loadStatus();
  } catch (error) {
    showNotice(error.message, "error");
    show("home");
  }
  setInterval(() => {
    void api("heartbeat").catch(() => {});
  }, 15000);
}

void boot();
