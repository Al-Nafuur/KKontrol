import { SerialTransport, hex } from "./serial.js";
import { K3Protocol } from "./protocols/k3.js";
import { LegacyProtocol } from "./protocols/legacy.js";
import { DPI, MAX_HEIGHT, MAX_WIDTH, pixelsToMm, getBlackRows, validateRaster } from "./raster.js";
import {
  DEFAULT_WORK_AREA, MAX_WORK_AREA_DIMENSION_MM, artworkFitsArea, clampArtworkPosition,
  uiPositionToMachineSteps, getJogDeltaToPosition,
  machineStepsToUiPosition, isMachinePositionWithinArea
} from "./position.js";

const $ = selector => document.querySelector(selector);
const els = {
  browserSupport: $("#browserSupport"), connectionStatus: $("#connectionStatus"),
  deviceInfo: $("#deviceInfo"), connectButton: $("#connectButton"), protocolSelect: $("#protocolSelect"),
  homeConfirm: $("#homeConfirm"), homeConfirmText: $("#homeConfirmText"), markHomeButton: $("#markHomeButton"),
  textTab: $("#textTab"), imageTab: $("#imageTab"), textControls: $("#textControls"), imageControls: $("#imageControls"),
  textInput: $("#textInput"), fontSelect: $("#fontSelect"), fontSize: $("#fontSize"), fontSizeValue: $("#fontSizeValue"),
  textAlign: $("#textAlign"), fontFile: $("#fontFile"), fontStatus: $("#fontStatus"), imageFile: $("#imageFile"), imageName: $("#imageName"),
  widthPx: $("#widthPx"), physicalSize: $("#physicalSize"), pixelSize: $("#pixelSize"), threshold: $("#threshold"), thresholdValue: $("#thresholdValue"),
  previewCanvas: $("#previewCanvas"), emptyPreview: $("#emptyPreview"), previewMeta: $("#previewMeta"), previewButton: $("#previewButton"), dryRunButton: $("#dryRunButton"),
  workArea: $("#workArea"), areaWidthMm: $("#areaWidthMm"), areaHeightMm: $("#areaHeightMm"),
  positionXmm: $("#positionXmm"), positionYmm: $("#positionYmm"), positionInfo: $("#positionInfo"), positionMarker: $("#positionMarker"),
  previewStage: $(".preview-stage"), headPositionHint: $("#headPositionHint"),
  depth: $("#depth"), depthValue: $("#depthValue"), power: $("#power"), powerValue: $("#powerValue"),
  k3PowerNote: $("#k3PowerNote"), legacyPowerControl: $("#legacyPowerControl"), fanEnabled: $("#fanEnabled"),
  fanStatus: $("#fanStatus"), fanToggleButton: $("#fanToggleButton"),
  frameToggleButton: $("#frameToggleButton"), frameStatus: $("#frameStatus"),
  jogStep: $("#jogStep"), jogValue: $("#jogValue"), safetyConfirm: $("#safetyConfirm"), engraveButton: $("#engraveButton"),
  jobStatus: $("#jobStatus"), progressPercent: $("#progressPercent"), progressBar: $("#progressBar"),
  logOutput: $("#logOutput"), clearLogButton: $("#clearLogButton"), confirmDialog: $("#confirmDialog"),
  dialogSummary: $("#dialogSummary"), cancelJobButton: $("#cancelJobButton"), confirmJobButton: $("#confirmJobButton")
};

const protocols = { k3: K3Protocol, legacy: LegacyProtocol };
const state = {
  transport: new SerialTransport(log),
  protocol: null,
  mode: "text",
  workArea: { ...DEFAULT_WORK_AREA },
  artworkPosition: { x: 0, y: 0 },
  headPosition: null,
  frameActive: false,
  frameOrigin: null,
  frameReturnPosition: null,
  dragStart: null,
  sourceImage: null,
  customFontName: null,
  currentRaster: null,
  previewReady: false,
  fanOn: null,
  busy: false,
  cancelRequested: false,
  pendingJob: false
};

