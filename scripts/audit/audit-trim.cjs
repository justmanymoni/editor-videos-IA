// Edges of the timeline elements: the stretch cursor on every kind of element, and the
// edges of the subtitle blocks (they can be dragged and two blocks never overlap).
// Restores the project when it finishes.
//
//   node scripts/audit/audit-trim.cjs        (the app must be running; needs Playwright and a project with an overlay)
const { chromium } = require('playwright');
const BASE = process.env.VERTICUT_URL || 'http://localhost:3000';
const SHOTS = process.env.SHOTS;
(async () => {
  const id = process.env.PROJECT || (await (await fetch(BASE + '/api/projects')).json()).projects[0].id;
  const original = (await (await fetch(`${BASE}/api/projects/${id}`)).json()).project;
  const start = JSON.parse(JSON.stringify(original));
  const sticker = start.broll[0];
  if (!sticker) throw new Error('El proyecto necesita una superposición');
  for (const c of start.clips) c.cuts = [];
  start.words = {};
  start.broll = [{ ...sticker, id: 'ovA', start: 2, duration: 4, lane: 0 }];
  start.audio = [{ id: 'auA', mediaId: start.clips[0].mediaId, start: 1, duration: 5, srcIn: 0, volume: 0.5, fadeIn: 0, fadeOut: 0 }];
  start.texts = [];
  start.subtitles = { ...start.subtitles, enabled: true, wordsPerPage: 3 };
  const put = (doc) =>
    fetch(`${BASE}/api/projects/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc) });
  await put(start);
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
    await page.waitForSelector('[data-track=subs] > [data-sub]', { timeout: 30000 });
    await page.waitForFunction(() => !!window.__verticut);
    await page.waitForTimeout(800);
    const D = (expr) =>
      page.evaluate((e) => {
        const s = window.__verticut.useEditor.getState();
        return JSON.parse(JSON.stringify(new Function('d', 's', 'return ' + e)(s.doc, s) ?? null));
      }, expr);
    /** Left and right, in pixels, of every subtitle block. */
    const subs = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('[data-track=subs] > [data-sub]')].map((el) => {
          const r = el.getBoundingClientRect();
          return { i: +el.getAttribute('data-sub'), l: r.left, r: r.right, text: el.textContent };
        }),
      );
    const overlaps = (list) => list.filter((b, k) => k > 0 && b.l < list[k - 1].r - 0.01).length;
    const cursorAt = async (x, y) => {
      await page.mouse.move(x, y);
      await page.mouse.move(x + 0.5, y);
      return page.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x, y)).cursor, [x, y]);
    };
    const isTrim = (c) => /^url\(.*col-resize$/.test(c);
    /** Cursor on the left edge, the middle and the right edge of an element. */
    const cursorsOf = async (sel) => {
      const b = await page.locator(sel).first().boundingBox();
      const y = b.y + b.height / 2;
      return [await cursorAt(b.x + 2, y), await cursorAt(b.x + b.width / 2, y), await cursorAt(b.x + b.width - 2, y)];
    };

    // A text, to have one element of every kind.
    await page.click('[data-tool-tab=templates]');
    await page.waitForSelector('[data-preset=clave] canvas');
    await page.evaluate(() => window.__verticut.player.seek(8));
    await page.click('[data-preset=clave]');
    await page.waitForSelector('[data-track=text] > [data-item]');
    await page.evaluate(() => window.__verticut.useEditor.getState().setSelection(null));

    // ---- the stretch cursor on every kind of element
    for (const [name, sel, middle] of [
      ['subtítulo', '[data-track=subs] > [data-sub] >> nth=2', 'pointer'],
      ['texto', '[data-track=text] > [data-item]', 'grab'],
      ['superposición', '[data-track=broll] > [data-item]', 'grab'],
      ['vídeo de la pista principal', '[data-track=main] > div >> nth=0', 'grab'],
      ['audio', '[data-track=audio] > [data-item]', 'grab'],
    ]) {
      const c = await cursorsOf(sel);
      ok(`${name}: cursor de estirar en los dos bordes y «${middle}» en el centro`, isTrim(c[0]) && c[1] === middle && isTrim(c[2]), c[1]);
    }

    // ---- subtitles never overlap
    let list = await subs();
    ok('los subtítulos no se pisan', list.length > 4 && overlaps(list) === 0, `${list.length} bloques`);

    // ---- dragging the right edge over the next block pushes its start
    const dragEdge = async (index, edge, dx, during) => {
      const b = await page.locator(`[data-track=subs] > [data-sub="${index}"]`).boundingBox();
      const x = edge === 'end' ? b.x + b.width - 2 : b.x + 2;
      const y = b.y + b.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx / 2, y, { steps: 3 });
      await page.mouse.move(x + dx, y, { steps: 3 });
      const mid = during ? await during() : null;
      await page.mouse.up();
      await page.waitForTimeout(120);
      return mid;
    };
    const k = 2;
    const before = await subs();
    const gap = before[k + 1].l - before[k].r;
    const push = Math.round(gap + 14);
    const mid = await dragEdge(k, 'end', push, async () => ({
      body: await page.evaluate(() => document.body.dataset.dragCursor),
      cursor: await page.evaluate(() => getComputedStyle(document.querySelector('[data-timeline]')).cursor),
      list: await subs(),
    }));
    ok('mientras se arrastra, el cursor de estirar se mantiene en toda la ventana', mid.body === 'trim' && isTrim(mid.cursor), mid.body);
    ok(
      'durante el arrastre ya se ve el bloque estirado y el siguiente cediendo',
      mid.list[k].r > before[k].r + 5 && overlaps(mid.list) === 0 && mid.list[k + 1].l > before[k + 1].l + 2,
    );
    list = await subs();
    ok(
      'estirar a la derecha: el siguiente empieza donde acaba este',
      list[k].r > before[k].r + push - 4 && Math.abs(list[k + 1].l - list[k].r) < 1.6 && overlaps(list) === 0,
      JSON.stringify({ antes: [before[k].r, before[k + 1].l].map(Math.round), ahora: [list[k].r, list[k + 1].l].map(Math.round) }),
    );
    ok('el final del siguiente no cambia', Math.abs(list[k + 1].r - before[k + 1].r) < 0.6);
    ok(
      'queda guardado en el proyecto',
      (await D('Object.values(d.words).filter(w => w.endOffset !== undefined || w.startOffset !== undefined).length')) === 2,
    );
    ok('el bloque arrastrado queda seleccionado', (await D('s.selection')).page === k);

    // ---- dragging the left edge to the left cuts the block before
    const b2 = await subs();
    await dragEdge(k + 3, 'start', -30);
    list = await subs();
    ok(
      'estirar a la izquierda: el anterior acaba donde empieza este',
      list[k + 3].l < b2[k + 3].l - 20 && list[k + 2].r <= list[k + 3].l + 0.01 && overlaps(list) === 0,
      JSON.stringify({ antes: Math.round(b2[k + 3].l), ahora: Math.round(list[k + 3].l), anterior: Math.round(list[k + 2].r) }),
    );

    // ---- shrinking leaves a gap, never an overlap
    const b3 = await subs();
    await dragEdge(k + 5, 'end', -18);
    list = await subs();
    ok(
      'encoger un bloque no mueve a los demás',
      list[k + 5].r < b3[k + 5].r - 10 && Math.abs(list[k + 6].l - b3[k + 6].l) < 0.6 && overlaps(list) === 0,
    );

    // ---- the dragged edge sticks to the playhead
    const b4 = await subs();
    const ruler = await page.locator('[data-ruler]').boundingBox();
    const playX = Math.round(b4[k + 7].r + 20);
    await page.mouse.click(playX, ruler.y + ruler.height / 2);
    await dragEdge(k + 7, 'end', 16);
    list = await subs();
    ok(
      'el borde se pega al cursor de reproducción',
      Math.abs(list[k + 7].r + 1 - playX) < 0.6 && overlaps(list) === 0,
      `${list[k + 7].r + 1} ≈ ${playX}`,
    );

    // ---- undo
    const changed = await subs();
    for (let i = 0; i < 4; i++) await page.keyboard.press('Control+z');
    await page.waitForTimeout(150);
    list = await subs();
    ok(
      'deshacer devuelve los bloques a su sitio',
      Math.abs(list[k].r - before[k].r) < 0.6 && Math.abs(list[k + 1].l - before[k + 1].l) < 0.6 && changed[k].r !== list[k].r,
    );

    // ---- Q and W with a subtitle selected move its start and its end to the playhead
    const b5 = await subs();
    const bx = await page.locator(`[data-track=subs] > [data-sub="${k}"]`).boundingBox();
    await page.mouse.click(bx.x + bx.width * 0.4, bx.y + bx.height / 2);
    await page.keyboard.press('q');
    await page.waitForTimeout(120);
    list = await subs();
    ok('Q: el subtítulo seleccionado empieza en el cursor', Math.abs(list[k].l - (bx.x + bx.width * 0.4)) < 2 && Math.abs(list[k].r - b5[k].r) < 0.6);
    const clips = await D('d.clips.map(c => [c.start, c.end, c.cuts.length])');
    ok('…y el vídeo no se toca', JSON.stringify(clips) === JSON.stringify(start.clips.map((c) => [c.start, c.end, 0])));
    await page.keyboard.press('Control+z');

    // ---- word by word: narrow blocks also have their edges, and still never overlap
    await page.evaluate(() => window.__verticut.useEditor.getState().commit((d) => void (d.subtitles.wordsPerPage = 1)));
    await page.waitForTimeout(200);
    list = await subs();
    ok('palabra a palabra: tampoco se pisan', list.length > 20 && overlaps(list) === 0, `${list.length} bloques`);
    const narrow = list.find((b) => b.r - b.l > 9 && b.r - b.l < 22);
    if (narrow) {
      const c = await cursorsOf(`[data-track=subs] > [data-sub="${narrow.i}"]`);
      ok(
        'un bloque estrecho también se estira por los bordes',
        isTrim(c[0]) && c[1] === 'pointer' && isTrim(c[2]),
        `${Math.round(narrow.r - narrow.l)} px`,
      );
    }
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/trim.png` });
  } finally {
    await put(original);
    await browser.close();
  }
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length} comprobaciones · ${results.length - failed} correctas · ${failed} con fallo`);
  console.log(errors.length ? 'errores de consola:\n' + errors.join('\n') : 'sin errores de consola');
  process.exit(failed || errors.length ? 1 : 0);
})();
