import { hash2, valueNoise } from '../sim/noise';
import { Terrain } from '../sim/terrain';
import type { MapData } from '../sim/types';
import { TERRAIN_INK, TERRAIN_RGB, rgba } from './palette';

/** Pixels per map cell in the baked terrain bitmap. */
export const TERRAIN_PX = 12;

function terrainAtClamped(map: MapData, x: number, y: number): number {
  const cx = Math.min(map.width - 1, Math.max(0, Math.floor(x)));
  const cy = Math.min(map.height - 1, Math.max(0, Math.floor(y)));
  return map.terrain[cy * map.width + cx];
}

const weights = new Float64Array(5);

/**
 * Terrain with smooth boundaries: bilinearly blends the four surrounding cell
 * centres' terrain "indicators" and returns the dominant one. This turns the
 * grid's staircase edges into rounded contours without moving them by more
 * than half a cell.
 */
function smoothTerrainAt(map: MapData, x: number, y: number): number {
  const fx = x - 0.5;
  const fy = y - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  let tx = fx - x0;
  let ty = fy - y0;
  tx = tx * tx * (3 - 2 * tx);
  ty = ty * ty * (3 - 2 * ty);
  weights.fill(0);
  weights[terrainAtClamped(map, x0 + 0.5, y0 + 0.5)] += (1 - tx) * (1 - ty);
  weights[terrainAtClamped(map, x0 + 1.5, y0 + 0.5)] += tx * (1 - ty);
  weights[terrainAtClamped(map, x0 + 0.5, y0 + 1.5)] += (1 - tx) * ty;
  weights[terrainAtClamped(map, x0 + 1.5, y0 + 1.5)] += tx * ty;
  let best = 0;
  for (let t = 1; t < 5; t++) if (weights[t] > weights[best]) best = t;
  return best;
}

/**
 * Bakes the terrain into a bitmap once per match: flat "paper map" colours with
 * softly wobbled region edges, ink outlines, grain, and hand-drawn-ish glyphs
 * (trees, hill arcs, peaks, ripples). Rendering then draws this image scaled.
 */