function log(message, level = "INFO") {
  const stamp = new Date().toLocaleTimeString();
  const line = `[${stamp}] ${level}: ${message}`;
  els.logOutput.textContent += `\n${line}`;
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

function setStatus(connected) {
  els.connectionStatus.classList.toggle("online", connected);
  els.connectionStatus.classList.toggle("offline", !connected);
  els.connectionStatus.innerHTML = connected ? "<span></span> Connected" : "<span></span> Disconnected";
  els.connectButton.textContent = connected ? "Disconnect" : "Connect engraver";
  els.homeConfirmText.textContent = connected
    ? "I have manually returned the head to Home (upper-left)."
    : "Before connecting, manually position the head at Home (upper-left).";
  els.protocolSelect.disabled = connected || state.busy;
  updateButtons();
}

function selectedProtocol() {
  return protocols[els.protocolSelect.value];
}

function updateButtons() {
  const isConnected = state.transport.connected;
  const placementValid = state.currentRaster && artworkFitsArea(artworkSizeMm(), state.workArea);
  els.engraveButton.disabled = !isConnected || !state.headPosition || !state.previewReady ||
    !placementValid || !els.safetyConfirm.checked || state.busy || state.frameActive;
  els.dryRunButton.disabled = !state.previewReady || state.busy || state.frameActive;
  updateFanControl();
  document.querySelectorAll(".jog-btn[data-x]").forEach(button => button.disabled = !isConnected || !state.headPosition || state.busy || state.frameActive);
  els.connectButton.disabled = state.busy || state.frameActive || (!isConnected && !els.homeConfirm.checked);
  els.homeConfirm.disabled = state.busy || state.frameActive;
  els.markHomeButton.disabled = !isConnected || !els.homeConfirm.checked || state.busy || state.frameActive;
  els.areaWidthMm.disabled = isConnected || state.busy || state.frameActive;
  els.areaHeightMm.disabled = isConnected || state.busy || state.frameActive;
  els.positionXmm.disabled = !state.currentRaster || !placementValid || state.busy || state.frameActive;
  els.positionYmm.disabled = !state.currentRaster || !placementValid || state.busy || state.frameActive;
  [
    els.textTab, els.imageTab, els.textInput, els.fontSelect, els.fontSize, els.textAlign,
    els.fontFile, els.imageFile, els.widthPx, els.threshold, els.previewButton
  ].forEach(control => { control.disabled = state.frameActive; });
  updateFrameControl(isConnected, !!placementValid);
  updatePositionDisplay();
}

function updateFanControl() {
  const isConnected = state.transport.connected;
  els.fanToggleButton.disabled = !isConnected || state.busy || state.frameActive;
  els.fanToggleButton.textContent = state.fanOn ? "Turn fan off" : "Turn fan on";
  els.fanStatus.textContent = state.fanOn === null
    ? "Fan state unknown."
    : `Fan ${state.fanOn ? "on" : "off"}.`;
}

function updateFrameControl(isConnected, placementValid) {
  const supportsFrame = typeof selectedProtocol().startFrame === "function";
  const frameSizeValid = state.currentRaster &&
    state.currentRaster.width <= selectedProtocol().maxFrameSteps &&
    state.currentRaster.height <= selectedProtocol().maxFrameSteps;
  els.frameToggleButton.textContent = state.frameActive ? "Stop alignment frame" : "Show alignment frame";
  els.frameToggleButton.disabled = !isConnected || !supportsFrame || state.busy ||
    (!state.frameActive && (!state.headPosition || !placementValid || !frameSizeValid));
  if (!supportsFrame) {
    els.frameStatus.textContent = "The selected protocol does not support alignment frames.";
  } else if (state.frameActive) {
    els.frameStatus.textContent = "Frame is running. Stop it here before engraving or disconnecting; use the physical power switch if it will not stop.";
  } else if (!isConnected) {
    els.frameStatus.textContent = "Connect the engraver to show the alignment frame.";
  } else if (!state.headPosition) {
    els.frameStatus.textContent = "Position is unknown. Return the head to Home and confirm it before framing.";
  } else if (!placementValid) {
    els.frameStatus.textContent = "Create artwork that fits the configured laser area first.";
  } else if (!frameSizeValid) {
    els.frameStatus.textContent = `Frame dimensions are limited to ${selectedProtocol().maxFrameSteps} steps per side.`;
  } else if (selectedProtocol().id === "k3") {
    els.frameStatus.textContent = "Starts at the artwork's upper-left. Uses the frame command observed on this K5 through Legacy; K3-profile framing still needs hardware verification.";
  } else {
    els.frameStatus.textContent = "The frame starts at the artwork's upper-left. After Stop, the app returns to the previous head position.";
  }
}
function updateProtocolControls() {
  const isLegacy = els.protocolSelect.value === "legacy";
  els.legacyPowerControl.classList.toggle("hidden", !isLegacy);
  els.k3PowerNote.classList.toggle("hidden", isLegacy);
  if (state.transport.connected) {
    log("Protocol selection is locked until the device is disconnected.", "WARN");
    return;
  }
  state.protocol = selectedProtocol();
  els.depth.max = isLegacy ? "100" : "255";
  if (Number(els.depth.value) > Number(els.depth.max)) els.depth.value = els.depth.max;
  els.depthValue.textContent = els.depth.value;
}

function setBusy(value) {
  state.busy = value;
  updateButtons();
}

function setProgress(current, total) {
  const percent = total ? Math.round((current / total) * 100) : 0;
  els.progressBar.style.width = `${percent}%`;
  els.progressPercent.textContent = `${percent}%`;
}

function updateDimensions(width, height) {
  els.physicalSize.textContent = `${pixelsToMm(width).toFixed(1)} × ${pixelsToMm(height).toFixed(1)} mm`;
  els.pixelSize.textContent = `${width} × ${height} px`;
}

function artworkSizeMm() {
  return state.currentRaster
    ? { width: pixelsToMm(state.currentRaster.width), height: pixelsToMm(state.currentRaster.height) }
    : { width: 0, height: 0 };
}

function updatePositionDisplay() {
  const { width, height } = state.workArea;
  els.workArea.style.aspectRatio = `${width} / ${height}`;
  const availableWidth = Math.max(1, Math.min(520, (els.previewStage.clientWidth || 536) - 16));
  const scale = Math.min(availableWidth / width, 360 / height);
  const border = parseFloat(getComputedStyle(els.workArea).borderLeftWidth) || 0;
  els.workArea.style.width = `${width * scale + border * 2}px`;
  els.workArea.style.height = `${height * scale + border * 2}px`;
  const artwork = artworkSizeMm();
  const fits = !!state.currentRaster && artworkFitsArea(artwork, state.workArea);
  if (fits) {
    state.artworkPosition = clampArtworkPosition(state.artworkPosition, artwork, state.workArea);
    els.previewCanvas.style.left = `${state.artworkPosition.x / width * 100}%`;
    els.previewCanvas.style.top = `${state.artworkPosition.y / height * 100}%`;
    els.previewCanvas.style.width = `${artwork.width / width * 100}%`;
    els.previewCanvas.style.height = `${artwork.height / height * 100}%`;
  } else {
    els.previewCanvas.style.left = "0";
    els.previewCanvas.style.top = "0";
    els.previewCanvas.style.width = `${artwork.width / width * 100}%`;
    els.previewCanvas.style.height = `${artwork.height / height * 100}%`;
  }
  els.previewCanvas.classList.toggle("hidden", !state.currentRaster);
  els.emptyPreview.classList.toggle("hidden", !!state.currentRaster);
  els.positionXmm.value = state.artworkPosition.x.toFixed(2);
  els.positionYmm.value = state.artworkPosition.y.toFixed(2);

  if (state.headPosition && !state.frameActive) {
    const head = machineStepsToUiPosition(state.headPosition);
    els.positionMarker.style.left = `${head.x / width * 100}%`;
    els.positionMarker.style.top = `${head.y / height * 100}%`;
    els.positionMarker.classList.remove("hidden");
  } else {
    els.positionMarker.classList.add("hidden");
  }

  if (!state.currentRaster) {
    els.positionInfo.textContent = "Artwork position is measured from Home at the upper-left.";
  } else if (!fits) {
    els.positionInfo.textContent = "Artwork is larger than the configured laser area. Reduce the artwork size.";
  } else if (state.frameActive) {
    els.positionInfo.textContent = `Alignment frame running around artwork at X ${state.artworkPosition.x.toFixed(2)} mm, Y ${state.artworkPosition.y.toFixed(2)} mm from Home.`;
  } else if (!state.headPosition) {
    els.positionInfo.textContent = `Artwork origin: X ${state.artworkPosition.x.toFixed(2)} mm, Y ${state.artworkPosition.y.toFixed(2)} mm from Home. Head position is unknown; confirm Home before connecting or jogging.`;
  } else {
    const head = machineStepsToUiPosition(state.headPosition);
    els.positionInfo.textContent = `Artwork origin: X ${state.artworkPosition.x.toFixed(2)} mm, Y ${state.artworkPosition.y.toFixed(2)} mm · Head: X ${head.x.toFixed(2)} mm, Y ${head.y.toFixed(2)} mm from Home.`;
  }

  els.headPositionHint.textContent = state.frameActive
    ? "Alignment frame is active; use Stop alignment frame before moving or engraving."
    : !state.transport.connected
    ? "Manually position the head at Home before connecting."
    : state.headPosition
      ? "Position is tracked from the confirmed Home and app jog commands."
      : "Position is unknown. Manually return the head to Home, confirm it above, then click Confirm head is at Home.";
}

function updateWorkAreaFromInputs() {
  const width = Number(els.areaWidthMm.value);
  const height = Number(els.areaHeightMm.value);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 ||
      width > MAX_WORK_AREA_DIMENSION_MM || height > MAX_WORK_AREA_DIMENSION_MM) {
    els.areaWidthMm.value = state.workArea.width.toFixed(2);
    els.areaHeightMm.value = state.workArea.height.toFixed(2);
    log(`Laser area dimensions must be between 1 and ${MAX_WORK_AREA_DIMENSION_MM} mm.`, "ERROR");
    return;
  }
  state.workArea = { width, height };
  updateButtons();
}

