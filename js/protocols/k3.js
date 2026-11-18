import { buildK3RowPacket, hasBlackPixels, validateRaster } from "../raster.js";

const ACK = [0x09];
const command4 = opcode => [opcode, 0x00, 0x04, 0x00];

export const K3Protocol = {
  id: "k3",
  name: "K3 / K5 raster protocol",
  async connect(transport) {
    // K3 protocol: a four-byte connect command, acknowledged with byte 0x09.
    await transport.command([0x0a, 0x00, 0x04, 0x00, 0xff, 0x00, 0x04, 0x00], ACK, 5000, "known-good K3/K5 connect sequence");
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
    if (!raster.rows.some(row => row.some(Boolean))) throw new Error("Artwork contains no dark pixels; nothing to engrave.");
    // These are documented setup commands. No home command is ever sent.
    await transport.command(command4(0x1c), ACK, 5000, "disable discrete mode");
    await transport.command(command4(0x06), ACK, 5000, "controller reset");
    await this.setFan(transport, settings.fan);
    await new Promise(resolve => setTimeout(resolve, 500));

    // Opcode 20 starts raster mode at the current head position (zero offset).
    await transport.command([0x14, 0x00, 0x07, 0x00, 0x00, 0x00, 0x00], ACK, 5000, "start raster at current position");
    await new Promise(resolve => setTimeout(resolve, 500));

    let sent = 0;
    let skipped = 0;
    for (let y = 0; y < raster.height; y++) {
      if (settings.cancelled?.()) throw new Error("Job cancelled in browser. The machine may need to be stopped with its physical power switch.");
      const pixels = raster.rows[y];
      if (!hasBlackPixels(pixels)) {
        skipped++;
        onProgress(y + 1, raster.height, sent, skipped);
        continue;
      }
      const packet = buildK3RowPacket(pixels, y, settings.depth, 1000);
      await transport.command(packet, ACK, 5000, `raster line ${y + 1}/${raster.height}`);
      sent++;
      onProgress(y + 1, raster.height, sent, skipped);
      // The protocol author reports a 100 ms pause between acknowledged rows.
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return { sent, skipped };
  }
};
