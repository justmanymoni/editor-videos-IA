import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { extractZip } from '@/lib/server/unzip';

/** Builds a ZIP in memory (deflate entries) for the extractor test. */
function makeZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(content));
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

describe('zip extractor', () => {
  it('extracts nested files and refuses paths outside the target', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'vc-zip-'));
    try {
      writeFileSync(path.join(dir, 'a.zip'), makeZip({ 'Release/whisper-cli.exe': 'binary', 'Release/whisper.dll': 'dll' }));
      await extractZip(path.join(dir, 'a.zip'), path.join(dir, 'out'));
      expect(readFileSync(path.join(dir, 'out/Release/whisper-cli.exe'), 'utf8')).toBe('binary');
      writeFileSync(path.join(dir, 'evil.zip'), makeZip({ '../evil.txt': 'x' }));
      await expect(extractZip(path.join(dir, 'evil.zip'), path.join(dir, 'out2'))).rejects.toThrow(/no permitida/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(process.platform !== 'linux')('local transcription installer', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vc-setup-'));
  const served = path.join(dir, 'served');
  let server: http.Server;
  const env = { ...process.env };

  beforeAll(async () => {
    // A fake "release": only v1.9.1 exists, so the installer must fall back from v1.9.2.
    const pkg = path.join(dir, 'pkg', 'whisper-bin-ubuntu-x64');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(path.join(pkg, 'whisper-cli'), '#!/bin/sh\necho "usage: whisper-cli"\n');
    mkdirSync(path.join(served, 'v1.9.1'), { recursive: true });
    execFileSync('tar', [
      '-czf',
      path.join(served, 'v1.9.1', 'whisper-bin-ubuntu-x64.tar.gz'),
      '-C',
      path.join(dir, 'pkg'),
      'whisper-bin-ubuntu-x64',
    ]);
    const model = Buffer.alloc(4096);
    model.writeUInt32LE(0x67676d6c, 0);
    writeFileSync(path.join(served, 'ggml-base.bin'), model);
    writeFileSync(path.join(served, 'ggml-small.bin'), '<html>not a model</html>');
    server = http.createServer((req, res) => {
      const file = path.join(served, decodeURIComponent(req.url!.split('?')[0]));
      if (!file.startsWith(served) || !existsSync(file)) return void res.writeHead(404).end('Not Found');
      const body = readFileSync(file);
      res.writeHead(200, { 'content-length': body.length }).end(body);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.STORAGE_DIR = path.join(dir, 'storage');
    process.env.WHISPER_CPP_RELEASE_BASE = base;
    process.env.WHISPER_MODEL_BASE = base;
    process.env.PATH = '/usr/bin:/bin';
    delete process.env.WHISPER_CPP_BIN;
    delete process.env.WHISPER_CPP_MODEL;
    process.env.OPENAI_API_KEY = 'sk-test';
    delete process.env.TRANSCRIBER;
  });

  afterAll(() => {
    server?.close();
    Object.assign(process.env, env);
    for (const k of ['STORAGE_DIR', 'WHISPER_CPP_RELEASE_BASE', 'WHISPER_MODEL_BASE', 'OPENAI_API_KEY']) if (!(k in env)) delete process.env[k];
    rmSync(dir, { recursive: true, force: true });
  });

  it('installs the engine and a model, and then prefers local transcription over OpenAI', async () => {
    const { selectTranscriber } = await import('@/lib/server/config');
    const { installEngine, installModel } = await import('@/lib/server/whisper-setup');
    expect(selectTranscriber().kind).toBe('openai');
    const steps: number[] = [];
    const bin = await installEngine((p) => steps.push(p));
    expect(bin.endsWith(path.join('whisper-bin-ubuntu-x64', 'whisper-cli'))).toBe(true);
    expect(steps.at(-1)).toBe(1);
    await expect(installModel('small', () => undefined)).rejects.toThrow(/no es un modelo/);
    await installModel('base', () => undefined);
    const t = selectTranscriber();
    expect(t.kind).toBe('whispercpp');
    expect(t.detail).toContain('ggml-base.bin');
  });
});