function updateArtworkPositionFromInputs() {
  const x = Number(els.positionXmm.value);
  const y = Number(els.positionYmm.value);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    updatePositionDisplay();
    return;
  }
  const position = clampArtworkPosition({ x, y }, artworkSizeMm(), state.workArea);
  if (position.x !== x || position.y !== y) log("Artwork position was adjusted to stay inside the laser area.", "WARN");
  state.artworkPosition = position;
  updateButtons();
}

function startArtworkDrag(event) {
  if (!state.currentRaster || state.busy || state.frameActive || !artworkFitsArea(artworkSizeMm(), state.workArea)) return;
  event.preventDefault();
  state.dragStart = {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    position: { ...state.artworkPosition }
  };
  els.previewCanvas.setPointerCapture(event.pointerId);
}

function moveArtwork(event) {
  if (!state.dragStart || event.pointerId !== state.dragStart.pointerId) return;
  const bounds = els.workArea.getBoundingClientRect();
  const border = parseFloat(getComputedStyle(els.workArea).borderLeftWidth) || 0;
  const innerWidth = bounds.width - border * 2;
  const innerHeight = bounds.height - border * 2;
  const x = state.dragStart.position.x + (event.clientX - state.dragStart.clientX) / innerWidth * state.workArea.width;
  const y = state.dragStart.position.y + (event.clientY - state.dragStart.clientY) / innerHeight * state.workArea.height;
  state.artworkPosition = clampArtworkPosition({ x, y }, artworkSizeMm(), state.workArea);
  updateButtons();
}

