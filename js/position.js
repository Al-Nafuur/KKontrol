import { STEPS_PER_MM, mmToSteps } from "./raster.js";

export const MAX_WORK_AREA_MM = { width: 79.68, height: 75.696 };
export const DEFAULT_WORK_AREA = { ...MAX_WORK_AREA_MM };

export function artworkFitsArea(artwork, area) {
  return artwork.width <= area.width && artwork.height <= area.height;
}

export function clampArtworkPosition(position, artwork, area) {
  const maxXSteps = Math.max(0, Math.floor((area.width - artwork.width) * STEPS_PER_MM + 1e-8));
  const maxYSteps = Math.max(0, Math.floor((area.height - artwork.height) * STEPS_PER_MM + 1e-8));
  const xSteps = Math.min(maxXSteps, Math.max(0, Math.round(position.x * STEPS_PER_MM)));
  const ySteps = Math.min(maxYSteps, Math.max(0, Math.round(position.y * STEPS_PER_MM)));
  return { x: xSteps / STEPS_PER_MM, y: ySteps / STEPS_PER_MM };
}

export function uiPositionToMachineSteps(position) {
  return { x: mmToSteps(position.x), y: mmToSteps(position.y) };
}

export function getJogDeltaToPosition(currentPosition, targetPosition) {
  const target = uiPositionToMachineSteps(targetPosition);
  return { dx: target.x - currentPosition.x, dy: target.y - currentPosition.y };
}

export function machineStepsToUiPosition(position) {
  return { x: position.x / STEPS_PER_MM, y: position.y / STEPS_PER_MM };
}

export function isMachinePositionWithinArea(position, area) {
  const maxXSteps = Math.floor(area.width * STEPS_PER_MM + 1e-8);
  const maxYSteps = Math.floor(area.height * STEPS_PER_MM + 1e-8);
  return position.x >= 0 && position.x <= maxXSteps &&
    position.y >= 0 && position.y <= maxYSteps;
}
