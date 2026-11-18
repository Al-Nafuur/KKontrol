export const DPI = 500;
export const STEPS_PER_MM = DPI / 25.4;
export const MAX_WIDTH = 1600;
export const MAX_HEIGHT = 1520;

export function pixelsToMm(px) {
  return px * 25.4 / DPI;
}

export function mmToSteps(mm) {
  return Math.round(mm * STEPS_PER_MM);
}

export function getBlackRows(canvas) {
  const { width, height } = canvas;
  if (!width || !height) throw new Error("Preview is empty. Create artwork first.");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(width);
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      row[x] = rgba[offset] < 128 ? 1 : 0;
    }
    rows.push(row);
  }
  return { width, height, rows };
}

export function packK3Row(blackPixels) {
  const packed = new Uint8Array(Math.ceil(blackPixels.length / 8));
  for (let x = 0; x < blackPixels.length; x++) {
    if (blackPixels[x]) packed[x >> 3] |= (0x80 >> (x & 7));
  }
  return packed;
}

export function buildK3RowPacket(blackPixels, y, depth = 10, powerMw = 1000) {
  const data = packK3Row(blackPixels);
  const length = 9 + data.length;
  return Uint8Array.from([
    0x09,
    (length >> 8) & 0xff, length & 0xff,
    (depth >> 8) & 0xff, depth & 0xff,
    (powerMw >> 8) & 0xff, powerMw & 0xff,
    (y >> 8) & 0xff, y & 0xff,
    ...data
  ]);
}

export function packLegacyRow(blackPixels) {
  // The legacy kkengraver profile encodes WHITE as 1 and BLACK as 0.
  const packed = new Uint8Array(Math.ceil(blackPixels.length / 8));
  packed.fill(0xff);
  for (let x = 0; x < blackPixels.length; x++) {
    const mask = 0x80 >> (x & 7);
    if (blackPixels[x]) packed[x >> 3] &= (~mask) & 0xff;
  }
  return packed;
}

export function buildLegacyRowPacket(blackPixels) {
  const pixelData = packLegacyRow(blackPixels);
  const row = [0x22, 0x00, 0x00, ...pixelData];
  const declaredLength = row.length + 1; // includes the checksum byte
  row[1] = (declaredLength >> 8) & 0xff;
  row[2] = declaredLength & 0xff;
  let checkByte = row.reduce((sum, byte) => sum + byte, 0);
  if (checkByte > 256) checkByte = (0x100 - (checkByte & 0xff)) & 0xff;
  row.push(checkByte & 0xff);
  return Uint8Array.from(row);
}

export function hasBlackPixels(row) {
  return row.some(value => value === 1);
}

export function validateRaster(raster) {
  if (!raster || !Number.isInteger(raster.width) || !Number.isInteger(raster.height)) throw new Error("Invalid raster data.");
  if (raster.width < 8 || raster.height < 1) throw new Error("Artwork must be at least 8 pixels wide and 1 pixel high.");
  if (raster.width > MAX_WIDTH || raster.height > MAX_HEIGHT) {
    throw new Error(`Artwork exceeds the documented K3 area (${MAX_WIDTH} × ${MAX_HEIGHT} px). Resize it first.`);
  }
  if (raster.rows.length !== raster.height) throw new Error("Raster row count does not match its height.");
  return raster;
}