function stopArtworkDrag(event) {
  if (state.dragStart?.pointerId === event.pointerId) state.dragStart = null;
}

function renderTextSource() {
  const text = els.textInput.value || " ";
  const size = Number(els.fontSize.value);
  const family = state.customFontName || els.fontSelect.value;
  const lines = text.replace(/\r/g, "").split("\n");
  const measureCanvas = document.createElement("canvas");
  const measure = measureCanvas.getContext("2d");
  measure.font = `${size}px "${family}"`;
  const metrics = lines.map(line => measure.measureText(line || " "));
  const padding = Math.ceil(size * 0.35);
  const lineHeight = Math.ceil(size * 1.25);
  const naturalWidth = Math.max(1, ...metrics.map(item => Math.ceil(item.width))) + padding * 2;
  const naturalHeight = Math.max(1, lines.length * lineHeight + padding * 2);
  const source = document.createElement("canvas");
  source.width = naturalWidth;
  source.height = naturalHeight;
  const ctx = source.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, source.width, source.height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";
  ctx.font = `${size}px "${family}"`;
  ctx.textAlign = els.textAlign.value;
  lines.forEach((line, index) => {
    let x = padding;
    if (ctx.textAlign === "center") x = naturalWidth / 2;
    else if (ctx.textAlign === "right") x = naturalWidth - padding;
    ctx.fillText(line, x, padding + index * lineHeight);
  });
  return source;
}

function resizeSource(source, widthPx) {
  let targetWidth = Math.max(8, Math.min(MAX_WIDTH, Math.round(widthPx)));
  const aspect = source.height / source.width;
  let targetHeight = Math.max(1, Math.round(targetWidth * aspect));
  if (targetHeight > MAX_HEIGHT) {
    targetWidth = Math.max(8, Math.floor(MAX_HEIGHT / aspect));
    targetHeight = MAX_HEIGHT;
  }
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
  return canvas;
}

function applyThreshold(sourceCanvas, threshold) {
  const output = document.createElement("canvas");
  output.width = sourceCanvas.width;
  output.height = sourceCanvas.height;
  const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const outputCtx = output.getContext("2d", { willReadFrequently: true });
  const imageData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    const r = data[i] * alpha + 255 * (1 - alpha);
    const g = data[i + 1] * alpha + 255 * (1 - alpha);
    const b = data[i + 2] * alpha + 255 * (1 - alpha);
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const value = luminance < threshold ? 0 : 255;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  outputCtx.putImageData(imageData, 0, 0);
  return output;
}

async function updatePreview() {
  try {
    if (state.mode === "image" && !state.sourceImage) {
      state.currentRaster = null;
      state.previewReady = false;
      els.emptyPreview.classList.remove("hidden");
      els.previewMeta.textContent = "Waiting for image";
      updateButtons();
      return;
    }
    if (state.mode === "text" && !els.textInput.value.trim()) {
      state.currentRaster = null;
      state.previewReady = false;
      els.emptyPreview.classList.remove("hidden");
      els.previewMeta.textContent = "Enter text";
      updateButtons();
      return;
    }

    const width = Math.max(8, Math.min(MAX_WIDTH, Number(els.widthPx.value) || 250));
    els.widthPx.value = width;
    const source = state.mode === "text" ? renderTextSource() : state.sourceImage;
    const resized = resizeSource(source, width);
    const thresholded = applyThreshold(resized, Number(els.threshold.value));
    const ctx = els.previewCanvas.getContext("2d");
    els.previewCanvas.width = thresholded.width;
    els.previewCanvas.height = thresholded.height;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(thresholded, 0, 0);
    els.emptyPreview.classList.add("hidden");
    els.previewMeta.textContent = `${thresholded.width} × ${thresholded.height} px · ${DPI} DPI`;
    state.currentRaster = getBlackRows(thresholded);
    validateRaster(state.currentRaster);
    state.previewReady = true;
    updateDimensions(thresholded.width, thresholded.height);
    updateButtons();
  } catch (error) {
    state.currentRaster = null;
    state.previewReady = false;
    els.previewMeta.textContent = "Preview error";
    els.emptyPreview.classList.remove("hidden");
    log(error.message, "ERROR");
    updateButtons();
  }
}

