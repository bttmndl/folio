import type { Pt } from "./homography";

/** Map a click on the stage (visual pixels) into raw video-normalized coordinates. */
export function clientToVideoNorm(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  videoWidth: number,
  videoHeight: number,
  mirror: boolean,
): Pt | null {
  if (videoWidth < 2 || videoHeight < 2 || rect.width < 2 || rect.height < 2) return null;
  let localX = clientX - rect.left;
  const localY = clientY - rect.top;
  if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) return null;
  if (mirror) localX = rect.width - localX;

  const elAspect = rect.width / rect.height;
  const vidAspect = videoWidth / videoHeight;
  let renderW: number;
  let renderH: number;
  let offX: number;
  let offY: number;
  if (vidAspect > elAspect) {
    renderH = rect.height;
    renderW = rect.height * vidAspect;
    offX = (renderW - rect.width) / 2;
    offY = 0;
  } else {
    renderW = rect.width;
    renderH = rect.width / vidAspect;
    offX = 0;
    offY = (renderH - rect.height) / 2;
  }
  return { x: (localX + offX) / renderW, y: (localY + offY) / renderH };
}
