import test from "node:test";
import assert from "node:assert/strict";
import { buildK3RowPacket, packK3Row, packLegacyRow, buildLegacyRowPacket } from "../js/raster.js";
import { buildLegacyHeader, LegacyProtocol } from "../js/protocols/legacy.js";
import { K3Protocol } from "../js/protocols/k3.js";

test("K3 row packs first pixel into most-significant bit", () => {
  assert.deepEqual([...packK3Row([1,0,0,0,0,0,0,0])], [0x80]);
  assert.deepEqual([...packK3Row([0,0,0,0,0,0,0,1])], [0x01]);
});

test("K3 packet has 9-byte header plus raster bytes", () => {
  const packet = buildK3RowPacket([1,0,1,0,0,0,0,1], 2, 10, 1000);
  assert.deepEqual([...packet], [0x09,0x00,0x0a,0x00,0x0a,0x03,0xe8,0x00,0x02,0xa1]);
});

test("legacy row uses inverse pixel polarity", () => {
  assert.deepEqual([...packLegacyRow([1,0,0,0,0,0,0,0])], [0x7f]);
  assert.deepEqual([...packLegacyRow([0,0,0,0,0,0,0,0])], [0xff]);
});

test("legacy row adds length and checksum byte", () => {
  const packet = buildLegacyRowPacket([1,0,0,0,0,0,0,0]);
  assert.equal(packet[0], 0x22);
  assert.equal(packet[1], 0x00);
  assert.equal(packet[2], 0x05); // 3-byte prefix + 1 data + 1 checksum
  assert.equal(packet.length, 5);
  assert.equal(packet[4], (packet[0] + packet[1] + packet[2] + packet[3]) & 0xff);
});

test("legacy header has width, height, power and depth in documented positions", () => {
  assert.deepEqual([...buildLegacyHeader(500, 250, 10, 100)], [
    0x23,0x00,0x0f,0x00,0x00,0x00,0x00,0x01,0xf4,0x00,0xfa,0x03,0xe8,0x00,0x0a
  ]);
});

test("K3 connect uses the known-good eight-byte sequence", async () => {
  let actual;
  const fake = { command: async bytes => { actual = bytes; } };
  await K3Protocol.connect(fake);
  assert.deepEqual(actual, [0x0a,0x00,0x04,0x00,0xff,0x00,0x04,0x00]);
});

test("both protocols send the fan on and off commands", async () => {
  for (const protocol of [K3Protocol, LegacyProtocol]) {
    const calls = [];
    const fake = { command: async (...args) => calls.push(args) };
    await protocol.setFan(fake, true);
    await protocol.setFan(fake, false);
    assert.deepEqual(calls.map(([bytes, ack]) => [bytes, ack]), [
      [[0x04,0x00,0x04,0x00], [0x09]],
      [[0x05,0x00,0x04,0x00], [0x09]]
    ]);
  }
});