function setMode(mode) {
  state.mode = mode;
  els.textTab.classList.toggle("active", mode === "text");
  els.imageTab.classList.toggle("active", mode === "image");
  els.textTab.setAttribute("aria-selected", String(mode === "text"));
  els.imageTab.setAttribute("aria-selected", String(mode === "image"));
  els.textControls.classList.toggle("hidden", mode !== "text");
  els.imageControls.classList.toggle("hidden", mode !== "image");
  updatePreview();
}

async function connectOrDisconnect() {
  if (state.transport.connected) {
    if (state.frameActive) {
      await stopAlignmentFrame();
      if (state.frameActive) return;
    }
    await state.transport.disconnect();
    state.protocol = null;
    state.fanOn = null;
    state.headPosition = null;
    state.frameOrigin = null;
    state.frameReturnPosition = null;
    els.homeConfirm.checked = false;
    setStatus(false);
    els.deviceInfo.textContent = "Disconnected. The head position is no longer tracked.";
    return;
  }
  if (!els.homeConfirm.checked) return;
  setBusy(true);
  try {
    state.protocol = selectedProtocol();
    await state.transport.connect();
    await state.protocol.connect(state.transport);
    state.headPosition = { x: 0, y: 0 };
    state.frameActive = false;
    state.frameOrigin = null;
    state.frameReturnPosition = null;
    els.homeConfirm.checked = false;
    setStatus(true);
    const p = els.protocolSelect.value === "k3" ? "K3/K5 raster protocol" : "KKengraver legacy protocol (experimental)";
    els.deviceInfo.textContent = `Connected at 115200 baud · ${p}. Position is tracked from the manually confirmed Home (upper-left).`;
    log(`Connected using ${state.protocol.name}.`);
  } catch (error) {
    log(error.message, "ERROR");
    await state.transport.disconnect().catch(() => {});
    state.fanOn = null;
    state.headPosition = null;
    state.frameActive = false;
    state.frameOrigin = null;
    state.frameReturnPosition = null;
    setStatus(false);
    els.deviceInfo.textContent = "Connection failed. Check the USB cable, browser support and selected device.";
  } finally {
    setBusy(false);
  }
}

function currentSettings() {
  return {
    depth: Number(els.depth.value),
    power: Number(els.power.value),
    fan: els.fanEnabled.checked,
    cancelled: () => state.cancelRequested
  };
}

function buildDryRun() {
  if (!state.currentRaster) throw new Error("Generate a preview first.");
  const raster = state.currentRaster;
  const protocol = selectedProtocol();
  const settings = currentSettings();
  const lines = [];
  lines.push(`KKontrol dry-run · ${protocol.name}`);
  lines.push(`Image: ${raster.width} × ${raster.height} px (${pixelsToMm(raster.width).toFixed(2)} × ${pixelsToMm(raster.height).toFixed(2)} mm @ 500 DPI)`);
  lines.push(`Depth: ${settings.depth}`);
  lines.push(`Fan: ${settings.fan ? "on" : "off"}`);
  lines.push(`Configured work area: ${state.workArea.width.toFixed(2)} × ${state.workArea.height.toFixed(2)} mm`);
  lines.push(`Artwork origin from Home: X ${state.artworkPosition.x.toFixed(2)} mm, Y ${state.artworkPosition.y.toFixed(2)} mm`);
  lines.push("At job start, the app jogs from the tracked head position to the artwork origin.");
  lines.push("No serial data sent.");
  lines.push("");
  if (protocol.id === "k3") {
    lines.push("Setup: 1c 00 04 00 | 06 00 04 00" + (settings.fan ? " | 04 00 04 00" : ""));
    lines.push("Start at current position: 14 00 07 00 00 00 00");
    let sent = 0;
    raster.rows.forEach((row, y) => {
      if (!row.some(Boolean)) return;
      const packet = buildK3RowPacketForLog(row, y, settings.depth);
      if (sent < 6 || y === raster.height - 1) lines.push(`y=${y} len=${packet.length}: ${hex(packet)}`);
      sent++;
    });
    lines.push(`... ${sent} non-empty row packets; ACK 09 expected per row.`);
  } else {
    const legacyDepth = Math.max(1, Math.min(100, settings.depth));
    lines.push(`Header: 23 00 0f 00 00 00 00 ${hex16(raster.width)} ${hex16(raster.height)} ${hex16(settings.power * 10)} 00 ${legacyDepth.toString(16).padStart(2,"0")}`);
    let sent = 0;
    raster.rows.forEach((row, y) => {
      if (!row.some(Boolean)) return;
      if (sent < 6 || y === raster.height - 1) lines.push(`y=${y}: legacy row packet (${Math.ceil(raster.width / 8) + 4} bytes incl. checksum)`);
      sent++;
    });
    lines.push(`... ${sent} non-empty row packets; ACK 09 expected after each row.`);
    lines.push("Epilogue: 0a 00 04 00 (ACK 09), then 24 00 04 00 twice.");
  }
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "kkontrol-dry-run.txt";
  a.click();
  URL.revokeObjectURL(url);
  log("Dry-run report generated and downloaded. No serial commands sent.");
}

