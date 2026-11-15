// The "Vídeo" tab: Transformación, Mezcla and the improvements, on clips of the main track and
// on overlays. Checks every control, and that the exported MP4 shows the same picture as the player.
// Restores the project when it finishes.
//
//   node scripts/audit/audit-video.cjs        (the app must be running; needs Playwright, FFmpeg in the PATH
//                                              and a project with a vertical video, a photo and an overlay)
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const BASE = process.env.VERTICUT_URL || 'http://localhost:3000';
const SHOTS = process.env.SHOTS;
const j = async (url, init) => (await fetch(BASE + url, init)).json();
const send = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

(async () => {
  const id = process.env.PROJECT || (await j('/api/projects')).projects[0].id;
  const original = (await j(`/api/projects/${id}`)).project;
  const start = JSON.parse(JSON.stringify(original));
  const sticker = start.broll[0];
  if (!sticker || start.clips.length < 2) throw new Error('El proyecto necesita dos clips (un vídeo y una foto) y una superposición');
  // A short montage: 6 s of the video and 2 s of the photo, with the overlay over the video.
  start.clips = start.clips.slice(0, 2).map((c, i) => ({ id: c.id, mediaId: c.mediaId, start: 0, end: i ? 2 : 6, cuts: [] }));
  start.broll = [{ id: 'ovA', mediaId: sticker.mediaId, start: 1, duration: 4, srcIn: 0, x: 0.5, y: 0.7, scale: 0.3, lane: 0 }];
  start.audio = [];
  start.texts = [];
  start.words = {};
  start.settings = { ...start.settings, fitMode: 'cover' };
  start.subtitles = { ...start.subtitles, enabled: false };
  await fetch(`${BASE}/api/projects/${id}`, send('PUT', start));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verticut-audit-'));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160));
  });
  const results = [];
  const ok = (name, pass, detail = '') => {
    results.push(pass);
    console.log(pass ? 'ok  ' : 'FAIL', name, detail === '' ? '' : typeof detail === 'string' ? detail : JSON.stringify(detail));
  };
  try {
    await page.goto(`${BASE}/editor/${id}`);
    await page.waitForSelector('[data-track=main] [data-clip]', { timeout: 30000 });
    await page.waitForFunction(() => !!window.__verticut);
    await page.waitForTimeout(2000);
    const right = page.locator('aside >> nth=1');
    const D = (expr) =>
      page.evaluate((e) => {
        const s = window.__verticut.useEditor.getState();
        return JSON.parse(JSON.stringify(new Function('d', 's', 'return ' + e)(s.doc, s) ?? null));
      }, expr);
    const commit = (fn) => page.evaluate((src) => window.__verticut.useEditor.getState().commit(new Function('d', src)), fn);
    const seek = async (t) => {
      await page.evaluate((t) => {
        window.__verticut.player.pause();
        window.__verticut.player.seek(t);
      }, t);
      await page.waitForTimeout(350);
    };
    /** The clip on screen: its box on the 1080x1920 frame (before turning), turn, opacity and filter. */
    const deck = () =>
      page.evaluate(() => {
        const el = [...document.querySelectorAll('[data-deck]')].find((d) => d.style.opacity !== '0');
        if (!el) return null;
        const stage = document.querySelector('[data-stage]').getBoundingClientRect();
        const k = stage.width / 1080;
        const r = el.getBoundingClientRect();
        const n = (v) => Math.round(parseFloat(v) * 10) / 10;
        return {
          left: n(el.style.left),
          top: n(el.style.top),
          width: n(el.style.width),
          height: n(el.style.height),
          transform: el.style.transform,
          opacity: el.style.opacity,
          filter: el.style.filter,
          // Box of the turned picture, in frame pixels.
          box: {
            left: (r.left - stage.left) / k,
            top: (r.top - stage.top) / k,
            right: (r.right - stage.left) / k,
            bottom: (r.bottom - stage.top) / k,
          },
        };
      });
    const num = (label, scope = right) => scope.locator(`input[type=number][aria-label="${label}"]`);
    const fill = async (label, value, scope = right) => {
      await num(label, scope).fill(String(value));
      await page.waitForTimeout(90);
    };
    const press = async (label) => {
      await right.getByRole('button', { name: label, exact: true }).click();
      await page.waitForTimeout(90);
    };
    const tick = async (title) => {
      await right.getByRole('checkbox', { name: title, exact: true }).click();
      await page.waitForTimeout(90);
    };
    const section = (title) => right.locator('section', { has: page.getByRole('checkbox', { name: title, exact: true }) }).first();
    const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;
    const clipBox = async (n) => page.locator(`[data-track=main] [data-clip] >> nth=${n}`).boundingBox();

    // ---------------------------------------------------------------- a clip of the main track
    await seek(2);
    let b = await clipBox(0);
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(200);
    ok('al seleccionar un clip se abre la pestaña Vídeo', (await D('s.inspectorTab')) === 'video');
    await seek(2);
    let d0 = await deck();
    ok(
      'sin tocar nada el clip ocupa todo el encuadre',
      d0 && near(d0.left, 0) && near(d0.top, 0) && near(d0.width, 1080) && near(d0.height, 1920),
      d0,
    );

    await fill('Escala', 60);
    d0 = await deck();
    ok(
      'Escala 60 %',
      (await D('d.clips[0].scale')) === 0.6 && near(d0.width, 648) && near(d0.height, 1152) && near(d0.left, 216) && near(d0.top, 384),
      d0,
    );
    await fill('Posición X', 100);
    await fill('Posición Y', 200);
    d0 = await deck();
    ok('Posición X 100 · Y 200 (hacia arriba)', near(d0.left, 316) && near(d0.top, 184), [d0.left, d0.top]);
    await fill('Girar', 20);
    d0 = await deck();
    ok('Girar 20°', (await D('d.clips[0].rotation')) === 20 && d0.transform === 'rotate(20deg)', d0.transform);
    await right.getByRole('switch', { name: 'Escala uniforme' }).click();
    await fill('Alto', 80);
    d0 = await deck();
    ok('sin escala uniforme, el alto va aparte', (await D('d.clips[0].scaleY')) === 0.8 && near(d0.height, 1536) && near(d0.width, 648), [
      d0.width,
      d0.height,
    ]);
    await right.getByRole('switch', { name: 'Escala uniforme' }).click();
    ok('con escala uniforme vuelve a ir junto', (await D('d.clips[0].scaleY')) === null && (await num('Escala').count()) === 1);

    for (const [label, edge, value] of [
      ['Alinear a la izquierda', 'left', 0],
      ['Alinear a la derecha', 'right', 1080],
      ['Alinear arriba', 'top', 0],
      ['Alinear abajo', 'bottom', 1920],
    ]) {
      await press(label);
      d0 = await deck();
      ok(`${label} (con el clip girado)`, near(d0.box[edge], value, 2.5), Math.round(d0.box[edge]));
    }
    await press('Centrar a lo ancho');
    await press('Centrar a lo alto');
    d0 = await deck();
    ok('Centrar a lo ancho y a lo alto', near((d0.box.left + d0.box.right) / 2, 540, 2.5) && near((d0.box.top + d0.box.bottom) / 2, 960, 2.5));

    await fill('Opacidad', 70);
    d0 = await deck();
    ok('Opacidad 70 %', (await D('d.clips[0].opacity')) === 0.7 && d0.opacity === '0.7', d0.opacity);
    ok('un clip de la pista principal no tiene modo de mezcla', (await right.locator('select[aria-label="Modo de mezcla"]').count()) === 0);

    await press('Restablecer mezcla');
    await press('Restablecer transformación');
    d0 = await deck();
    ok(
      'los botones de restablecer lo dejan como venía',
      (await D('Object.keys(d.clips[0]).sort().join()')) === 'cuts,end,id,mediaId,start' &&
        near(d0.width, 1080) &&
        d0.opacity === '1' &&
        d0.transform === '',
      await D('Object.keys(d.clips[0]).sort().join()'),
    );

    await tick('Estabilización');
    ok('Estabilización (nivel recomendado)', (await D('d.clips[0].stabilize')) === 2);
    await section('Estabilización').getByRole('button', { name: 'Más estable', exact: true }).click();
    ok('Estabilización: Más estable', (await D('d.clips[0].stabilize')) === 3);
    await tick('Mejorar la calidad');
    d0 = await deck();
    ok('Mejorar la calidad se ve en el reproductor', (await D('d.clips[0].enhance')) === 0.5 && /contrast\(.*saturate\(/.test(d0.filter), d0.filter);
    await fill('Intensidad', 80, section('Mejorar la calidad'));
    ok('Mejorar la calidad: intensidad', (await D('d.clips[0].enhance')) === 0.8);
    await tick('Reducir el ruido de la imagen');
    await fill('Intensidad', 30, section('Reducir el ruido de la imagen'));
    ok('Reducir el ruido de la imagen', (await D('d.clips[0].denoise')) === 0.3);
    await tick('Flujo óptico');
    ok(
      'Flujo óptico (avisa de que el clip no está ralentizado)',
      (await D('d.clips[0].opticalFlow')) === true && (await section('Flujo óptico').getByText('no está ralentizado').count()) === 1,
    );
    await tick('Ampliación');
    ok('Ampliación', (await D('d.clips[0].upscale')) === true);

    await press('Aplicar a todos los clips');
    ok('Aplicar a todos los clips', (await D('d.clips[1].enhance')) === 0.8 && (await D('d.clips[1].upscale')) === true, await D('d.clips[1]'));
    await tick('Estabilización');
    await tick('Flujo óptico');
    await tick('Reducir el ruido de la imagen');
    await tick('Ampliación');
    await tick('Mejorar la calidad');
    ok('al desmarcarlas se quitan', (await D('["stabilize","opticalFlow","denoise","upscale","enhance"].filter(k => k in d.clips[0]).length')) === 0);

    // ---------------------------------------------------------------- a photo on the main track
    b = await clipBox(1);
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(200);
    const photoChecks = await right.getByRole('checkbox').allTextContents();
    ok('una foto solo ofrece lo que le sirve', photoChecks.join('|') === 'Mejorar la calidad|Ampliación', photoChecks.join('|'));
    await seek(7);
    d0 = await deck();
    // 1600x1200 covering 1080x1920: 2560 px wide.
    ok('la foto cubre el encuadre', near(d0.height, 1920) && near(d0.width, 2560) && near(d0.left, -740), [d0.left, d0.width]);
    await commit('for (const c of d.clips) { delete c.enhance; delete c.upscale; }');

    // ---------------------------------------------------------------- an overlay
    await seek(2);
    const ov = await page.locator('[data-track=broll] > [data-item]').boundingBox();
    await page.mouse.click(ov.x + ov.width / 2, ov.y + ov.height / 2);
    await page.waitForTimeout(200);
    await seek(2);
    const overlay = () =>
      page.evaluate(() => {
        const el = document.querySelector('[data-overlay]');
        const cs = getComputedStyle(el);
        return {
          width: parseFloat(el.style.width),
          left: parseFloat(el.style.left),
          transform: el.style.transform,
          blend: cs.mixBlendMode,
          opacity: el.style.opacity,
        };
      });
    await fill('Escala', 50);
    await fill('Girar', 30);
    await fill('Opacidad', 60);
    await right.locator('select[aria-label="Modo de mezcla"]').selectOption('screen');
    await page.waitForTimeout(120);
    let o = await overlay();
    ok(
      'superposición: escala, giro, opacidad y modo de mezcla',
      near(o.width, 960) && o.transform === 'rotate(30deg)' && o.blend === 'screen' && o.opacity === '0.6',
      o,
    );
    ok('una superposición no ofrece estabilización ni flujo óptico', (await right.getByRole('checkbox', { name: 'Estabilización' }).count()) === 0);
    // The round handle over the selection turns it.
    const handle = await page.locator('[data-handle=rotate]').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 60, handle.y + handle.height / 2 + 30, { steps: 5 });
    await page.mouse.up();
    ok('el asa redonda del reproductor gira la superposición', (await D('d.broll[0].rotation')) !== 30, await D('d.broll[0].rotation'));

    // ---------------------------------------------------------------- the export shows what the player shows
    /** Mean difference (0–255) between two pictures of the frame, compared small. */
    const difference = (a, c) =>
      page.evaluate(
        async ([a, c]) => {
          const load = (src) =>
            new Promise((resolve) => {
              const img = new Image();
              img.onload = () => {
                const cv = document.createElement('canvas');
                cv.width = 108;
                cv.height = 192;
                const ctx = cv.getContext('2d');
                ctx.drawImage(img, 0, 0, 108, 192);
                resolve(ctx.getImageData(0, 0, 108, 192).data);
              };
              img.src = src;
            });
          const [p, q] = await Promise.all([load(a), load(c)]);
          let sum = 0;
          for (let i = 0; i < p.length; i += 4) sum += Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]);
          return sum / (p.length / 4) / 3;
        },
        [a, c],
      );
    const png = (file) => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
    const stage = page.locator('[data-stage]').locator('..');
    const shot = async (t, name) => {
      await page.evaluate(() => window.__verticut.useEditor.getState().setSelection(null));
      await seek(t);
      await page.waitForTimeout(500);
      await page.locator('[data-timeline]').hover({ position: { x: 700, y: 20 } });
      const file = path.join(tmp, `${name}-player.png`);
      await stage.screenshot({ path: file });
      return file;
    };
    const exportFrames = async (times, name) => {
      const doc = await D('d');
      const { job } = await j('/api/export', send('POST', { doc, quality: 'fast', texts: [] }));
      let state;
      for (let i = 0; i < 400; i++) {
        await new Promise((r) => setTimeout(r, 500));
        state = (await j(`/api/jobs/${job.id}`)).job;
        if (state.status !== 'queued' && state.status !== 'running') break;
      }
      if (state.status !== 'done') throw new Error(`La exportación falló: ${state.error}`);
      const mp4 = path.join(tmp, `${name}.mp4`);
      fs.writeFileSync(mp4, Buffer.from(await (await fetch(BASE + state.result.url)).arrayBuffer()));
      return times.map((t, i) => {
        const out = path.join(tmp, `${name}-${i}.png`);
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(t), '-i', mp4, '-frames:v', '1', out]);
        return out;
      });
    };
    // The player and the MP4 never match to the pixel (the browser and FFmpeg convert colours differently, and the
    // preview is a lighter copy of the video), so the changed pictures are measured against an unchanged one.
    let baseline = 0;
    const compare = async (label, times, name, margin) => {
      const shots = [];
      for (const [i, t] of times.entries()) shots.push(await shot(t, `${name}-${i}`));
      const frames = await exportFrames(times, name);
      for (const [i, t] of times.entries()) {
        const diff = await difference(png(shots[i]), png(frames[i]));
        if (SHOTS) {
          fs.copyFileSync(shots[i], `${SHOTS}/${name}-${i}-player.png`);
          fs.copyFileSync(frames[i], `${SHOTS}/${name}-${i}-export.png`);
        }
        if (margin === null) baseline = diff;
        ok(`${label} · segundo ${t}`, margin === null ? diff < 18 : diff < baseline + margin, `diferencia media ${diff.toFixed(1)} de 255`);
      }
    };

    // Reference: nothing changed. How much the player and the MP4 differ on their own (colours, compression).
    await commit(`d.broll[0] = { id: 'ovA', mediaId: d.broll[0].mediaId, start: 1, duration: 4, srcIn: 0, x: 0.5, y: 0.7, scale: 0.3, lane: 0 };`);
    await compare('sin cambios, el MP4 es como el reproductor', [2.5], 'plain', null);
    // Everything moved, resized, turned and see-through: the clip, the photo and the overlay.
    await commit(`
      Object.assign(d.clips[0], { scale: 0.7, x: 0.58, y: 0.45, rotation: 15, opacity: 0.8 });
      Object.assign(d.clips[1], { scale: 0.5, scaleY: 0.3, x: 0.4, y: 0.6, rotation: -10 });
      Object.assign(d.broll[0], { scale: 0.45, scaleY: 0.3, x: 0.35, y: 0.3, rotation: -25, opacity: 0.75 });
    `);
    await compare('transformado, el MP4 es como el reproductor', [2.5, 7], 'moved', 3);
    // An enlarged clip pushed to a corner: only a part of it is drawn.
    await commit(`
      Object.assign(d.clips[0], { scale: 2.5, scaleY: undefined, x: 0.9, y: 0.2, rotation: 35, opacity: 1 });
      Object.assign(d.broll[0], { scale: 0.6, scaleY: undefined, x: 0.5, y: 0.5, rotation: 0, opacity: 1, blend: 'difference' });
    `);
    await compare('ampliado y con modo de mezcla, el MP4 es como el reproductor', [2.5], 'zoom', 3);
    // The blurred background, with the picture fitted inside the frame.
    await commit(`
      d.settings.fitMode = 'blur';
      Object.assign(d.clips[0], { scale: 0.8, x: 0.5, y: 0.4, rotation: -12, opacity: 1 });
      Object.assign(d.clips[1], { scale: 1, scaleY: undefined, x: 0.5, y: 0.5, rotation: 0 });
      Object.assign(d.broll[0], { blend: 'multiply' });
    `);
    await compare('con fondo borroso, el MP4 es como el reproductor', [2.5, 7], 'blur', 5);
    // The improvements do not break the render.
    await commit(`
      d.settings.fitMode = 'cover';
      d.clips[0] = { id: d.clips[0].id, mediaId: d.clips[0].mediaId, start: 0, end: 1, cuts: [], speed: 0.5, stabilize: 2, enhance: 0.6, denoise: 0.4, opticalFlow: true, upscale: true };
      d.clips[1] = { id: d.clips[1].id, mediaId: d.clips[1].mediaId, start: 0, end: 1, cuts: [], enhance: 0.6, upscale: true };
      d.broll = [];
    `);
    const t0 = Date.now();
    const frames = await exportFrames([1], 'improved');
    ok(
      'exporta con estabilización, mejora, ruido, flujo óptico y ampliación',
      fs.statSync(frames[0]).size > 1000,
      `${((Date.now() - t0) / 1000).toFixed(1)} s`,
    );
  } finally {
    await fetch(`${BASE}/api/projects/${id}`, send('PUT', original));
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length} comprobaciones · ${results.length - failed} correctas · ${failed} con fallo`);
  console.log(errors.length ? 'errores de consola:\n' + errors.join('\n') : 'sin errores de consola');
  process.exit(failed || errors.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
