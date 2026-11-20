export const FRAME_MAX_STEPS = 1575;

export function buildFramePacket(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
      width < 1 || height < 1 || width > FRAME_MAX_STEPS || height > FRAME_MAX_STEPS) {
    throw new Error(`Frame dimensions must be between 1 and ${FRAME_MAX_STEPS} steps.`);
  }
  return Uint8Array.from([
    0x20, 0x00, 0x0b,
    (width >> 8) & 0xff, width & 0xff,
    (height >> 8) & 0xff, height & 0xff,
    0x00, 0x00, 0x00, 0x00
  ]);
}

export const FRAME_STOP_COMMAND = Uint8Array.from([0x21, 0x00, 0x04, 0x00]);