function buildK3RowPacketForLog(row, y, depth) {
  const width = row.length;
  const packed = new Uint8Array(Math.ceil(width / 8));
  for (let x = 0; x < width; x++) if (row[x]) packed[x >> 3] |= (0x80 >> (x & 7));
  const length = 9 + packed.length;
  return Uint8Array.from([0x09, length >> 8, length & 255, 0, depth, 0x03, 0xe8, y >> 8, y & 255, ...packed]);
}
function hex16(value) { return `${((value >> 8) & 255).toString(16).padStart(2,"0")} ${(value & 255).toString(16).padStart(2,"0")}`; }

async function startEngraving() {
  if (!state.transport.connected || !state.currentRaster || !state.headPosition || state.frameActive) return;
  if (!els.safetyConfirm.checked) return;
  if (!artworkFitsArea(artworkSizeMm(), state.workArea)) {
    log("Artwork does not fit inside the configured laser area.", "ERROR");
    return;
  }
  const protocol = selectedProtocol();
  const raster = state.currentRaster;
  const settings = currentSettings();
  els.dialogSummary.textContent = `${raster.width} × ${raster.height} px · ${pixelsToMm(raster.width).toFixed(1)} × ${pixelsToMm(raster.height).toFixed(1)} mm · origin X ${state.artworkPosition.x.toFixed(2)} mm, Y ${state.artworkPosition.y.toFixed(2)} mm from Home · depth ${settings.depth} · ${protocol.name}. The head will move to the artwork origin before sending.`;
  els.confirmDialog.showModal();
  state.pendingJob = true;
}

async function runConfirmedJob() {
  if (!state.pendingJob || !state.transport.connected || !state.currentRaster || !state.headPosition || state.frameActive) return;
  state.pendingJob = false;
  els.confirmDialog.close();
  state.cancelRequested = false;
  const targetPosition = uiPositionToMachineSteps(state.artworkPosition);
  if (!isMachinePositionWithinArea(targetPosition, state.workArea)) {
    log("Artwork origin is outside the configured laser area.", "ERROR");
    return;
  }
  setBusy(true);
  setProgress(0, state.currentRaster.height);
  els.jobStatus.textContent = "Sending job…";
  log(`Starting ${state.protocol.name} job: ${state.currentRaster.width} × ${state.currentRaster.height} px.`);
  try {
    const { dx, dy } = getJogDeltaToPosition(state.headPosition, state.artworkPosition);
    if (dx || dy) {
      await state.protocol.jog(state.transport, dx, dy);
      state.headPosition = targetPosition;
      log(`Moved to artwork origin X ${state.artworkPosition.x.toFixed(2)} mm, Y ${state.artworkPosition.y.toFixed(2)} mm from Home.`);
    }
    const result = await state.protocol.engrave(state.transport, state.currentRaster, currentSettings(), (line, total, sent, skipped) => {
      setProgress(line, total);
      els.jobStatus.textContent = `Line ${line}/${total} · sent ${sent} · blank ${skipped}`;
    });
    state.headPosition = null;
    state.fanOn = els.fanEnabled.checked;
    els.jobStatus.textContent = result.completionConfirmed === false ? "Data sent · device completion not confirmed" : "Job data sent";
    log(`Transfer finished. ${result.sent} rows sent; ${result.skipped} blank rows skipped.`);
  } catch (error) {
    state.headPosition = null;
    state.fanOn = null;
    els.jobStatus.textContent = "Transfer stopped / failed";
    log(error.message, "ERROR");
    log("If the controller or laser remains active, use the engraver's physical power switch. Browser disconnect is not an emergency stop.", "WARN");
    log("Head position is no longer tracked. Manually return it to Home and confirm the position before continuing.", "WARN");
  } finally {
    setBusy(false);
    updateButtons();
  }
}

async function jog(dx, dy) {
  if (!state.transport.connected || !state.protocol || !state.headPosition || state.busy || state.frameActive) return;
  const multiplier = Number(els.jogStep.value);
  const x = dx === 0 ? 0 : Math.sign(dx) * multiplier;
  const y = dy === 0 ? 0 : Math.sign(dy) * multiplier;
  const target = { x: state.headPosition.x + x, y: state.headPosition.y + y };
  if (!isMachinePositionWithinArea(target, state.workArea)) {
    log("Jog blocked because it would leave the configured laser area.", "WARN");
    return;
  }
  setBusy(true);
  try {
    await state.protocol.jog(state.transport, x, y);
    state.headPosition = target;
    const position = machineStepsToUiPosition(target);
    log(`Head moved to X ${position.x.toFixed(2)} mm, Y ${position.y.toFixed(2)} mm from Home.`);
  } catch (error) { log(error.message, "ERROR"); }
  finally { setBusy(false); }
}

