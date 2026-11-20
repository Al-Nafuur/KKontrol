import test from "node:test";
import assert from "node:assert/strict";
import { buildK3RowPacket, packK3Row, packLegacyRow, buildLegacyRowPacket } from "../js/raster.js";
import { buildLegacyHeader, LegacyProtocol } from "../js/protocols/legacy.js";
import { K3Protocol } from "../js/protocols/k3.js";
import { FRAME_MAX_STEPS, buildFramePacket } from "../js/protocols/frame.js";
import {
  DEFAULT_WORK_AREA, MAX_WORK_AREA_DIMENSION_MM, artworkFitsArea, clampArtworkPosition,
  uiPositionToMachineSteps, getJogDeltaToPosition,
  machineStepsToUiPosition, isMachinePositionWithinArea
} from "../js/position.js";

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

test("K3/K5 and legacy protocols use the controller alignment-frame commands", async () => {
  for (const protocol of [K3Protocol, LegacyProtocol]) {
    const calls = [];
    const fake = { command: async (...args) => calls.push(args) };
    await protocol.startFrame(fake, 250, 100);
    await protocol.stopFrame(fake);
    assert.deepEqual([...calls[0][0]], [0x20,0x00,0x0b,0x00,0xfa,0x00,0x64,0,0,0,0]);
    assert.deepEqual([...calls[1][0]], [0x21,0x00,0x04,0x00]);
    assert.deepEqual(calls.map(call => call[1]), [[0x09], [0x09]]);
  }
});

test("legacy frame dimensions are bounded by the supported step limit", () => {
  assert.equal(FRAME_MAX_STEPS, 1575);
  assert.throws(() => buildFramePacket(1576, 100), /between 1 and 1575 steps/);
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

test("work area defaults to the verified 80 by 80 mm K5 dimensions", () => {
  assert.deepEqual(DEFAULT_WORK_AREA, { width: 80, height: 80 });
  assert.equal(MAX_WORK_AREA_DIMENSION_MM, 80);
});

test("upper-left artwork coordinates map downward to positive machine Y", () => {
  const position = { x: 10, y: 20 };
  const machine = uiPositionToMachineSteps(position);
  const roundTrip = machineStepsToUiPosition(machine);
  assert.ok(Math.abs(roundTrip.x - position.x) < 0.03);
  assert.ok(Math.abs(roundTrip.y - position.y) < 0.03);
  assert.equal(machine.y > 0, true);
});

test("movement to artwork origin is relative to the tracked head position", () => {
  assert.deepEqual(getJogDeltaToPosition({ x: 100, y: 50 }, { x: 10, y: 20 }), { dx: 97, dy: 344 });
});

test("artwork placement is clamped within the work area", () => {
  const area = { width: 20, height: 15 };
  const artwork = { width: 8, height: 5 };
  assert.equal(artworkFitsArea(artwork, area), true);
  const position = clampArtworkPosition({ x: 30, y: 30 }, artwork, area);
  assert.ok(position.x <= 12 && position.x > 11.9);
  assert.ok(position.y <= 10 && position.y > 9.9);
  assert.equal(artworkFitsArea({ width: 21, height: 5 }, area), false);
});

test("tracked machine position must remain inside the work area", () => {
  const area = { width: 20, height: 15 };
  assert.equal(isMachinePositionWithinArea({ x: 393, y: 295 }, area), true);
  assert.equal(isMachinePositionWithinArea({ x: 394, y: 295 }, area), false);
  assert.equal(isMachinePositionWithinArea({ x: 393, y: 296 }, area), false);
});
