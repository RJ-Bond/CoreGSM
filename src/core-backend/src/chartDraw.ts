/** One way to draw the online chart: the card of a server and the picture under its Discord message share it. */
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ChartStep {
  players: number;
  /** the server did not answer during this step */
  down: boolean;
  /** no poll fell into this step */
  empty: boolean;
}

export interface ChartColors {
  accent: string;
  bad: string;
  warn: string;
  ink: string;
}

const alphaOf = (hex: string, a: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/** the busiest value on the chart (never below 1) so the line always has a scale */
export const chartTop = (steps: ChartStep[], ...extra: (number | null | undefined)[]): number => Math.max(1, ...steps.map((b) => b.players), ...extra.map((v) => v ?? 0));

/**
 * Outages as red bands, the record as a dashed line, the players as a smooth line over a soft area, and a ring at «now».
 * `top` is the value at the upper edge of the box.
 */
export function drawOnlineChart(ctx: any, box: { x: number; y: number; w: number; h: number }, steps: ChartStep[], top: number, colors: ChartColors, record?: number | null): void {
  const { x: cx, y: cy, w: cw, h: ch } = box;
  const known = steps.filter((b) => !b.empty);
  const xAt = (i: number) => cx + (i / (steps.length - 1)) * cw;
  const yAt = (v: number) => cy + ch - (v / top) * ch;
  ctx.fillStyle = alphaOf(colors.bad, 0.2);
  steps.forEach((b, i) => { if (!b.empty && b.down) ctx.fillRect(xAt(i) - cw / steps.length / 2, cy, cw / steps.length + 0.5, ch); });
  if (record) {
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = alphaOf(colors.warn, 0.55);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, yAt(record));
    ctx.lineTo(cx + cw, yAt(record));
    ctx.stroke();
    ctx.restore();
  }
  if (known.length < 2) return;
  const pts = steps.map((b, i) => [xAt(i), yAt(b.players)] as [number, number]);
  const line = () => {
    ctx.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1]!, [x1, y1] = pts[i]!;
      ctx.bezierCurveTo((x0 + x1) / 2, y0, (x0 + x1) / 2, y1, x1, y1);
    }
  };
  const area = ctx.createLinearGradient(0, cy, 0, cy + ch);
  area.addColorStop(0, alphaOf(colors.accent, 0.42));
  area.addColorStop(1, alphaOf(colors.accent, 0));
  ctx.beginPath();
  line();
  ctx.lineTo(cx + cw, cy + ch);
  ctx.lineTo(cx, cy + ch);
  ctx.closePath();
  ctx.fillStyle = area;
  ctx.fill();
  ctx.beginPath();
  line();
  ctx.save();
  ctx.shadowColor = alphaOf(colors.accent, 0.7);
  ctx.shadowBlur = 10;
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
  const [nx, ny] = pts[pts.length - 1]!;
  ctx.fillStyle = colors.ink;
  ctx.beginPath();
  ctx.arc(nx, ny, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 3;
  ctx.stroke();
}