function confirmHomePosition() {
  if (!state.transport.connected || !els.homeConfirm.checked || state.busy || state.frameActive) return;
  state.headPosition = { x: 0, y: 0 };
  els.homeConfirm.checked = false;
  els.deviceInfo.textContent = "Head position reset to Home (upper-left), based on your confirmation.";
  log("Head position tracker reset at the manually confirmed Home.");
  updateButtons();
}

async function toggleAlignmentFrame() {
  if (state.frameActive) {
    await stopAlignmentFrame();
    return;
  }
  const protocol = state.protocol;
  const raster = state.currentRaster;
  if (!state.transport.connected || !protocol?.startFrame || !raster || !state.headPosition || state.busy) return;
  if (!artworkFitsArea(artworkSizeMm(), state.workArea)) {
    log("Artwork does not fit inside the configured laser area.", "ERROR");
    return;
  }
  if (raster.width > protocol.maxFrameSteps || raster.height > protocol.maxFrameSteps) {
    log(`Alignment frame dimensions are limited to ${protocol.maxFrameSteps} steps per side.`, "ERROR");
    return;
  }

  const artwork = artworkSizeMm();
  const frameOriginUi = state.artworkPosition;
  const origin = uiPositionToMachineSteps(frameOriginUi);
  if (!isMachinePositionWithinArea(origin, state.workArea)) {
    log("Frame origin is outside the configured laser area.", "ERROR");
    return;
  }
  const returnPosition = { ...state.headPosition };
  setBusy(true);
  let frameStartAttempted = false;
  try {
    const { dx, dy } = getJogDeltaToPosition(state.headPosition, frameOriginUi);
    if (dx || dy) await protocol.jog(state.transport, dx, dy);
    state.headPosition = origin;
    state.frameOrigin = origin;
    state.frameReturnPosition = returnPosition;
    frameStartAttempted = true;
    state.frameActive = true;
    await protocol.startFrame(state.transport, raster.width, raster.height);
    state.headPosition = null;
    log(`Alignment frame started around the artwork. Stop it in the app; the head will return to its previous position.`);
  } catch (error) {
    state.headPosition = null;
    if (frameStartAttempted) {
      state.frameActive = true;
      log("The frame-start command was not acknowledged; the frame may still be running. Use Stop alignment frame or the physical power switch.", "WARN");
    } else {
      state.frameActive = false;
      state.frameOrigin = null;
      state.frameReturnPosition = null;
    }
    log(error.message, "ERROR");
  } finally {
    setBusy(false);
  }
}

async function stopAlignmentFrame() {
  if (!state.frameActive || !state.transport.connected || !state.protocol?.stopFrame || state.busy) return;
  setBusy(true);
  try {
    await state.protocol.stopFrame(state.transport);
  } catch (error) {
    state.headPosition = null;
    log(error.message, "ERROR");
    log("The frame may still be running. Retry Stop alignment frame or use the physical power switch.", "WARN");
    setBusy(false);
    return;
  }

  state.frameActive = false;
  const frameOrigin = state.frameOrigin;
  const returnPosition = state.frameReturnPosition;
  state.frameOrigin = null;
  state.frameReturnPosition = null;
  if (!frameOrigin || !returnPosition) {
    state.headPosition = null;
    log("Frame stopped, but the head position could not be restored. Manually return to Home and confirm it.", "WARN");
    setBusy(false);
    return;
  }

  try {
    const dx = returnPosition.x - frameOrigin.x;
    const dy = returnPosition.y - frameOrigin.y;
    if (dx || dy) await state.protocol.jog(state.transport, dx, dy);
    state.headPosition = returnPosition;
    log("Alignment frame stopped; head returned to its previous tracked position.");
  } catch (error) {
    state.headPosition = null;
    log(error.message, "ERROR");
    log("The frame stopped, but the return move failed. Manually return the head to Home and confirm it.", "WARN");
  } finally {
    setBusy(false);
  }
}

async function toggleFan() {
  if (!state.transport.connected || !state.protocol || state.busy || state.frameActive) return;
  const enabled = state.fanOn !== true;
  setBusy(true);
  try {
    await state.protocol.setFan(state.transport, enabled);
    state.fanOn = enabled;
    log(`Cooling fan switched ${enabled ? "on" : "off"}.`);
  } catch (error) {
    state.fanOn = null;
    log(error.message, "ERROR");
  } finally {
    setBusy(false);
  }
}

async function loadCustomFont(file) {
  if (!file) return;
  try {
    const name = `KKontrolUserFont_${Date.now()}`;
    const font = new FontFace(name, `url(${URL.createObjectURL(file)})`);
    await font.load();
    document.fonts.add(font);
    state.customFontName = name;
    els.fontStatus.textContent = `Loaded locally: ${file.name}`;
    log(`Custom font loaded: ${file.name}`);
    updatePreview();
  } catch (error) {
    state.customFontName = null;
    els.fontStatus.textContent = `Could not load font: ${error.message}`;
    log(`Font loading failed: ${error.message}`, "ERROR");
  }
}

