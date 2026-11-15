/**
 * Minimal TrueType/OpenType table reader.
 *
 * We only need a handful of values to make the browser preview and the
 * libass (FFmpeg) render agree on font size and family name:
 *  - head.unitsPerEm
 *  - OS/2.usWinAscent / usWinDescent (libass sizes fonts like GDI does)
 *  - name table: legacy family name (nameID 1) and full name (nameID 4)
 */
export interface FontFileInfo {
  family: string;
  fullName: string;
  unitsPerEm: number;
  winAscent: number;
  winDescent: number;
  /** OS/2 fsSelection flags: the file is the bold / italic face of its family. */
  bold: boolean;
  italic: boolean;
}

function decodeUtf16BE(buf: Buffer, start: number, length: number): string {
  let out = '';
  for (let i = 0; i + 1 < length; i += 2) {
    out += String.fromCharCode(buf.readUInt16BE(start + i));
  }
  return out;
}

export function readFontInfo(buf: Buffer): FontFileInfo {
  const numTables = buf.readUInt16BE(4);
  const tables = new Map<string, number>();
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    tables.set(buf.toString('latin1', rec, rec + 4), buf.readUInt32BE(rec + 8));
  }
  const head = tables.get('head');
  const os2 = tables.get('OS/2');
  const name = tables.get('name');
  if (head === undefined || os2 === undefined || name === undefined) {
    throw new Error('Fuente no válida: faltan tablas head/OS2/name');
  }

  const names = new Map<number, string>();
  const count = name !== undefined ? buf.readUInt16BE(name + 2) : 0;
  const strings = name + buf.readUInt16BE(name + 4);
  for (let i = 0; i < count; i++) {
    const r = name + 6 + i * 12;
    const platform = buf.readUInt16BE(r);
    const language = buf.readUInt16BE(r + 4);
    const nameId = buf.readUInt16BE(r + 6);
    const length = buf.readUInt16BE(r + 8);
    const offset = buf.readUInt16BE(r + 10);
    // Prefer Windows / Unicode BMP / en-US records.
    if (platform === 3 && (language === 0x409 || !names.has(nameId))) {
      names.set(nameId, decodeUtf16BE(buf, strings + offset, length));
    }
  }

  return {
    family: names.get(1) ?? '',
    fullName: names.get(4) ?? names.get(1) ?? '',
    unitsPerEm: buf.readUInt16BE(head + 18),
    winAscent: buf.readUInt16BE(os2 + 74),
    winDescent: buf.readUInt16BE(os2 + 76),
    bold: (buf.readUInt16BE(os2 + 62) & 0x20) !== 0,
    italic: (buf.readUInt16BE(os2 + 62) & 0x01) !== 0,
  };
}
