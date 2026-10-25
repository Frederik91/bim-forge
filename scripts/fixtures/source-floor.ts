import sharp from 'sharp';

/** Synthetic drawing only. No customer plans or credentials belong in test evidence. */
export async function sourceFloorImage(): Promise<Buffer> {
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="760" viewBox="0 0 1000 760">
    <rect width="1000" height="760" fill="white"/>
    <g font-family="DejaVu Sans, sans-serif" fill="#14272b" text-anchor="middle">
    <text x="500" y="40" font-size="28">Reference floor plan - one level</text>
    <text x="500" y="90" font-size="24">6 m overall (wall centre lines)</text>
    <g stroke="#14272b" stroke-width="8" fill="none">
    <path d="M140 140 H860 V620 H320 M212 620 H140 V140 M500 140 V410 M500 518 V620"/>
    </g>
    <g stroke="#3b7979" stroke-width="3" fill="none"><path d="M212 620 V512 A108 108 0 0 1 320 620 M500 410 H608 A108 108 0 0 1 500 518"/></g>
    <text x="320" y="300" font-size="32">Living room</text><text x="320" y="345" font-size="26">3 m x 4 m</text>
    <text x="680" y="300" font-size="32">Office</text><text x="680" y="345" font-size="26">3 m x 4 m</text>
    <text x="66" y="390" font-size="24" transform="rotate(-90 66 390)">4 m overall</text>
    <text x="270" y="680" font-size="21">Entry 0.9 m</text><text x="670" y="490" font-size="20">Internal door 0.9 m</text>
    <text x="500" y="725" font-size="18">North is up. Walls 0.15 m thick, 2.7 m high. No windows or furnishings.</text>
    </g></svg>`)).png().toBuffer();
}

export function sourceFloorPdf(): Buffer {
  const content = `0.08 0.15 0.17 RG 4 w
80 120 m 140 120 l S 194 120 m 440 120 l 440 360 l 80 360 l 80 120 l S
260 120 m 260 170 l S 260 224 m 260 360 l S
0.2 0.5 0.5 RG 1 w 140 120 m 140 174 l 194 120 l S 260 170 m 314 170 l 260 224 l S
0.08 0.15 0.17 rg
BT /F1 20 Tf 125 430 Td (Reference floor plan - one level) Tj ET
BT /F1 16 Tf 180 390 Td (6 m overall - wall centre lines) Tj ET
BT /F1 18 Tf 115 285 Td (Living room) Tj ET BT /F1 15 Tf 130 255 Td (3 m x 4 m) Tj ET
BT /F1 18 Tf 315 285 Td (Office) Tj ET BT /F1 15 Tf 310 255 Td (3 m x 4 m) Tj ET
BT /F1 13 Tf 20 235 Td (4 m) Tj ET
BT /F1 12 Tf 120 90 Td (Entry 0.9 m) Tj ET BT /F1 12 Tf 320 195 Td (Door 0.9 m) Tj ET
BT /F1 11 Tf 60 60 Td (North up. Walls 0.15 m thick, 2.7 m high. No windows or furnishings.) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 520 480] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let output = '%PDF-1.4\n'; const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const start = Buffer.byteLength(output);
  output += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(output);
}
