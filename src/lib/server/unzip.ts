/**
 * Minimal ZIP extractor (stored and deflate entries), enough for the
 * whisper.cpp Windows release. Avoids depending on tools that may be
 * missing from the user's system.
 */
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export async function extractZip(file: string, dest: string): Promise<string[]> {
  const buf = await readFile(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('El archivo descargado no es un ZIP válido');
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const root = path.resolve(dest);
  const written: string[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(ptr) !== CENTRAL) throw new Error('ZIP dañado');
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen).replace(/\\/g, '/');
    ptr += 46 + nameLen + extraLen + commentLen;

    const target = path.resolve(root, name);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`Ruta no permitida en el ZIP: ${name}`);
    if (name.endsWith('/')) {
      await mkdir(target, { recursive: true });
      continue;
    }
    if (buf.readUInt32LE(localOffset) !== LOCAL) throw new Error('ZIP dañado');
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`Compresión ZIP no soportada (${method})`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
    written.push(target);
  }
  return written;
}