function setImage(file) {
  if (!file) return;
  const allowedImage = file.type.startsWith("image/") || /\.(png|jpe?g|webp|bmp)$/i.test(file.name);
  if (!allowedImage) {
    log("Please select a supported image file.", "ERROR");
    return;
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    state.sourceImage = img;
    els.imageName.textContent = `${file.name} · ${img.naturalWidth} × ${img.naturalHeight} px`;
    log(`Image loaded: ${file.name} (${img.naturalWidth} × ${img.naturalHeight} px).`);
    updatePreview();
    URL.revokeObjectURL(url);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    log("Could not read the selected image.", "ERROR");
  };
  img.src = url;
}

function onProtocolChange() {
  updateProtocolControls();
  updatePreview();
}

function bindEvents() {
  els.connectButton.addEventListener("click", connectOrDisconnect);
  els.homeConfirm.addEventListener("change", updateButtons);
  els.markHomeButton.addEventListener("click", confirmHomePosition);
  els.protocolSelect.addEventListener("change", onProtocolChange);
  els.textTab.addEventListener("click", () => setMode("text"));
  els.imageTab.addEventListener("click", () => setMode("image"));
  [els.textInput, els.fontSelect, els.fontSize, els.textAlign, els.widthPx, els.threshold].forEach(element => {
    element.addEventListener("input", () => {
      els.fontSizeValue.textContent = `${els.fontSize.value} px`;
      els.thresholdValue.textContent = els.threshold.value;
      updatePreview();
    });
    element.addEventListener("change", updatePreview);
  });
  els.imageFile.addEventListener("change", event => setImage(event.target.files?.[0]));
  els.fontFile.addEventListener("change", event => loadCustomFont(event.target.files?.[0]));
  els.previewButton.addEventListener("click", updatePreview);
  els.dryRunButton.addEventListener("click", () => { try { buildDryRun(); } catch (error) { log(error.message, "ERROR"); } });
  els.areaWidthMm.addEventListener("change", updateWorkAreaFromInputs);
  els.areaHeightMm.addEventListener("change", updateWorkAreaFromInputs);
  els.positionXmm.addEventListener("change", updateArtworkPositionFromInputs);
  els.positionYmm.addEventListener("change", updateArtworkPositionFromInputs);
  els.previewCanvas.addEventListener("pointerdown", startArtworkDrag);
  els.workArea.addEventListener("pointermove", moveArtwork);
  els.workArea.addEventListener("pointerup", stopArtworkDrag);
  els.workArea.addEventListener("pointercancel", stopArtworkDrag);
  window.addEventListener("resize", updatePositionDisplay);
  els.depth.addEventListener("input", () => els.depthValue.textContent = els.depth.value);
  els.power.addEventListener("input", () => els.powerValue.textContent = `${els.power.value}%`);
  els.fanToggleButton.addEventListener("click", toggleFan);
  els.jogStep.addEventListener("input", () => els.jogValue.textContent = `${els.jogStep.value} steps`);
  els.safetyConfirm.addEventListener("change", updateButtons);
  document.querySelectorAll(".jog-btn[data-x]").forEach(button => button.addEventListener("click", () => jog(Number(button.dataset.x), Number(button.dataset.y))));
  els.engraveButton.addEventListener("click", startEngraving);
  els.cancelJobButton.addEventListener("click", () => { state.pendingJob = false; els.confirmDialog.close(); });
  els.confirmJobButton.addEventListener("click", runConfirmedJob);
  els.frameToggleButton.addEventListener("click", toggleAlignmentFrame);
  els.clearLogButton.addEventListener("click", () => { els.logOutput.textContent = "KKontrol log cleared."; });
  if ("serial" in navigator) {
    navigator.serial.addEventListener("disconnect", async () => {
      log("Serial device disconnected.", "WARN");
      if (state.frameActive) log("Serial disconnected while the frame was active. It may still be running; use the physical power switch if needed.", "WARN");
      if (state.transport.connected) await state.transport.disconnect().catch(() => {});
      state.fanOn = null;
      state.headPosition = null;
      state.frameActive = false;
      state.frameOrigin = null;
      state.frameReturnPosition = null;
      els.homeConfirm.checked = false;
      setStatus(false);
    });
  }
}

function initSupport() {
  if (!window.isSecureContext) {
    els.browserSupport.textContent = "HTTPS required";
    els.browserSupport.classList.add("warn");
  } else if ("serial" in navigator) {
    els.browserSupport.textContent = "WebSerial available";
    els.browserSupport.classList.add("ok");
  } else {
    els.browserSupport.textContent = "WebSerial unavailable";
    els.browserSupport.classList.add("warn");
    els.deviceInfo.textContent = "This browser does not expose WebSerial. Try a current desktop Chromium-based browser, or check WebSerial availability in your Firefox build.";
  }
}

bindEvents();
initSupport();
setStatus(false);
updateProtocolControls();
updatePreview();

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").then(() => log("Offline app support registered.")).catch(error => log(`Service worker registration failed: ${error.message}`, "WARN")));
}
