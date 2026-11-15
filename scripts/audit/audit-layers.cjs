// Layers of the timeline: dragging between rows, drawing order, frames along the video, colours and font order.
// Restores the project when it finishes.
//
//   node scripts/audit/audit-layers.cjs        (the app must be running; needs Playwright and a project with an overlay)
const { chromium } = require('playwright');
const BASE = process.env.VERTICUT_URL || 'http://localhost:3000';
const SHOTS = process.env.SHOTS;
(async () => {
  const id = process.env.PROJECT || (await (await fetch(BASE + '/api/projects')).json()).projects[0].id;
  const original = (await (await fetch(`${BASE}/api/projects/${id}`)).json()).project;
  const start = JSON.parse(JSON.stringify(original));
  const sticker = start.broll[0];
  if (!sticker) throw new Error('El proyecto necesita una superposición');
  start.texts = [];
  start.audio = [];
  start.broll = [
    { ...sticker, id: 'ovA', start: 2, duration: 4, x: 0.35, y: 0.3, scale: 0.3, lane: 0 },
    { ...sticker, id: 'ovB', start: 3, duration: 4, x: 0.5, y: 0.36, scale: 0.3, lane: 0 },
  ];
  start.subtitles = { ...start.subtitles, enabled: true };
  await fetch(`${BASE}/api/projects/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(start) });
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
    console.log(pass ? 'ok  ' : 'FAIL', name, detail);
  };
  try {
    await page.goto(`${BASE}/editor/${id}`);
    await page.waitForSelector('[data-track=broll] > [data-item]', { timeout: 30000 });
    await page.waitForFunction(() => !!window.__verticut);
    const D = (expr) =>
      page.evaluate((e) => {
        const s = window.__verticut.useEditor.getState();
        return JSON.parse(JSON.stringify(new Function('d', 's', 'return ' + e)(s.doc, s) ?? null));
      }, expr);
    const rowsOf = (track) =>
      page.evaluate(
        (track) =>
          Object.fromEntries(
            [...document.querySelectorAll(`[data-track=${track}] > [data-item]`)].map((el) => [
              el.getAttribute('data-item'),
              Math.round(el.getBoundingClientRect().top),
            ]),
          ),
        track,
      );
    const dragBy = async (sel, dx, dy) => {
      const b = await page.locator(sel).boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + dx / 2, b.y + b.height / 2 + dy / 2, { steps: 4 });
      await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 4 });
      if (SHOTS && dy) await page.screenshot({ path: `${SHOTS}/70-dragging-layer.png` });
      await page.mouse.up();
      await page.waitForTimeout(250);
    };

    // ---- filmstrip
    await page.waitForSelector('[data-filmstrip] > div', { timeout: 60000 }).catch(() => undefined);
    const strip = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll('[data-filmstrip] > div')];
      return {
        tiles: tiles.length,
        positions: new Set(tiles.map((t) => t.style.backgroundPosition)).size,
        media: Object.values(window.__verticut.useEditor.getState().media)
          .filter((m) => m.filmstrip)
          .map((m) => m.filmstrip),
      };
    });
    ok(
      'la pista de vídeo muestra fotogramas a lo largo del clip',
      strip.tiles > 20 && strip.positions > 10,
      JSON.stringify({ tiles: strip.tiles, distintos: strip.positions, tira: strip.media[0] }),
    );

    // ---- overlays: two at the same time are on two rows; the upper one is drawn last (on top)
    let rows = await rowsOf('broll');
    ok(
      'dos superposiciones a la vez ocupan dos capas',
      rows.ovA !== rows.ovB && (await page.locator('[data-track=broll]').getAttribute('data-rows')) === '2',
      JSON.stringify(rows),
    );
    await page.evaluate(() => window.__verticut.player.seek(4));
    await page.waitForTimeout(300);
    const order = () => page.evaluate(() => [...document.querySelectorAll('[data-overlay]')].map((o) => o.getAttribute('data-overlay')).join(','));
    const upper = rows.ovA < rows.ovB ? 'ovA' : 'ovB';
    ok('la capa de arriba se dibuja por encima', (await order()).split(',').pop() === upper, `arriba=${upper} orden=${await order()}`);
    // drag the lower one above the other
    const lower = upper === 'ovA' ? 'ovB' : 'ovA';
    await dragBy(`[data-track=broll] > [data-item="${lower}"]`, 0, -90);
    rows = await rowsOf('broll');
    ok(
      'arrastrar hacia arriba la pone encima de la otra',
      rows[lower] < rows[upper] && (await order()).split(',').pop() === lower,
      JSON.stringify({ rows, lanes: await D('d.broll.map(b => b.id + ":" + b.lane)'), orden: await order() }),
    );
    await dragBy(`[data-track=broll] > [data-item="${lower}"]`, 0, 90);
    rows = await rowsOf('broll');
    ok('arrastrar hacia abajo la devuelve debajo', rows[lower] > rows[upper], JSON.stringify(rows));
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');

    // ---- texts: start above the subtitles row; can be dragged into it and above each other
    await page.click('[data-tool-tab=templates]');
    await page.waitForSelector('[data-preset=clave] canvas');
    await page.evaluate(() => window.__verticut.player.seek(3));
    await page.click('[data-preset=clave]');
    await page.click('[data-preset=etiqueta]');
    await page.waitForTimeout(300);
    const ids = await D('d.texts.map(t => t.id)');
    const subsTop = await page.evaluate(() => Math.round(document.querySelector('[data-track=subs]').getBoundingClientRect().top));
    rows = await rowsOf('text');
    ok(
      'los textos empiezan por encima de la línea de subtítulos, en capas distintas',
      rows[ids[0]] < subsTop && rows[ids[1]] < subsTop && rows[ids[0]] !== rows[ids[1]],
      JSON.stringify({ rows, subsTop }),
    );
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/71-layers.png` });
    const textOrder = () => page.evaluate(() => [...document.querySelectorAll('[data-text]')].map((c) => c.getAttribute('data-text')).join(','));
    const topText = rows[ids[0]] < rows[ids[1]] ? ids[0] : ids[1];
    const bottomText = topText === ids[0] ? ids[1] : ids[0];
    ok('el texto de la capa superior se dibuja encima', (await textOrder()).split(',').pop() === topText);
    {
      const sel = `[data-track=text] > [data-item="${bottomText}"]`;
      const bb = await page.locator(sel).boundingBox();
      const other = `[data-track=text] > [data-item="${topText}"]`;
      const before = (await page.locator(other).boundingBox()).y;
      await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await page.mouse.down();
      await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2 - 70, { steps: 6 });
      const during = (await page.locator(other).boundingBox()).y;
      ok(
        'al arrastrar a una capa nueva nada salta y aparece la línea indicadora',
        during === before && (await page.locator('[data-new-layer]').count()) === 1,
        `otro elemento: ${before} → ${during}`,
      );
      await page.mouse.up();
      await page.waitForTimeout(250);
    }
    rows = await rowsOf('text');
    ok(
      'subir un texto lo pasa por delante',
      rows[bottomText] < rows[topText] && (await textOrder()).split(',').pop() === bottomText,
      JSON.stringify(rows),
    );
    // into the subtitles row
    const b = await page.locator(`[data-track=text] > [data-item="${topText}"]`).boundingBox();
    await dragBy(`[data-track=text] > [data-item="${topText}"]`, 0, subsTop - b.y + 4);
    rows = await rowsOf('text');
    const subsNow = await page.evaluate(() => Math.round(document.querySelector('[data-track=subs]').getBoundingClientRect().top));
    ok(
      'un texto puede compartir la línea de los subtítulos',
      Math.abs(rows[topText] - subsNow) <= 6 && (await D(`d.texts.find(t => t.id === "${topText}").lane`)) === 0,
      JSON.stringify({ rows, subsNow }),
    );
    // horizontal move still works and keeps the layer
    const laneBefore = await D(`d.texts.find(t => t.id === "${bottomText}").lane`);
    const startBefore = await D(`d.texts.find(t => t.id === "${bottomText}").start`);
    await dragBy(`[data-track=text] > [data-item="${bottomText}"]`, 80, 0);
    ok(
      'mover en horizontal no cambia de capa',
      (await D(`d.texts.find(t => t.id === "${bottomText}").lane`)) === laneBefore &&
        (await D(`d.texts.find(t => t.id === "${bottomText}").start`)) > startBefore,
    );

    // ---- colours of subtitle blocks, fonts in alphabetical order
    const sub = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('[data-track=subs] > [data-sub]'));
      return [cs.backgroundColor, cs.color];
    });
    ok('los subtítulos son naranja plano con letras blancas', sub[0] === 'rgb(224, 102, 45)' && sub[1] === 'rgb(255, 255, 255)', sub.join(' / '));
    await page.keyboard.press('Escape');
    await page.click('[data-inspector-tab=subtitles]');
    await page.locator('aside >> nth=1 >> button[aria-label="Fuente"]').click();
    await page.waitForSelector('[data-font-list]');
    const names = await page.locator('[data-font-list] [role=option]').allInnerTexts();
    const sorted = [...names].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    ok('las fuentes están en orden alfabético', names.length > 30 && JSON.stringify(names) === JSON.stringify(sorted), names.slice(0, 6).join(' · '));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/72-fonts.png` });
    await page.keyboard.press('Escape');
  } finally {
    await browser.close();
    await fetch(`${BASE}/api/projects/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(original) });
  }
  console.log(`\n${results.length} comprobaciones · ${results.filter(Boolean).length} correctas · ${results.filter((r) => !r).length} con fallo`);
  console.log(errors.length ? 'errores de consola:\n' + [...new Set(errors)].join('\n') : 'sin errores de consola');
  if (results.some((r) => !r)) process.exitCode = 1;
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