export function bakeTerrain(map: MapData): HTMLCanvasElement {
  const S = TERRAIN_PX;
  const w = map.width * S;
  const h = map.height * S;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const data = img.data;
  const wobble = 0.28;

  // Sample the (wobbled) terrain once per pixel into a buffer so edge detection is cheap.
  const tbuf = new Uint8Array(w * h);
  for (let py = 0; py < h; py++) {
    const wy = (py + 0.5) / S;
    for (let px = 0; px < w; px++) {
      const wx = (px + 0.5) / S;
      const jx = (valueNoise(wx * 0.9, wy * 0.9, 11) - 0.5) * 2 * wobble;
      const jy = (valueNoise(wx * 0.9, wy * 0.9, 23) - 0.5) * 2 * wobble;
      tbuf[py * w + px] = smoothTerrainAt(map, wx + jx, wy + jy);
    }
  }
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = py * w + px;
      const t = tbuf[i];
      const base = TERRAIN_RGB[t];
      // Large-scale tint variation + fine paper grain.
      const wx = px / S;
      const wy = py / S;
      const tint = (valueNoise(wx * 0.12, wy * 0.12, 5) - 0.5) * 14;
      const grain = (hash2(px, py, 3) - 0.5) * 7;
      let r = base[0] + tint + grain;
      let g = base[1] + tint + grain;
      let b = base[2] + tint * 0.6 + grain;
      // Ink outline where the terrain changes within ~1.5 px.
      const edge =
        (px > 1 && tbuf[i - 2] !== t) ||
        (px < w - 2 && tbuf[i + 2] !== t) ||
        (py > 1 && tbuf[i - 2 * w] !== t) ||
        (py < h - 2 && tbuf[i + 2 * w] !== t);
      if (edge && t !== Terrain.Plains) {
        const ink = TERRAIN_INK[t];
        r = r * 0.45 + ink[0] * 0.55;
        g = g * 0.45 + ink[1] * 0.55;
        b = b * 0.45 + ink[2] * 0.55;
      }
      const o = i * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Glyphs, drawn in cell units.
  ctx.save();
  ctx.scale(S, S);
  const sampleAt = (x: number, y: number) => {
    const px = Math.min(w - 1, Math.max(0, Math.floor(x * S)));
    const py = Math.min(h - 1, Math.max(0, Math.floor(y * S)));
    return tbuf[py * w + px];
  };
  for (let cy = 0; cy < map.height; cy++) {
    for (let cx = 0; cx < map.width; cx++) {
      const t = map.terrain[cy * map.width + cx];
      const r1 = hash2(cx, cy, 101);
      const r2 = hash2(cx, cy, 202);
      const r3 = hash2(cx, cy, 303);
      if (t === Terrain.Forest) {
        for (let k = 0; k < 2; k++) {
          const x = cx + 0.2 + hash2(cx, cy, 400 + k) * 0.6;
          const y = cy + 0.2 + hash2(cx, cy, 500 + k) * 0.6;
          if (sampleAt(x, y) !== Terrain.Forest) continue;
          const rad = 0.2 + hash2(cx, cy, 600 + k) * 0.1;
          ctx.fillStyle = rgba(TERRAIN_INK[Terrain.Forest], 0.75);
          ctx.beginPath();
          ctx.arc(x, y, rad, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(214,232,190,0.55)';
          ctx.beginPath();
          ctx.arc(x - rad * 0.3, y - rad * 0.35, rad * 0.35, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (t === Terrain.Hills && r1 < 0.55) {
        const x = cx + 0.25 + r2 * 0.5;
        const y = cy + 0.4 + r3 * 0.35;
        if (sampleAt(x, y) !== Terrain.Hills) continue;
        ctx.strokeStyle = rgba(TERRAIN_INK[Terrain.Hills], 0.85);
        ctx.lineWidth = 0.09;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(x, y + 0.2, 0.34, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      } else if (t === Terrain.Mountains && r1 < 0.7) {
        const x = cx + 0.5 + (r2 - 0.5) * 0.4;
        const y = cy + 0.75 + (r3 - 0.5) * 0.3;
        const hw = 0.42 + r2 * 0.18;
        const ht = 0.7 + r3 * 0.35;
        ctx.fillStyle = 'rgba(206,199,188,0.95)';
        ctx.beginPath();
        ctx.moveTo(x - hw, y);
        ctx.lineTo(x, y - ht);
        ctx.lineTo(x, y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = rgba(TERRAIN_INK[Terrain.Mountains], 0.9);
        ctx.beginPath();
        ctx.moveTo(x, y - ht);
        ctx.lineTo(x + hw, y);
        ctx.lineTo(x, y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(70,64,58,0.8)';
        ctx.lineWidth = 0.06;
        ctx.beginPath();
        ctx.moveTo(x - hw, y);
        ctx.lineTo(x, y - ht);
        ctx.lineTo(x + hw, y);
        ctx.stroke();
      } else if (t === Terrain.Water && r1 < 0.22) {
        const x = cx + 0.2 + r2 * 0.4;
        const y = cy + 0.3 + r3 * 0.4;
        if (sampleAt(x, y) !== Terrain.Water) continue;
        ctx.strokeStyle = rgba(TERRAIN_INK[Terrain.Water], 0.7);
        ctx.lineWidth = 0.07;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + 0.15, y - 0.12, x + 0.3, y);
        ctx.quadraticCurveTo(x + 0.45, y + 0.12, x + 0.6, y);
        ctx.stroke();
      } else if (t === Terrain.Plains && r1 < 0.05) {
        const x = cx + r2;
        const y = cy + r3;
        ctx.strokeStyle = rgba(TERRAIN_INK[Terrain.Plains], 0.9);
        ctx.lineWidth = 0.06;
        ctx.beginPath();
        ctx.moveTo(x - 0.1, y);
        ctx.lineTo(x - 0.05, y - 0.18);
        ctx.moveTo(x + 0.05, y);
        ctx.lineTo(x + 0.1, y - 0.16);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
  return canvas;
}
