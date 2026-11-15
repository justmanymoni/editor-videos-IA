/**
 * The "Vídeo" tab: geometry shared by the preview and the export, the FFmpeg
 * filters it produces, and a real render checked pixel by pixel.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProjectDoc, type ProjectDoc } from '@/lib/shared/types';
import {
  alignPicture,
  cssFilter,
  improveFilters,
  isPlainPicture,
  pictureOf,
  pictureRect,
  placePicture,
  positionFromPx,
  positionPx,
  turnedSize,
} from '@/lib/shared/picture';
import { buildExportPlan, renderPlan, type PlanMedia } from '@/lib/server/export';

const media = new Map<string, PlanMedia>([
  ['v', { id: 'v', kind: 'video', sourcePath: '/v.mp4', hasAudio: true, width: 1080, height: 1920 }],
  ['wide', { id: 'wide', kind: 'video', sourcePath: '/wide.mp4', hasAudio: true, width: 1920, height: 1080 }],
  ['img', { id: 'img', kind: 'image', sourcePath: '/img.png', hasAudio: false, width: 400, height: 400 }],
]);

function project(patch: Partial<ProjectDoc>): ProjectDoc {
  const doc = createProjectDoc('p', 'Prueba');
  doc.subtitles.enabled = false;
  return { ...doc, clips: [{ id: 'c', mediaId: 'v', start: 0, end: 4, cuts: [] }], ...patch };
}

describe('picture settings', () => {
  it('fills in what is missing and keeps values in range', () => {
    const p = pictureOf({});
    expect(p).toMatchObject({ x: 0.5, y: 0.5, scale: 1, scaleY: 1, uniform: true, rotation: 0, opacity: 1, blend: 'normal', stabilize: 0 });
    expect(isPlainPicture(p)).toBe(true);
    expect(pictureOf({ scale: 0.4 }).scaleY).toBe(0.4);
    expect(pictureOf({ scale: 0.4, scaleY: 0.9 })).toMatchObject({ scaleY: 0.9, uniform: false });
    expect(pictureOf({ opacity: 3, scale: 99, stabilize: 7, blend: 'nope' as never })).toMatchObject({
      opacity: 1,
      scale: 8,
      stabilize: 3,
      blend: 'normal',
    });
    expect(isPlainPicture(pictureOf({ rotation: 1 }))).toBe(false);
    // Improvements alone do not move the picture.
    expect(isPlainPicture(pictureOf({ enhance: 0.5, stabilize: 2 }))).toBe(true);
  });

  it('places a picture covering the frame, or fitted inside it', () => {
    // A horizontal video covers the vertical frame by its height…
    expect(pictureRect(1920, 1080, pictureOf({}))).toEqual({ width: 1920 * (16 / 9), height: 1920, left: 540 - (1920 * (16 / 9)) / 2, top: 0 });
    // …and fits inside it by its width when the project uses the blurred background.
    const fitted = pictureRect(1920, 1080, pictureOf({}), true);
    expect(fitted.width).toBe(1080);
    expect(fitted.height).toBeCloseTo(607.5);
    expect(fitted.top).toBeCloseTo(656.25);
    expect(pictureRect(1080, 1920, pictureOf({ scale: 0.5, scaleY: 0.25, x: 0.25, y: 0.75 }))).toEqual({
      width: 540,
      height: 480,
      left: 0,
      top: 1200,
    });
  });

  it('shows the position as pixels from the centre, upwards positive', () => {
    expect(positionPx(pictureOf({ x: 0.75, y: 0.25 }))).toEqual({ x: 270, y: 480 });
    expect(positionFromPx({ x: 270 })).toEqual({ x: 0.75 });
    expect(positionFromPx({ y: 480 })).toEqual({ y: 0.25 });
  });

  it('aligns the turned picture with the edges of the frame', () => {
    const rect = { left: 0, top: 0, width: 400, height: 200 };
    expect(turnedSize(400, 200, 90).width).toBeCloseTo(200);
    expect(alignPicture(rect, 0, 'left').x).toBeCloseTo(200 / 1080);
    expect(alignPicture(rect, 0, 'right').x).toBeCloseTo(1 - 200 / 1080);
    expect(alignPicture(rect, 90, 'left').x).toBeCloseTo(100 / 1080);
    expect(alignPicture(rect, 90, 'bottom').y).toBeCloseTo(1 - 200 / 1920);
    expect(alignPicture(rect, 33, 'centerX')).toEqual({ x: 0.5 });
  });

  it('uses only the part of the picture that can be seen', () => {
    // Entirely inside the frame: all of it, where it is.
    const inside = placePicture({ left: 100, top: 200, width: 400, height: 600 }, 0)!;
    expect(inside.whole).toBe(true);
    expect(inside).toMatchObject({ width: 400, height: 600, cx: 300, cy: 500 });
    // Three times the frame: only the frame's worth is drawn (plus a hair of margin).
    const big = placePicture({ left: -1080, top: -1920, width: 3240, height: 5760 }, 0)!;
    expect(big.whole).toBe(false);
    expect(big.width).toBeCloseTo(1084);
    expect(big.height).toBeCloseTo(1924);
    expect(big.crop.x).toBeCloseTo((1080 - 2) / 3240);
    expect(big.crop.w).toBeCloseTo(1084 / 3240);
    expect(big.cx).toBeCloseTo(540);
    expect(big.cy).toBeCloseTo(960);
    // Sticking out to the right: the visible part ends at the frame's edge.
    const right = placePicture({ left: 800, top: 0, width: 1000, height: 1000 }, 0)!;
    expect(right.width).toBeCloseTo(282);
    expect(right.cx - right.width / 2).toBeCloseTo(800);
    // Turned: the part kept still covers the frame, and stays bounded however large the picture is.
    const turned = placePicture({ left: -5000, top: -5000, width: 11080, height: 11920 }, 30)!;
    expect(turned.width).toBeLessThan(2300);
    expect(turned.height).toBeLessThan(2300);
    expect(turned.width * turned.height).toBeGreaterThan(1080 * 1920);
    // Out of the frame: nothing to draw.
    expect(placePicture({ left: 2000, top: 0, width: 300, height: 300 }, 0)).toBeNull();
    expect(placePicture({ left: -2000, top: -2000, width: 300, height: 300 }, 45)).toBeNull();
  });

  it('turns improvements into a CSS filter for the player and FFmpeg filters for the export', () => {
    expect(cssFilter(pictureOf({}))).toBe('');
    expect(cssFilter(pictureOf({ enhance: 1 }))).toBe('contrast(1.14) saturate(1.3)');
    expect(improveFilters(pictureOf({ enhance: 1 })).finish).toEqual(['eq=contrast=1.14:saturation=1.3', 'unsharp=5:5:1.1:5:5:0']);
    expect(improveFilters(pictureOf({ denoise: 0.5 })).denoise).toBe('hqdn3d=4.75:3.5:7:5.25');
    expect(improveFilters(pictureOf({ upscale: true })).finish).toEqual(['unsharp=3:3:0.8:3:3:0']);
    expect(improveFilters(pictureOf({}))).toEqual({ denoise: null, finish: [] });
  });
});

describe('export plan with picture settings', () => {
  it('leaves an untouched clip exactly as before', () => {
    const plan = buildExportPlan(project({}), media, {});
    expect(plan.filter).toContain(
      `[0:v:0]settb=AVTB,setpts=PTS-STARTPTS,fps=30,select='gte(t,-0.01667)*lt(t,3.98333)',setpts=N/30/TB[vr0];\n[vr0]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,format=yuv420p[v0]`,
    );
    expect(plan.stabilize).toEqual([]);
  });

  it('draws a moved, resized, turned and see-through clip over black', () => {
    const doc = project({ clips: [{ id: 'c', mediaId: 'v', start: 0, end: 4, cuts: [], scale: 0.5, y: 0.75, rotation: 90, opacity: 0.5 }] });
    const { filter } = buildExportPlan(doc, media, {});
    // The background has the clip's own frames, so both are always as long.
    expect(filter).toContain('[vr0]split=2[bg0][fg0]');
    expect(filter).toContain('[bg0]scale=1080:1920:flags=neighbor,drawbox=c=black:t=fill,setsar=1,format=yuv420p[bgb0]');
    expect(filter).toContain(
      "scale=540:960,setsar=1,format=rgba,rotate=1.5708:ow='rotw(1.5708)':oh='roth(1.5708)':c=black@0,format=rgba,colorchannelmixer=aa=0.5[fgs0]",
    );
    expect(filter).toContain("[bgb0][fgs0]overlay=x='540-w/2':y='1440-h/2',setsar=1,format=yuv420p[v0]");
  });

  it('only scales the visible part of an enlarged clip', () => {
    const doc = project({ clips: [{ id: 'c', mediaId: 'v', start: 0, end: 4, cuts: [], scale: 3 }] });
    const { filter } = buildExportPlan(doc, media, {});
    expect(filter).toMatch(/\[fg0\]crop=w='iw\*0\.33457':h='ih\*0\.33403':x='iw\*0\.33272':y='ih\*0\.33299',scale=1084:1924,setsar=1\[fgs0\]/);
    // Completely out of the frame: only the background is left.
    const gone = project({ clips: [{ id: 'c', mediaId: 'v', start: 0, end: 4, cuts: [], scale: 0.2, x: 3 }] });
    expect(buildExportPlan(gone, media, {}).filter).toContain(
      '[vr0]scale=1080:1920:flags=neighbor,drawbox=c=black:t=fill,setsar=1,format=yuv420p[v0]',
    );
  });

  it('fits a moved clip inside the frame over its blurred copy', () => {
    const doc = project({ clips: [{ id: 'c', mediaId: 'wide', start: 0, end: 4, cuts: [], y: 0.25 }] });
    doc.settings.fitMode = 'blur';
    const { filter } = buildExportPlan(doc, media, {});
    expect(filter).toContain('boxblur=10:2,scale=1080:1920,lutyuv=y=val*0.8,setsar=1,format=yuv420p[bgb0]');
    expect(filter).toContain("[fg0]scale=1080:608,setsar=1[fgs0];\n[bgb0][fgs0]overlay=x='540-w/2':y='480-h/2'");
  });

  it('applies the improvements, each in its place', () => {
    const clip = { id: 'c', mediaId: 'v', start: 0, end: 4, cuts: [], stabilize: 3, enhance: 1, denoise: 0.5, upscale: true, opticalFlow: true };
    // Stabilisation works on the frames as shot (before the cuts) and needs a first pass that measures the shake.
    const plan = buildExportPlan(project({ clips: [clip] }), media, {}, [], { vidstab: true });
    expect(plan.stabilize).toEqual([
      {
        input: ['-ss', '0', '-t', '4.5', '-i', '/v.mp4'],
        filter: 'settb=AVTB,setpts=PTS-STARTPTS,fps=30,vidstabdetect=shakiness=8:accuracy=15:result=stab-0.trf',
        file: 'stab-0.trf',
        duration: 4.5,
      },
    ]);
    expect(plan.filter).toContain(
      "fps=30,vidstabtransform=input=stab-0.trf:smoothing=30:optzoom=1:interpol=bicubic,select='gte(t,-0.01667)*lt(t,3.98333)',setpts=N/30/TB,hqdn3d=4.75:3.5:7:5.25[vr0]",
    );
    expect(plan.filter).toContain(
      'scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,eq=contrast=1.14:saturation=1.3,unsharp=5:5:1.1:5:5:0,unsharp=3:3:0.8:3:3:0,setsar=1',
    );
    // At normal speed there are no frames to make up.
    expect(plan.filter).not.toContain('minterpolate');
    // Without the two-pass stabiliser, the simple one in a single pass.
    const simple = buildExportPlan(project({ clips: [clip] }), media, {});
    expect(simple.stabilize).toEqual([]);
    expect(simple.filter).toContain('fps=30,deshake=rx=64:ry=64:edge=mirror,select=');
    // Slow motion with "flujo óptico": the frames in between are worked out.
    const slow = buildExportPlan(project({ clips: [{ ...clip, speed: 0.5 }] }), media, {});
    expect(slow.filter).toContain('setpts=PTS/0.5,minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,tpad=');
    const slowPlain = buildExportPlan(project({ clips: [{ id: 'c', mediaId: 'v', start: 0, end: 4, cuts: [], speed: 0.5 }] }), media, {});
    expect(slowPlain.filter).toContain('setpts=PTS/0.5,fps=30,tpad=');
    // A photo has no shake, noise or motion to fix.
    const photo = buildExportPlan(project({ clips: [{ ...clip, mediaId: 'img' }] }), media, {}, [], { vidstab: true });
    expect(photo.stabilize).toEqual([]);
    expect(photo.filter).not.toMatch(/vidstab|deshake|hqdn3d|minterpolate/);
    expect(photo.filter).toContain('eq=contrast=1.14');
  });

  it('turns, fades and blends overlays', () => {
    const base = { id: 'b', mediaId: 'img', start: 1, duration: 2, srcIn: 0 };
    // A plain sticker keeps the simple path (a square picture covers the frame by its height: 20 % of it is 384 px).
    const plain = buildExportPlan(project({ broll: [{ ...base, x: 0.25, y: 0.25, scale: 0.2 }] }), media, {});
    expect(plain.filter).toContain('scale=384:384,setsar=1,format=yuva420p,trim=duration=2,setpts=PTS+1/TB[b0]');
    expect(plain.filter).toContain("[vcat][b0]overlay=78:288:eof_action=pass:enable='between(t,1,2.999)'[vb0]");
    const turned = buildExportPlan(project({ broll: [{ ...base, x: 0.25, y: 0.25, scale: 0.2, rotation: 45, opacity: 0.5 }] }), media, {});
    expect(turned.filter).toContain(
      "scale=384:384,setsar=1,format=rgba,rotate=0.7854:ow='rotw(0.7854)':oh='roth(0.7854)':c=black@0,format=rgba,colorchannelmixer=aa=0.5,format=rgba,trim=duration=2,setpts=PTS+1/TB[b0]",
    );
    expect(turned.filter).toContain("[vcat][b0]overlay=x='270-w/2':y='480-h/2':eof_action=pass:enable='between(t,1,2.999)'[vb0]");
    // A blend mode: mixed with the video in RGB, and put back only where the overlay is.
    const blended = buildExportPlan(project({ broll: [{ ...base, scale: 0.2, blend: 'screen' }] }), media, {}).filter;
    expect(blended).toContain('[vcat]split=3[obv0][obw0][obz0]');
    expect(blended).toContain('[obg0][obf0]blend=all_mode=screen[obb0]');
    expect(blended).toContain('[obb0][oba0]alphamerge[obx0];\n[obv0][obx0]overlay=format=auto[vb0]');
    // Fully see-through or out of the frame: not drawn at all.
    expect(buildExportPlan(project({ broll: [{ ...base, opacity: 0 }] }), media, {}).filter).not.toContain('[b0]');
  });
});

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const hasVidstab = hasFfmpeg && execFileSync('ffmpeg', ['-hide_banner', '-filters']).toString().includes(' vidstabtransform ');

describe.skipIf(!hasFfmpeg)('picture settings rendered with FFmpeg', () => {
  const ff = (...args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  /** Colour of the pixel at (x, y) of the frame at second t. */
  const pixel = (file: string, t: number, x: number, y: number) => [
    ...execFileSync('ffmpeg', [
      '-v',
      'error',
      '-ss',
      String(t),
      '-i',
      file,
      '-frames:v',
      '1',
      '-vf',
      `crop=4:4:${x - 2}:${y - 2},scale=1:1`,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ]),
  ];
  const frames = (file: string) =>
    Number(
      /nb_read_frames=(\d+)/.exec(
        execFileSync('ffprobe', [
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-count_frames',
          '-show_entries',
          'stream=nb_read_frames',
          file,
        ]).toString(),
      )![1],
    );
  const close = (a: number[], b: number[], tol = 26) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

  it('draws clips and overlays where the preview shows them', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'verticut-picture-'));
    try {
      const red = path.join(dir, 'red.mp4');
      const white = path.join(dir, 'white.png');
      const work = path.join(dir, 'work');
      mkdirSync(work, { recursive: true });
      ff(
        '-f',
        'lavfi',
        '-i',
        'color=c=red:s=540x960:r=30:d=4',
        '-f',
        'lavfi',
        '-i',
        'sine=f=300:d=4',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-shortest',
        red,
      );
      ff('-f', 'lavfi', '-i', 'color=c=white:s=400x400', '-frames:v', '1', white);
      const files = new Map<string, PlanMedia>([
        ['v', { id: 'v', kind: 'video', sourcePath: red, hasAudio: true, width: 540, height: 960 }],
        ['w', { id: 'w', kind: 'image', sourcePath: white, hasAudio: false, width: 400, height: 400 }],
      ]);
      const RED = [254, 0, 0];
      const BLACK = [0, 0, 0];
      const doc = project({
        clips: [
          // Half size, turned a quarter: a red bar 960 wide and 540 tall in the middle of the frame.
          { id: 'a', mediaId: 'v', start: 0, end: 1, cuts: [], scale: 0.5, rotation: 90 },
          // Half size at the bottom right corner, half see-through.
          { id: 'b', mediaId: 'v', start: 1, end: 2, cuts: [], scale: 0.5, x: 0.75, y: 0.75, opacity: 0.5 },
          // Twice the size, slowed down, with every improvement on.
          {
            id: 'c',
            mediaId: 'v',
            start: 2,
            end: 3,
            cuts: [],
            scale: 2,
            speed: 0.5,
            stabilize: 2,
            enhance: 0.5,
            denoise: 0.5,
            opticalFlow: true,
            upscale: true,
          },
        ],
        broll: [
          // A white square over the red bar: "difference" turns red into cyan.
          { id: 'o', mediaId: 'w', start: 0, duration: 1, srcIn: 0, scale: 0.2, blend: 'difference' },
          // The same square, stretched to twice its width, turned and at 50 %, over the third clip.
          { id: 'p', mediaId: 'w', start: 2, duration: 1, srcIn: 0, scale: 0.4, scaleY: 0.2, rotation: 90, opacity: 0.5 },
        ],
      });
      const plan = buildExportPlan(doc, files, {}, [], { vidstab: hasVidstab });
      expect(plan.stabilize).toHaveLength(hasVidstab ? 1 : 0);
      const out = path.join(dir, 'out.mp4');
      const stages = new Set<string>();
      await renderPlan(plan, out, work, 'fast', (_p, stage = 'Renderizando') => stages.add(stage));
      expect([...stages]).toEqual(hasVidstab ? ['Estabilizando', 'Renderizando'] : ['Renderizando']);
      // The length is exact whatever is done to the picture: 1 s + 1 s + 1 s at half speed.
      expect(frames(out)).toBe(120);

      // First clip: the bar reaches 480 px to each side of the centre and 270 px up and down.
      expect(close(pixel(out, 0.5, 540 - 440, 960 - 230), RED)).toBe(true);
      expect(close(pixel(out, 0.5, 540 + 440, 960 + 230), RED)).toBe(true);
      expect(close(pixel(out, 0.5, 540, 960 - 300), BLACK)).toBe(true);
      expect(close(pixel(out, 0.5, 30, 960), BLACK)).toBe(true);
      // The white square (384 px) in "difference" over red is cyan.
      expect(close(pixel(out, 0.5, 540, 960), [0, 255, 255], 40)).toBe(true);
      expect(close(pixel(out, 0.5, 540 + 90, 960 - 90), [0, 255, 255], 40)).toBe(true);
      expect(close(pixel(out, 0.5, 540 + 150, 960 - 150), [0, 255, 255], 40)).toBe(true);
      expect(close(pixel(out, 0.5, 540 + 240, 960), RED)).toBe(true);

      // Second clip: the bottom right quarter, at half strength over black.
      expect(close(pixel(out, 1.5, 810, 1440), [127, 0, 0], 30)).toBe(true);
      expect(close(pixel(out, 1.5, 560, 990), [127, 0, 0], 30)).toBe(true);
      expect(close(pixel(out, 1.5, 500, 1440), BLACK)).toBe(true);
      expect(close(pixel(out, 1.5, 810, 900), BLACK)).toBe(true);

      // Third clip: fills the frame; the stretched square, turned, is 384 px wide and 768 px tall, half white over red.
      const pink = pixel(out, 2.5, 540, 960);
      expect(pink[0]).toBeGreaterThan(220);
      expect(Math.abs(pink[1] - 127)).toBeLessThan(45);
      expect(Math.abs(pink[1] - pink[2])).toBeLessThan(30);
      expect(Math.abs(pixel(out, 2.5, 540, 960 - 340)[1] - 127)).toBeLessThan(45);
      expect(Math.abs(pixel(out, 2.5, 540 + 150, 960 + 340)[1] - 127)).toBeLessThan(45);
      expect(pixel(out, 2.5, 540 + 240, 960)[1]).toBeLessThan(40);
      expect(pixel(out, 2.5, 540, 960 - 430)[1]).toBeLessThan(40);
      expect(pixel(out, 3, 40, 40)[0]).toBeGreaterThan(200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
