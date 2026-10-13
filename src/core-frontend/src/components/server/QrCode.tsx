import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/** a QR code as inline SVG (dark modules on white, always scannable regardless of the theme) */
export default function QrCode({ text, label }: { text: string; label: string }) {
  const svg = useMemo(() => {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      const n = qr.getModuleCount();
      let d = '';
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (!qr.isDark(r, c)) continue;
          let len = 1;
          while (c + len < n && qr.isDark(r, c + len)) len++;
          d += `M${c} ${r}h${len}v1h-${len}z`;
          c += len - 1;
        }
      }
      return { n, d };
    } catch {
      return null;
    }
  }, [text]);
  if (!svg) return <p className="text-sm font-semibold text-mute">Слишком длинное значение для QR-кода.</p>;
  return (
    <div className="cn-qr">
      <svg viewBox={`0 0 ${svg.n} ${svg.n}`} role="img" aria-label={label} shapeRendering="crispEdges">
        <path d={svg.d} fill="#111" />
      </svg>
    </div>
  );
}
