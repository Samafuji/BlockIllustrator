import { Point } from '../model/types';

/** Imperative hooks the Canvas registers so other panels (toolbar) can drive it. */
export interface CanvasApi {
  fit: () => void;
  zoomBy: (factor: number) => void;
  resetZoom: () => void;
  viewportCenterWorld: () => Point;
  focus: () => void;
}

export const canvasApi: { current: CanvasApi | null } = { current: null };
