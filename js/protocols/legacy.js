import { buildLegacyRowPacket, validateRaster } from "../raster.js";

const ACK = [0x09];
const HEADER_ACK = [0xff, 0xff, 0xff, 0xfe];
const command4 = opcode => [opcode, 0x00, 0x04, 0x00];

export function buildLegacyHeader(width, height, depth, powerPercent) {
  const power = Math.round(Math.max(0, Math.min(100, powerPercent)) * 10);
  const safeDepth = Math.max(1, Math.min(100, depth));
  return Uint8Array.from([
    0x23, 0x00, 0x0f, // command 0x23, 15-byte header
    0x00, 0x00, 0x00, 0x00,
    (width >> 8) & 0xff, width & 0xff,
    (height >> 8) & 0xff, height & 0xff,
    (power >> 8) & 0xff, power & 0xff,
    0x00, safeDepth & 0xff
  ]);
}

export const LegacyProtocol = {
  id: "legacy",
  name: "KKengraver legacy protocol",
  async connect(transport) {
    // Original kkengraver CONNECT sequence; firmware-version bytes are not required.
    await transport.command([0x0a, 0x00, 0x04, 0x00, 0xff, 0x00, 0x04, 0x00], ACK, 5000, "legacy connect");
  },
  async setFan(transport, enabled) {
    await transport.command(command4(enabled ? 0x04 : 0x05), ACK, 5000, enabled ? "fan on" : "fan off");
  },
  async jog(transport, dx, dy) {
    await transport.command([
      0x01, 0x00, 0x07,
      (dx >> 8) & 0xff, dx & 0xff,
      (dy >> 8) & 0xff, dy & 0xff
    ], ACK, 5000, `move ${dx},${dy}`);
  },
  async engrave(transport, raster, settings, onProgress = () => {}) {
    validateRaster(raster);
    await this.setFan(transport, settings.fan);
    if (!raster.rows.some(row => row.some(Boolean))) throw new Error("Artwork contains no dark pixels; nothing to engrave.");
    const header = buildLegacyHeader(raster.width, raster.height, settings.depth, settings.power);
    await transport.command(header, HEADER_ACK, 10000, "legacy raster header");

    let sent = 0;
    let skipped = 0;
    for (let y = 0; y < raster.height; y++) {
      if (settings.cancelled?.()) throw new Error("Job cancelled in browser. The machine may need to be stopped with its physical power switch.");
      const pixels = raster.rows[y];
      // Legacy rows have no explicit Y coordinate. Send every row, including
      // blank rows, to preserve the scanline sequence expected by the firmware.
      // Each row carries its own checksum. The original kkengraver send()
      // routine expects the normal one-byte ACK after every row.
      await transport.command(buildLegacyRowPacket(pixels), ACK, 5000, `legacy row ${y + 1}/${raster.height}`);
      sent++;
      onProgress(y + 1, raster.height, sent, skipped);
    }

    await transport.command(command4(0x0a), ACK, 7000, "legacy end header");
    await transport.write([...command4(0x24), ...command4(0x24)]);
    return { sent, skipped, completionConfirmed: false };
  }
};
