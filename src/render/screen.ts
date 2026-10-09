// The original picture, as decoded in docs/re/rendering.md: 320x200, a 60 degree view across its width, and a
// camera that looks level with the horizon sitting below the middle of the screen.
export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 200;
export const HORIZON_ROW = 120.75;
/** distance, in screen pixels, at which one world pixel covers one screen pixel */
export const FOCAL_LENGTH = SCREEN_WIDTH / 2 / Math.tan(Math.PI / 6);

/** World size of one screen pixel on a sheet this far in front of the camera. */
export function pixelSizeAt(distance: number): number {
  return distance / FOCAL_LENGTH;
}

/** How far above the camera's line of sight a screen row sits, on a sheet this far away. */
export function heightOfRow(row: number, distance: number): number {
  return (HORIZON_ROW - row) * pixelSizeAt(distance);
}

// On a 4:3 CRT the 320x200 picture had pixels 1.2 times taller than wide; set to 1 for square pixels.
export const PIXEL_ASPECT = 1.2;

/**
 * Width, in original pixels, of a view filling a canvas of this shape, with pixels PIXEL_ASPECT times taller than wide. The port keeps the original's height and
 * lens and just sees more at the sides, never less than the original 320.
 */
export function viewWidthFor(canvasWidth: number, canvasHeight: number): number {
  return Math.max(SCREEN_WIDTH, Math.round((SCREEN_HEIGHT * PIXEL_ASPECT * canvasWidth) / Math.max(1, canvasHeight)));
}
