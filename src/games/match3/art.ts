/**
 * Procedural art for the Match-3 board.
 *
 * There are no image files anywhere in this project. Every gem, spark and glow is drawn
 * with vector primitives at boot and baked into a GPU texture via `generateTexture()`.
 * Reasons this is the right call here, not just a flex:
 *
 *  - Nothing to download, nothing to 404, nothing to license.
 *  - The palette is tuned to the arcade's OLED/neon theme in one place.
 *  - Every gem gets a DISTINCT SHAPE as well as a distinct colour, so the board is
 *    readable for colour-blind players — a genuine accessibility issue in this genre,
 *    where most implementations rely on hue alone.
 *
 * IMPORTANT: this module must never import 'phaser' at runtime — only `import type`.
 * A runtime import would drag Phaser into the server bundle and break SSR.
 */

import type Phaser from 'phaser';

/** Neon palette, one entry per gem kind. Must be GEM_KINDS long. */
export const GEM_COLORS = [
  0x22d3ee, // 0 cyan
  0xf472b6, // 1 pink
  0xfbbf24, // 2 amber
  0x4ade80, // 3 green
  0xa78bfa, // 4 violet
  0xfb7185, // 5 rose
] as const;

/** Texture keys, indexed by gem kind. */
export const gemTextureKey = (kind: number) => `gem-${kind}`;
/** Spark texture keys, indexed by gem kind. */
export const sparkTextureKey = (kind: number) => `spark-${kind}`;
/** Key for the selection ring. */
export const RING_TEXTURE = 'sel-ring';

/**
 * Draws one gem shape into a Graphics object.
 *
 * Each kind is a different silhouette. All are drawn inside a `size` box centred on
 * (size/2, size/2), with a dark fill and a bright rim so they read as lit glass against
 * pure black rather than as flat blobs.
 */
function drawGemShape(g: Phaser.GameObjects.Graphics, kind: number, size: number): void {
  const color = GEM_COLORS[kind % GEM_COLORS.length];
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.34;

  // Outer glow: a few translucent passes, largest first. Cheap fake bloom that survives
  // being baked into a texture (a real bloom pipeline would not).
  for (let i = 3; i >= 1; i--) {
    g.fillStyle(color, 0.06 * i);
    g.fillCircle(cx, cy, r + i * 5);
  }

  // Dark body so the rim reads as a highlight, keeping the centre near-black for OLED.
  g.fillStyle(0x000000, 0.85);
  g.fillCircle(cx, cy, r + 2);

  g.lineStyle(3, color, 1);
  g.fillStyle(color, 0.22);

  switch (kind % 6) {
    case 0: {
      // Core: concentric circles.
      g.strokeCircle(cx, cy, r);
      g.fillCircle(cx, cy, r * 0.55);
      g.lineStyle(1.5, color, 0.7);
      g.strokeCircle(cx, cy, r * 0.72);
      break;
    }
    case 1: {
      // Diamond.
      const pts = [cx, cy - r, cx + r, cy, cx, cy + r, cx - r, cy];
      g.beginPath();
      g.moveTo(pts[0], pts[1]);
      g.lineTo(pts[2], pts[3]);
      g.lineTo(pts[4], pts[5]);
      g.lineTo(pts[6], pts[7]);
      g.closePath();
      g.fillPath();
      g.strokePath();
      break;
    }
    case 2: {
      // Hexagon.
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.fillPath();
      g.strokePath();
      break;
    }
    case 3: {
      // Triangle, nudged down so its visual centre matches the others.
      const h = r * 1.05;
      g.beginPath();
      g.moveTo(cx, cy - h);
      g.lineTo(cx + r, cy + h * 0.7);
      g.lineTo(cx - r, cy + h * 0.7);
      g.closePath();
      g.fillPath();
      g.strokePath();
      break;
    }
    case 4: {
      // Rounded square.
      const s = r * 1.6;
      g.fillRoundedRect(cx - s / 2, cy - s / 2, s, s, s * 0.24);
      g.strokeRoundedRect(cx - s / 2, cy - s / 2, s, s, s * 0.24);
      break;
    }
    default: {
      // Four-point star.
      const outer = r * 1.12;
      const inner = r * 0.42;
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI / 4) * i - Math.PI / 2;
        const rad = i % 2 === 0 ? outer : inner;
        const x = cx + Math.cos(a) * rad;
        const y = cy + Math.sin(a) * rad;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.fillPath();
      g.strokePath();
      break;
    }
  }

  // Specular dot, upper-left. Sells "polished glass" in one primitive.
  g.fillStyle(0xffffff, 0.5);
  g.fillCircle(cx - r * 0.34, cy - r * 0.36, size * 0.035);
}

/**
 * Bakes every texture the board needs. Call once from `create()`.
 *
 * Baking matters: a Graphics object re-tessellates its geometry every frame, so 64 live
 * Graphics gems would burn real CPU. Baked textures let us render plain Images, which
 * the GPU batches into essentially one draw call.
 */
export function buildMatch3Textures(scene: Phaser.Scene, cellSize: number): void {
  const gemSize = Math.round(cellSize);

  for (let kind = 0; kind < GEM_COLORS.length; kind++) {
    const key = gemTextureKey(kind);
    if (!scene.textures.exists(key)) {
      const g = scene.add.graphics();
      drawGemShape(g, kind, gemSize);
      g.generateTexture(key, gemSize, gemSize);
      g.destroy();
    }

    // Spark: a small radial dot in the gem's colour, for the destruction burst. One per
    // colour so the emitter needs no runtime tinting.
    const sparkKey = sparkTextureKey(kind);
    if (!scene.textures.exists(sparkKey)) {
      const s = scene.add.graphics();
      const color = GEM_COLORS[kind];
      s.fillStyle(color, 0.28);
      s.fillCircle(8, 8, 8);
      s.fillStyle(color, 0.75);
      s.fillCircle(8, 8, 4.5);
      s.fillStyle(0xffffff, 1);
      s.fillCircle(8, 8, 2);
      s.generateTexture(sparkKey, 16, 16);
      s.destroy();
    }
  }

  // Selection ring: a dashed HUD-style bracket that spins around the picked gem.
  if (!scene.textures.exists(RING_TEXTURE)) {
    const size = gemSize;
    const g = scene.add.graphics();
    const cx = size / 2;
    const cy = size / 2;
    const r = size * 0.44;

    g.lineStyle(2.5, 0xffffff, 0.9);
    // Four arcs with gaps — reads as a targeting reticle rather than a plain circle.
    for (let i = 0; i < 4; i++) {
      const start = (Math.PI / 2) * i + 0.28;
      const end = (Math.PI / 2) * (i + 1) - 0.28;
      g.beginPath();
      g.arc(cx, cy, r, start, end, false);
      g.strokePath();
    }
    g.generateTexture(RING_TEXTURE, size, size);
    g.destroy();
  }
}
