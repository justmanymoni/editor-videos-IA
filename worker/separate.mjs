// Voice / music separation worker (runs in its own process so the app stays responsive).
// Usage: node worker/separate.mjs <model.onnx> <mix.f32> <voice.f32> <music.f32> [threads]
// Input and outputs are raw 32-bit float, stereo interleaved, 44.1 kHz.
// Prints "progress <0..1>" lines on stdout.
import { open, readFile } from 'node:fs/promises';
import ort from 'onnxruntime-node';
import { demix } from './dsp.mjs';

const [model, input, voiceOut, musicOut, threadsArg] = process.argv.slice(2);
if (!model || !input || !voiceOut || !musicOut) {
  console.error('Uso: node worker/separate.mjs <modelo.onnx> <mezcla.f32> <voz.f32> <musica.f32> [hilos]');
  process.exit(2);
}

const raw = await readFile(input);
const samples = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length - (raw.length % 8)));
const frames = samples.length / 2;
const left = new Float32Array(frames);
const right = new Float32Array(frames);
for (let i = 0; i < frames; i++) {
  left[i] = samples[2 * i];
  right[i] = samples[2 * i + 1];
}

const session = await ort.InferenceSession.create(model, {
  intraOpNumThreads: Number(threadsArg) || 4,
  interOpNumThreads: 1,
  graphOptimizationLevel: 'all',
});
const [inputName] = session.inputNames;
const [outputName] = session.outputNames;
const runModel = async (spec) => (await session.run({ [inputName]: new ort.Tensor('float32', spec, [1, 4, 3072, 256]) }))[outputName].data;

const { voiceL, voiceR } = await demix(left, right, runModel, (p) => process.stdout.write(`progress ${p.toFixed(4)}\n`));

// Music = mix − voice. Written in blocks to keep memory low.
const voiceFile = await open(voiceOut, 'w');
const musicFile = await open(musicOut, 'w');
const BLOCK = 1 << 16;
const vBuf = new Float32Array(BLOCK * 2);
const mBuf = new Float32Array(BLOCK * 2);
for (let start = 0; start < frames; start += BLOCK) {
  const count = Math.min(BLOCK, frames - start);
  for (let i = 0; i < count; i++) {
    const k = start + i;
    vBuf[2 * i] = voiceL[k];
    vBuf[2 * i + 1] = voiceR[k];
    mBuf[2 * i] = left[k] - voiceL[k];
    mBuf[2 * i + 1] = right[k] - voiceR[k];
  }
  await voiceFile.write(new Uint8Array(vBuf.buffer, 0, count * 8));
  await musicFile.write(new Uint8Array(mBuf.buffer, 0, count * 8));
}
await voiceFile.close();
await musicFile.close();
process.stdout.write('progress 1\n');
