// ── MINIMAL ZIP WRITER (STORE — no compression) ─────────────────────────────
// PNGs are already compressed, so a "stored" (uncompressed) entry is the
// right trade-off here: no DEFLATE implementation needed, and any standard
// zip tool can still open the result.

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date) {
  const time = ((date.getHours() & 0x1F) << 11) | ((date.getMinutes() & 0x3F) << 5) | ((date.getSeconds() >> 1) & 0x1F);
  const day  = (((date.getFullYear() - 1980) & 0x7F) << 9) | (((date.getMonth() + 1) & 0xF) << 5) | (date.getDate() & 0x1F);
  return { time, day };
}

function u16(n) { return [n & 0xFF, (n >> 8) & 0xFF]; }
function u32(n) { return [n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >>> 24) & 0xFF]; }

// files: [{ name: string, data: Uint8Array }] → Blob (application/zip)
export function createZipBlob(files, date = new Date()) {
  const encoder = new TextEncoder();
  const { time, day } = dosDateTime(date);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const size = data.length;

    const localHeader = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0),
      ...u16(time), ...u16(day),
      ...u32(crc), ...u32(size), ...u32(size),
      ...u16(nameBytes.length), ...u16(0),
    ]);
    localParts.push(localHeader, nameBytes, data);

    const centralHeader = new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0),
      ...u16(time), ...u16(day),
      ...u32(crc), ...u32(size), ...u32(size),
      ...u16(nameBytes.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0),
      ...u32(offset),
    ]);
    centralParts.push(centralHeader, nameBytes);

    offset += localHeader.length + nameBytes.length + data.length;
  }

  const centralStart = offset;
  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);

  const endRecord = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length),
    ...u32(centralSize), ...u32(centralStart),
    ...u16(0),
  ]);

  return new Blob([...localParts, ...centralParts, endRecord], { type: 'application/zip' });
}
