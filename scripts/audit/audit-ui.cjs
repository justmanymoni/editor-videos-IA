// Presses every control of the editor and checks that the project AND the preview react at once.
//
//   node scripts/audit/audit-ui.cjs            (the app must be running; needs Playwright)
//
// It works on the first project of the list (or PROJECT=<id>), which must have a transcribed video cut in
// several fragments, a photo and an overlay. The project is put back as it was at the end.
// ONLY=<regex> runs only the checks whose name matches.
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.VERTICUT_URL || 'http://localhost:3000';
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY, 'i') : null;

(async () => {
  const id = process.env.PROJECT || (await (await fetch(BASE + '/api/projects')).json()).projects[0].id;
  // ---- known starting point
  const original = (await (await fetch(`${BASE}/api/projects/${id}`)).json()).project;
  const start = JSON.parse(JSON.stringify(original));
  // prettier-ignore
  const T = {
    id: 'auditText1', text: 'Texto de prueba', start: 2, duration: 4, x: 0.5, y: 0.12, scale: 1, rotation: 0,
    fontId: 'montserrat-bold', fontSize: 96, color: '#FFFFFF', outlineColor: '#000000', outlineWidth: 6, letterSpacing: 0,
    shadowOn: true, shadow: 6, shadowColor: '#000000', shadowOpacity: 0.7, shadowBlur: 8, shadowAngle: -45,
    curve: 'none', curveAmount: 50, bgColor: '', bgRadius: 0.3, bgPadding: 0.3, animIn: 'none', animOut: 'none',
  };
  start.texts = [T];
  start.broll = start.broll.slice(0, 1).map((b) => ({ ...b, start: 2, duration: 4, x: 0.3, y: 0.42, scale: 0.3 }));
  start.audio = [];
  start.audioMix = {};
  start.words = {};
  start.clips = start.clips.map(({ speed, ...c }) => c);
  // The checks need the first video in several fragments.
  const first = start.clips[0];
  first.cuts = [3, 8, 13]
    .filter((t) => first.start + t + 1 < first.end)
    .map((t) => ({ start: first.start + t, end: first.start + t + 0.5, reason: 'manual' }));
  start.settings = { ...start.settings, fitMode: 'cover', mainVolume: 1, language: 'es' };
  // prettier-ignore
  start.subtitles = {
    enabled: true, fontId: 'montserrat-bold', fontSize: 86, textColor: '#FFFFFF', highlightColor: '#FFE600', outlineColor: '#000000', outlineWidth: 6,
    letterSpacing: 0, underline: false, shadowOn: true, shadow: 6, shadowColor: '#000000', shadowOpacity: 0.7, shadowBlur: 8, shadowAngle: -45,
    positionX: 50, positionY: 72, highlight: true, highlightBox: false, boxTextColor: '#111111', dimUpcoming: false, animationIn: 'none', animationOut: 'none',
    textCase: 'upper', stripPunctuation: true, wordsPerPage: 3, maxCharsPerLine: 16, activeScale: 1,
  };
  await fetch(`${BASE}/api/projects/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(start) });

  const browser = await chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    acceptDownloads: true,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200));
  });
  page.on('dialog', (d) => d.accept());
  const restore = () =>
    fetch(`${BASE}/api/projects/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(original) });
  try {
    await page.goto(`${BASE}/editor/${id}`);
    await page.waitForSelector('[data-track=text] > [data-item]', { timeout: 30000 });
    await page.waitForFunction(() => !!window.__verticut);
    await page.waitForTimeout(2500);

    const left = page.locator('aside >> nth=0');
    const right = page.locator('aside >> nth=1');
    const results = [];
    const D = (expr) =>
      page.evaluate((e) => {
        const s = window.__verticut.useEditor.getState();
        return JSON.parse(JSON.stringify(new Function('d', 's', 'p', 'return ' + e)(s.doc, s, window.__verticut.usePlayback.getState()) ?? null));
      }, expr);
    const subSig = () =>
      page.evaluate(() => {
        const el = document.querySelector('[data-subtitle]');
        if (!el) return 'no subtitle';
        const cs = getComputedStyle(el);
        return [
          el.innerText.replace(/\s+/g, ' '),
          cs.fontFamily,
          cs.fontSize,
          cs.color,
          cs.webkitTextStrokeWidth,
          cs.webkitTextStrokeColor,
          cs.textShadow,
          cs.letterSpacing,
          cs.textDecorationLine,
          el.style.left,
          el.style.top,
          [...el.querySelectorAll('[data-w]')]
            .map(
              (w) =>
                w.style.color +
                '/' +
                w.style.opacity +
                '/' +
                (w.querySelector('[data-box]') ? w.querySelector('[data-box]').style.opacity + w.querySelector('[data-box]').style.background : ''),
            )
            .join(','),
        ].join('|');
      });
    const textSig = () =>
      page.evaluate(() => {
        const c = document.querySelector('[data-text]');
        if (!c) return 'no text';
        let h = 0;
        const u = c.toDataURL();
        for (let i = 0; i < u.length; i += 97) h = (h * 31 + u.charCodeAt(i)) | 0;
        return [c.width, c.height, c.style.left, c.style.top, h].join('|');
      });
    const ovSig = () =>
      page.evaluate(() => {
        const o = document.querySelector('[data-overlay]');
        if (!o) return 'no overlay';
        const r = o.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height].map((v) => Math.round(v)).join('|') + '|' + o.style.opacity;
      });

    /** Runs `action` and waits (max 600 ms) for every reader to change. */
    async function check(group, name, action, readers, ok) {
      const label = `${group} › ${name}`;
      if (ONLY && !ONLY.test(label)) return;
      const list = Array.isArray(readers) ? readers : [readers];
      let before,
        after,
        err = null,
        pass = false,
        ms = 0;
      try {
        before = await Promise.all(list.map((r) => r()));
        const t0 = Date.now();
        await action();
        for (let i = 0; i < 24; i++) {
          after = await Promise.all(list.map((r) => r()));
          ms = Date.now() - t0;
          pass = ok ? await ok(before, after) : before.every((b, k) => JSON.stringify(b) !== JSON.stringify(after[k]));
          if (pass) break;
          await page.waitForTimeout(25);
        }
      } catch (e) {
        err = String(e.message || e)
          .split('\n')[0]
          .slice(0, 160);
      }
      results.push({ label, pass: pass && !err, ms, err, before, after });
      if (!pass || err) console.log('FAIL', label, err ? '→ ' + err : `→ no change: ${JSON.stringify(before).slice(0, 110)}`);
    }

    // ---- helpers to reach controls by their visible name
    const sliderRow = (panel, label) => panel.locator('div.flex.h-7', { has: page.locator(`input[type=number][aria-label="${label}"]`) }).first();
    const setSlider = async (panel, label, frac) => {
      const r = sliderRow(panel, label).locator('input[type=range]');
      await r.scrollIntoViewIfNeeded();
      const b = await r.boundingBox();
      await page.mouse.click(b.x + 5 + (b.width - 10) * frac, b.y + b.height / 2);
    };
    const rowOf = (panel, label) => panel.locator('div.flex.min-h-7', { has: page.locator(`span[title="${label}"]`) }).first();
    const setColor = (panel, label, value) => rowOf(panel, label).locator('input[type=color]').fill(value);
    const toggle = (panel, label) => panel.getByRole('switch', { name: label }).click();
    /** A section that is switched on with a checkbox (Trazo, Sombra, Fondo…). */
    const sectionOf = (panel, title) => panel.locator('section', { has: page.getByRole('checkbox', { name: title, exact: true }) }).first();
    const checkbox = (panel, title) => panel.getByRole('checkbox', { name: title, exact: true }).click();
    const mini = (panel, label) => panel.getByRole('button', { name: label, exact: true }).click();
    const button = (panel, name) => panel.getByRole('button', { name, exact: true }).first().click();
    const tab = (name) => page.click(`[data-inspector-tab=${name}]`);
    const tool = (name) => page.click(`[data-tool-tab=${name}]`);
    const seekTo = async (t) => {
      await page.evaluate((t) => {
        window.__verticut.player.pause();
        window.__verticut.player.seek(t);
      }, t);
      await page.waitForTimeout(150);
    };
    const select = (sel) => page.evaluate((sel) => window.__verticut.useEditor.getState().setSelection(sel), sel);
    const undo = async () => {
      await page.evaluate(() => window.__verticut.useEditor.getState().undo());
      await page.waitForTimeout(60);
    };
    const time = () => D('p.time');

    await seekTo(3);

    // =================================================== player
    await check(
      'Reproductor',
      'botón reproducir',
      () => page.click('button[aria-label^="Reproducir"]'),
      () => D('p.playing'),
    );
    await check('Reproductor', 'el tiempo avanza', () => page.waitForTimeout(300), time);
    await check(
      'Reproductor',
      'botón pausar',
      () => page.click('button[aria-label^="Pausar"]'),
      () => D('p.playing'),
    );
    await check('Reproductor', 'ir al final', () => page.click('button[aria-label^="Ir al final"]'), time);
    await check('Reproductor', 'ir al principio', () => page.click('button[aria-label^="Ir al principio"]'), time);
    await check(
      'Teclado',
      'espacio reproduce',
      () => page.keyboard.press('Space'),
      () => D('p.playing'),
    );
    await check(
      'Teclado',
      'espacio pausa',
      () => page.keyboard.press('Space'),
      () => D('p.playing'),
    );
    await check('Teclado', 'flecha derecha (1 fotograma)', () => page.keyboard.press('ArrowRight'), time);
    await check('Teclado', 'Shift + flecha (1 segundo)', () => page.keyboard.press('Shift+ArrowRight'), time);
    await check('Teclado', 'Fin', () => page.keyboard.press('End'), time);
    await check('Teclado', 'Inicio', () => page.keyboard.press('Home'), time);
    await seekTo(3);

    // =================================================== top bar
    const nameInput = page.locator('input[aria-label="Nombre del proyecto"]');
    await check(
      'Barra superior',
      'nombre del proyecto',
      async () => {
        await nameInput.fill('Auditoría');
      },
      () => D('d.name'),
    );
    await page.locator('[data-timeline]').click({ position: { x: 700, y: 20 } });
    await check(
      'Barra superior',
      'deshacer',
      () => page.click('button[aria-label^="Deshacer"]'),
      () => D('d.name'),
    );
    await check(
      'Barra superior',
      'rehacer',
      () => page.click('button[aria-label^="Rehacer"]'),
      () => D('d.name'),
    );
    await check(
      'Teclado',
      'Ctrl + Z',
      () => page.keyboard.press('Control+z'),
      () => D('d.name'),
    );
    await check(
      'Teclado',
      'Ctrl + Shift + Z',
      () => page.keyboard.press('Control+Shift+z'),
      () => D('d.name'),
    );
    await undo();
    const stageX = () => page.evaluate(() => Math.round(document.querySelector('[data-stage]').getBoundingClientRect().left));
    await check('Barra superior', 'reproductor a la derecha', () => page.click('button[aria-label="Reproductor a la derecha"]'), stageX);
    await check('Barra superior', 'reproductor en el centro', () => page.click('button[aria-label="Reproductor en el centro"]'), stageX);
    const tlH = () => page.evaluate(() => Math.round(document.querySelector('[data-timeline]').getBoundingClientRect().height));
    await check(
      'Paneles',
      'arrastrar el borde de la línea de tiempo',
      async () => {
        const s = await page.locator('[role=separator][aria-orientation=horizontal]').boundingBox();
        await page.mouse.move(s.x + 400, s.y + 2);
        await page.mouse.down();
        await page.mouse.move(s.x + 400, s.y - 70, { steps: 4 });
        await page.mouse.up();
      },
      tlH,
    );
    await check('Barra superior', 'restablecer paneles', () => page.click('button[aria-label="Restablecer el tamaño de los paneles"]'), tlH);
    await check(
      'Barra superior',
      'ayuda de atajos',
      () => page.click('button[aria-label^="Atajos"]'),
      () => page.locator('[role=dialog], .fixed.inset-0').count(),
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    if (await page.locator('.fixed.inset-0').count()) await page.mouse.click(5, 5);
    await check(
      'Barra superior',
      'descargar proyecto',
      async () => {
        const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 4000 }), page.click('button[aria-label^="Descargar proyecto"]')]);
        globalThis.__dl = dl.suggestedFilename();
      },
      () => Promise.resolve(globalThis.__dl || null),
    );
    await check(
      'Barra superior',
      'exportar abre el diálogo',
      () => page.click('button:has-text("Exportar")'),
      () => page.locator('button:has-text("Exportar MP4")').count(),
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    if (await page.locator('button:has-text("Exportar MP4")').count()) await page.mouse.click(5, 5);
    await page.waitForTimeout(150);

    // =================================================== timeline
    const firstW = () => page.evaluate(() => Math.round(document.querySelector('[data-track=text] > [data-item]').getBoundingClientRect().width));
    await check('Línea de tiempo', 'acercar', () => page.click('button[aria-label="Acercar"]'), firstW);
    await check('Línea de tiempo', 'alejar', () => page.click('button[aria-label="Alejar"]'), firstW);
    await check(
      'Línea de tiempo',
      'deslizador de zoom',
      async () => {
        const r = page.locator('[data-timeline] input[type=range]');
        const b = await r.boundingBox();
        await page.mouse.click(b.x + b.width * 0.2, b.y + b.height / 2);
      },
      firstW,
    );
    await check('Línea de tiempo', 'ajustar al ancho', () => page.click('button[aria-label="Ajustar al ancho"]'), firstW);
    await check(
      'Línea de tiempo',
      'clic en la regla mueve el cursor',
      async () => {
        const r = await page.locator('[data-timeline] .cursor-ew-resize').first().boundingBox();
        await page.mouse.click(r.x + 200, r.y + 6);
      },
      time,
    );
    await check(
      'Línea de tiempo',
      'seleccionar un clip',
      () =>
        page
          .locator('[data-track=main] > div.absolute')
          .nth(1)
          .click({ position: { x: 30, y: 20 } }),
      () => D('s.selection'),
    );
    await seekTo(6);
    await check(
      'Línea de tiempo',
      'dividir (botón)',
      () => page.click('button[aria-label^="Dividir"]'),
      () => D('d.clips.length'),
    );
    await undo();
    await check(
      'Teclado',
      'S divide',
      () => page.keyboard.press('s'),
      () => D('d.clips.length'),
    );
    await undo();
    const cutsOrEdges = () => D('d.clips.map(c => [c.start, c.end, c.cuts.length])');
    await check(
      'Línea de tiempo',
      'borrar izquierda (botón)',
      () => page.click('button[aria-label^="Borrar lo que queda a la izquierda"]'),
      cutsOrEdges,
    );
    await undo();
    await seekTo(6);
    await check('Línea de tiempo', 'borrar derecha (botón)', () => page.click('button[aria-label^="Borrar lo que queda a la derecha"]'), cutsOrEdges);
    await undo();
    await seekTo(6);
    await check('Teclado', 'Q borra a la izquierda', () => page.keyboard.press('q'), cutsOrEdges);
    await undo();
    await seekTo(6);
    await check('Teclado', 'W borra a la derecha', () => page.keyboard.press('w'), cutsOrEdges);
    await undo();
    await page
      .locator('[data-track=main] > div.absolute')
      .nth(1)
      .click({ position: { x: 30, y: 20 } });
    await check('Línea de tiempo', 'eliminar (botón)', () => page.click('button[aria-label^="Eliminar el elemento"]'), cutsOrEdges);
    await undo();
    await page
      .locator('[data-track=main] > div.absolute')
      .nth(1)
      .click({ position: { x: 30, y: 20 } });
    await check('Teclado', 'Supr elimina', () => page.keyboard.press('Delete'), cutsOrEdges);
    await undo();
    await check(
      'Teclado',
      'Ctrl + A selecciona todo',
      () => page.keyboard.press('Control+a'),
      () => D('s.selection'),
    );
    await check(
      'Teclado',
      'Esc quita la selección',
      () => page.keyboard.press('Escape'),
      () => D('s.selection'),
    );
    await check(
      'Línea de tiempo',
      'mover un texto arrastrando',
      async () => {
        const b = await page.locator('[data-track=text] > [data-item]').first().boundingBox();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2, { steps: 5 });
        await page.mouse.up();
      },
      () => D('d.texts[0].start'),
    );
    await undo();
    await check(
      'Línea de tiempo',
      'recortar un texto por el borde',
      async () => {
        const b = await page.locator('[data-track=text] > [data-item]').first().boundingBox();
        await page.mouse.move(b.x + b.width - 2, b.y + b.height / 2);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width - 50, b.y + b.height / 2, { steps: 5 });
        await page.mouse.up();
      },
      () => D('d.texts[0].duration'),
    );
    await undo();
    await check(
      'Línea de tiempo',
      'recortar un clip por el borde',
      async () => {
        const b = await page.locator('[data-track=main] > div.absolute').nth(2).boundingBox();
        await page.mouse.move(b.x + b.width - 2, b.y + b.height / 2);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width - 40, b.y + b.height / 2, { steps: 5 });
        await page.mouse.up();
      },
      cutsOrEdges,
    );
    await undo();
    await page.keyboard.press('Escape');
    await seekTo(3);

    // =================================================== right: subtitles
    await tab('subtitles');
    const S = (k) => () => D(`d.subtitles.${k}`);
    await check('Subtítulos', 'quitar los subtítulos (interruptor)', () => toggle(right, 'Mostrar los subtítulos en el vídeo'), [
      S('enabled'),
      subSig,
    ]);
    await check('Subtítulos', 'añadir subtítulos automáticamente (botón)', () => page.click('[data-auto-subtitles]'), [S('enabled'), subSig]);
    await page.locator('[data-timeline]').click({ position: { x: 700, y: 20 } });
    await check('Teclado', 'G quita los subtítulos', () => page.keyboard.press('g'), [S('enabled'), subSig]);
    await check('Teclado', 'G los vuelve a poner', () => page.keyboard.press('g'), [S('enabled'), subSig]);
    await check('Subtítulos', 'palabras por subtítulo: 1 (cambian los bloques)', () => button(rowOf(right, 'Palabras'), '1'), [
      S('wordsPerPage'),
      () => page.locator('[data-track=subs] > [data-sub]').count(),
    ]);
    for (const n of ['2', '4', '5', '6', '3'])
      await check('Subtítulos', `palabras por subtítulo: ${n}`, () => button(rowOf(right, 'Palabras'), n), S('wordsPerPage'));
    await check('Subtítulos', 'letras por línea', () => setSlider(right, 'Letras por línea', 0.9), S('maxCharsPerLine'));
    // The ready-made styles live in their own sub-tab.
    await check(
      'Subtítulos',
      'subpestaña Estilos',
      () => right.locator('[data-subtitle-tabs]').getByRole('button', { name: 'Estilos', exact: true }).click(),
      () => page.locator('[data-subtitle-preset]').count(),
    );
    for (const preset of ['amarillo', 'limpio', 'clasico', 'titular', 'pop', 'una-palabra', 'caja', 'karaoke', 'caja-amarilla', 'montserrat']) {
      await check('Subtítulos', `estilo rápido «${preset}»`, () => page.click(`[data-subtitle-preset=${preset}]`), [() => D('d.subtitles'), subSig]);
    }
    await check(
      'Subtítulos',
      'subpestaña Básico',
      () => right.locator('[data-subtitle-tabs]').getByRole('button', { name: 'Básico', exact: true }).click(),
      () => page.locator('[data-subtitle-preset]').count(),
    );
    await check(
      'Subtítulos',
      'por defecto: Montserrat sin trazo',
      () => Promise.resolve(),
      () => D('[d.subtitles.fontId, d.subtitles.outlineWidth]'),
      (b, a) => a[0][0] === 'montserrat-bold' && a[0][1] === 0,
    );
    await check(
      'Subtítulos',
      'fuente (buscador)',
      async () => {
        await right.locator('button[aria-label="Fuente"]').click();
        await page.fill('[data-font-list] input', 'poppins bold');
        await page.keyboard.press('Enter');
      },
      [S('fontId'), subSig],
    );
    await check('Subtítulos', 'tamaño', () => setSlider(right, 'Tamaño', 0.7), [S('fontSize'), subSig]);
    await check('Subtítulos', 'diseño: quitar negrita', () => mini(right, 'Negrita'), [S('fontId'), subSig]);
    await check('Subtítulos', 'diseño: cursiva', () => mini(right, 'Cursiva'), [S('fontId'), subSig]);
    await check('Subtítulos', 'diseño: subrayado', () => mini(right, 'Subrayado'), [S('underline'), subSig]);
    await mini(right, 'Subrayado');
    await check('Subtítulos', 'minúsculas (tt)', () => mini(right, 'todo en minúsculas'), [S('textCase'), subSig]);
    await check('Subtítulos', 'Primera En Mayúscula (Tt)', () => mini(right, 'Primera Letra En Mayúscula'), [S('textCase'), subSig]);
    await check('Subtítulos', 'MAYÚSCULAS (TT)', () => mini(right, 'TODO EN MAYÚSCULAS'), [S('textCase'), subSig]);
    await check('Subtítulos', 'color', () => setColor(right, 'Color', '#33ccff'), [S('textColor'), subSig]);
    await check('Subtítulos', 'separación de caracteres', () => setSlider(right, 'Carácter', 0.6), [S('letterSpacing'), subSig]);
    await check('Subtítulos', 'trazo (casilla)', () => checkbox(right, 'Trazo'), [S('outlineWidth'), subSig]);
    await check('Subtítulos', 'color del trazo', () => setColor(sectionOf(right, 'Trazo'), 'Color', '#aa0000'), [S('outlineColor'), subSig]);
    await check('Subtítulos', 'grosor del trazo', () => setSlider(sectionOf(right, 'Trazo'), 'Grosor', 0.8), [S('outlineWidth'), subSig]);
    await check('Subtítulos', 'sombra (quitar)', () => checkbox(right, 'Sombra'), [S('shadowOn'), subSig]);
    await check('Subtítulos', 'sombra (poner)', () => checkbox(right, 'Sombra'), [S('shadowOn'), subSig]);
    await check('Subtítulos', 'color de la sombra', () => setColor(sectionOf(right, 'Sombra'), 'Color', '#220066'), [S('shadowColor'), subSig]);
    await check('Subtítulos', 'opacidad de la sombra', () => setSlider(right, 'Opacidad', 0.3), [S('shadowOpacity'), subSig]);
    await check('Subtítulos', 'desenfoque de la sombra', () => setSlider(right, 'Desenfoque', 0.7), [S('shadowBlur'), subSig]);
    await check('Subtítulos', 'distancia de la sombra', () => setSlider(right, 'Distancia', 0.6), [S('shadow'), subSig]);
    await check('Subtítulos', 'ángulo de la sombra', () => setSlider(right, 'Ángulo', 0.8), [S('shadowAngle'), subSig]);
    await check('Subtítulos', 'resaltar la palabra (apagar)', () => checkbox(right, 'Resaltar la palabra que suena'), [S('highlight'), subSig]);
    await check('Subtítulos', 'resaltar la palabra (encender)', () => checkbox(right, 'Resaltar la palabra que suena'), [S('highlight'), subSig]);
    await check('Subtítulos', 'resaltado en caja', () => button(right, 'Caja'), [S('highlightBox'), subSig]);
    await check('Subtítulos', 'color de la caja', () => setColor(right, 'Color de la caja', '#ff00aa'), [S('highlightColor'), subSig]);
    await check('Subtítulos', 'color del texto en la caja', () => setColor(right, 'Texto en la caja', '#ffffff'), [S('boxTextColor'), subSig]);
    await check('Subtítulos', 'resaltado por color', () => button(right, 'Color'), [S('highlightBox'), subSig]);
    await check('Subtítulos', 'agrandar la palabra', () => setSlider(right, 'Agrandar', 0.8), S('activeScale'));
    await check('Subtítulos', 'quitar puntuación', () => toggle(right, 'Quitar puntuación'), S('stripPunctuation'));
    // Dimming only shows while a block still has words to come: go to the first word of a block of several.
    for (let t = 0.5; t < 15; t += 0.1) {
      await page.evaluate((t) => window.__verticut.player.seek(t), t);
      const first = await page.evaluate(() => {
        const w = [...document.querySelectorAll('[data-subtitle] [data-w]')];
        return w.length >= 2 && !!w[0].style.color && !w[1].style.color;
      });
      if (first) break;
    }
    await check('Subtítulos', 'atenuar pendientes', () => toggle(right, 'Atenuar las palabras que aún no se han dicho'), [S('dimUpcoming'), subSig]);
    await seekTo(3);
    for (const pos of ['Arriba', 'Centro', 'Abajo']) await check('Subtítulos', `posición ${pos}`, () => button(right, pos), [S('positionY'), subSig]);
    await check('Subtítulos', 'posición horizontal', () => setSlider(right, 'Horizontal', 0.3), [S('positionX'), subSig]);
    await check('Subtítulos', 'posición vertical', () => setSlider(right, 'Vertical', 0.4), [S('positionY'), subSig]);
    await check(
      'Subtítulos',
      'botón «Elegir animación»',
      () => right.getByRole('button', { name: 'Elegir animación' }).click(),
      () => D('s.inspectorTab'),
    );
    await tab('subtitles');
    await check(
      'Subtítulos',
      '«Usar mi guión» abre el diálogo',
      () => right.getByRole('button', { name: 'Usar mi guión' }).click(),
      () => page.locator('.fixed.inset-0').count(),
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    if (await page.locator('.fixed.inset-0').count()) await page.mouse.click(5, 5);
    await check(
      'Subtítulos',
      'arrastrar el subtítulo en el vídeo',
      async () => {
        const b = await page.locator('[data-subtitle]').boundingBox();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width / 2 + 20, b.y + b.height / 2 + 40, { steps: 4 });
        await page.mouse.up();
      },
      [S('positionY'), subSig],
    );
    await check(
      'Subtítulos',
      'doble clic edita el texto en el vídeo',
      async () => {
        await page.locator('[data-subtitle]').dblclick();
        await page.keyboard.type('CAMBIADO AQUI');
        await page.keyboard.press('Enter');
      },
      [() => D('Object.keys(d.words).length'), subSig],
    );
    await page.keyboard.press('Escape');

    // =================================================== right: animation (subtitles)
    await tab('animation');
    for (const a of ['fade', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'zoom', 'pop', 'blur', 'rotate', 'typewriter', 'drop', 'none'])
      await check('Animación', `subtítulos: ${a}`, () => page.click(`[data-animation-group=subtitles] [data-animation=${a}]`), S('animationIn'));
    await check('Animación', 'desvanecer al salir', () => toggle(right, 'Desvanecer al salir'), S('animationOut'));

    // =================================================== right: text
    await seekTo(3);
    await page
      .locator('[data-track=text] > [data-item]')
      .first()
      .click({ position: { x: 12, y: 8 } });
    await page.waitForTimeout(200);
    const X = (k) => () => D(`d.texts[0].${k}`);
    await check(
      'Texto',
      'al seleccionar se abre su pestaña',
      () => Promise.resolve(),
      () => D('s.inspectorTab'),
      (b, a) => a[0] === 'video',
    );
    await check('Texto', 'escribir el texto', () => right.locator('textarea').fill('Hola mundo'), [X('text'), textSig]);
    await check('Texto', 'diseño: quitar negrita', () => mini(right, 'Negrita'), [X('fontId'), textSig]);
    await check('Texto', 'diseño: cursiva', () => mini(right, 'Cursiva'), [X('fontId'), textSig]);
    await check(
      'Texto',
      'fuente',
      async () => {
        await right.locator('button[aria-label="Fuente"]').click();
        await page.fill('[data-font-list] input', 'anton');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(250);
      },
      [X('fontId'), textSig],
    );
    await check('Texto', 'color', () => setColor(right, 'Color', '#00ff88'), [X('color'), textSig]);
    await check('Texto', 'separación de caracteres', () => setSlider(right, 'Carácter', 0.5), [X('letterSpacing'), textSig]);
    await check('Texto', 'tamaño', () => setSlider(right, 'Tamaño', 0.5), [X('scale'), textSig]);
    await check('Texto', 'giro', () => setSlider(right, 'Giro', 0.6), [X('rotation'), textSig]);
    await check('Texto', 'color del trazo', () => setColor(sectionOf(right, 'Trazo'), 'Color', '#0000ff'), [X('outlineColor'), textSig]);
    await check('Texto', 'grosor del trazo', () => setSlider(sectionOf(right, 'Trazo'), 'Grosor', 0.7), [X('outlineWidth'), textSig]);
    await check('Texto', 'trazo (quitar)', () => checkbox(right, 'Trazo'), [X('outlineWidth'), textSig]);
    await check('Texto', 'color de la sombra', () => setColor(sectionOf(right, 'Sombra'), 'Color', '#550000'), [X('shadowColor'), textSig]);
    await check('Texto', 'opacidad de la sombra', () => setSlider(right, 'Opacidad', 0.4), [X('shadowOpacity'), textSig]);
    await check('Texto', 'desenfoque de la sombra', () => setSlider(right, 'Desenfoque', 0.6), [X('shadowBlur'), textSig]);
    await check('Texto', 'distancia de la sombra', () => setSlider(right, 'Distancia', 0.7), [X('shadow'), textSig]);
    await check('Texto', 'ángulo de la sombra', () => setSlider(right, 'Ángulo', 0.2), [X('shadowAngle'), textSig]);
    await check('Texto', 'sombra (quitar)', () => checkbox(right, 'Sombra'), [X('shadowOn'), textSig]);
    await check('Texto', 'fondo (encender)', () => checkbox(right, 'Fondo'), [X('bgColor'), textSig]);
    await check('Texto', 'color del fondo', () => setColor(sectionOf(right, 'Fondo'), 'Color', '#ff3355'), [X('bgColor'), textSig]);
    await check('Texto', 'esquinas del fondo', () => setSlider(right, 'Esquinas', 0.9), [X('bgRadius'), textSig]);
    await check('Texto', 'margen del fondo', () => setSlider(right, 'Margen', 0.8), [X('bgPadding'), textSig]);
    await check('Texto', 'fondo (apagar)', () => checkbox(right, 'Fondo'), [X('bgColor'), textSig]);
    for (const shape of ['Arco', 'Círculo', 'Onda', 'Recto'])
      await check('Texto', `forma ${shape}`, () => button(right, shape), [() => D('[d.texts[0].curve, d.texts[0].curveAmount]'), textSig]);
    await button(right, 'Arco');
    await check('Texto', 'curvatura', () => setSlider(right, 'Curvatura', 0.9), [X('curveAmount'), textSig]);
    await button(right, 'Recto');
    await check('Texto', 'posición horizontal', () => setSlider(right, 'Horizontal', 0.3), [X('x'), textSig]);
    await check('Texto', 'posición vertical', () => setSlider(right, 'Vertical', 0.6), [X('y'), textSig]);
    await check('Texto', 'centrar a lo ancho', () => right.getByRole('button', { name: 'Ancho' }).click(), [X('x'), textSig]);
    await check('Texto', 'centrar a lo alto', () => right.getByRole('button', { name: 'Alto' }).click(), [X('y'), textSig]);
    const secs = (label) => rowOf(right, label).locator('input[type=number]');
    await check('Texto', 'empieza en', () => secs('Empieza en').fill('2.5'), X('start'));
    await check('Texto', 'duración', () => secs('Duración').fill('3.5'), X('duration'));
    await check(
      'Texto',
      'arrastrar en el vídeo',
      async () => {
        const b = await page.locator('[data-text]').boundingBox();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width / 2 + 30, b.y + b.height / 2 - 50, { steps: 4 });
        await page.mouse.up();
      },
      [X('y'), textSig],
    );
    await check(
      'Texto',
      'cambiar tamaño con el asa',
      async () => {
        const h = await page.locator('[data-handle=scale]').nth(3).boundingBox();
        const s = await page.locator('[data-selection-box]').boundingBox();
        await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
        await page.mouse.down();
        await page.mouse.move(s.x + s.width / 2 + (h.x - s.x - s.width / 2) * 1.5, s.y + s.height / 2 + (h.y - s.y - s.height / 2) * 1.5, {
          steps: 5,
        });
        await page.mouse.up();
      },
      [X('scale'), textSig],
    );
    await check(
      'Texto',
      'girar con el asa',
      async () => {
        const h = await page.locator('[data-handle=rotate]').boundingBox();
        await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
        await page.mouse.down();
        await page.mouse.move(h.x + h.width / 2 + 70, h.y + h.height / 2 + 30, { steps: 5 });
        await page.mouse.up();
      },
      [X('rotation'), textSig],
    );
    await check(
      'Texto',
      'botón «Animación de entrada y salida»',
      () => right.getByRole('button', { name: 'Animación de entrada y salida' }).click(),
      () => D('s.inspectorTab'),
    );
    for (const a of ['fade', 'zoom', 'zoom-out', 'pop', 'slide-up', 'slide-down', 'slide-left', 'slide-right'])
      await check('Animación', `texto, entrada: ${a}`, () => page.click(`[data-animation-group=text-in] [data-animation=${a}]`), X('animIn'));
    for (const a of ['fade', 'zoom', 'zoom-out', 'pop', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'none'])
      await check('Animación', `texto, salida: ${a}`, () => page.click(`[data-animation-group=text-out] [data-animation=${a}]`), X('animOut'));
    await check(
      'Animación',
      'la entrada se ve al reproducir',
      async () => {
        await seekTo(2.5);
        await page.keyboard.press('Space');
        await page.waitForTimeout(120);
      },
      () => page.evaluate(() => document.querySelector('[data-text]')?.style.transform || ''),
    );
    await page.keyboard.press('Space');
    await seekTo(3);
    await tab('video');
    await check(
      'Texto',
      'eliminar texto',
      () => right.getByRole('button', { name: 'Eliminar texto' }).click(),
      () => D('d.texts.length'),
    );
    await undo();

    // =================================================== right: overlay
    // Nothing else on top of the overlay: the subtitle and the text are moved away.
    await page.evaluate(() =>
      window.__verticut.useEditor.getState().commit((d) => {
        d.subtitles.positionX = 50;
        d.subtitles.positionY = 88;
        d.texts[0].x = 0.5;
        d.texts[0].y = 0.08;
        d.texts[0].scale = 0.6;
        d.texts[0].rotation = 0;
      }),
    );
    await seekTo(3);
    await page
      .locator('[data-track=broll] > [data-item]')
      .first()
      .click({ position: { x: 12, y: 10 } });
    await page.waitForTimeout(200);
    const O = (k) => () => D(`d.broll[0].${k}`);
    await check('Superposición', 'tamaño', () => setSlider(right, 'Tamaño', 0.3), [O('scale'), ovSig]);
    await check('Superposición', 'posición horizontal', () => setSlider(right, 'Horizontal', 0.7), [O('x'), ovSig]);
    await check('Superposición', 'posición vertical', () => setSlider(right, 'Vertical', 0.3), [O('y'), ovSig]);
    await check('Superposición', 'centrar a lo ancho', () => right.getByRole('button', { name: 'Ancho' }).click(), [O('x'), ovSig]);
    await check('Superposición', 'centrar a lo alto', () => right.getByRole('button', { name: 'Alto' }).click(), [O('y'), ovSig]);
    await check('Superposición', 'pantalla completa', () => right.getByRole('button', { name: 'Pantalla completa' }).click(), [O('scale'), ovSig]);
    await undo();
    await check(
      'Superposición',
      'arrastrar en el vídeo',
      async () => {
        const b = await page.locator('[data-overlay]').boundingBox();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width / 2 + 25, b.y + b.height / 2 + 35, { steps: 4 });
        await page.mouse.up();
      },
      [O('y'), ovSig],
    );
    await check(
      'Superposición',
      'cambiar tamaño con el asa',
      async () => {
        const h = await page.locator('[data-handle=scale]').nth(0).boundingBox();
        const s = await page.locator('[data-selection-box]').boundingBox();
        await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
        await page.mouse.down();
        await page.mouse.move(h.x + h.width / 2 + s.width * 0.2, h.y + h.height / 2 + s.height * 0.2, { steps: 5 });
        await page.mouse.up();
      },
      [O('scale'), ovSig],
    );
    await check('Superposición', 'empieza en', () => secs('Empieza en').fill('2.2'), O('start'));
    await check('Superposición', 'duración', () => secs('Duración').fill('3.3'), O('duration'));
    await check(
      'Superposición',
      'eliminar',
      () => right.getByRole('button', { name: 'Eliminar superposición' }).click(),
      () => D('d.broll.length'),
    );
    await undo();

    // =================================================== right: clip, project, speed
    await page
      .locator('[data-track=main] > div.absolute')
      .nth(1)
      .click({ position: { x: 30, y: 20 } });
    await tab('video');
    await check(
      'Clip',
      'botón «Voz y música» lleva a Audio',
      () => right.getByRole('button', { name: 'Voz y música' }).click(),
      () => D('s.inspectorTab'),
    );
    await tab('video');
    await check('Clip', 'eliminar este fragmento', () => right.getByRole('button', { name: 'Eliminar este fragmento' }).click(), cutsOrEdges);
    await undo();
    await page.keyboard.press('Escape');
    await tab('video');
    await check('Proyecto', 'fondo borroso', () => button(right, 'Fondo borroso'), [
      () => D('d.settings.fitMode'),
      () => page.evaluate(() => document.querySelector('[data-stage] canvas').className),
    ]);
    await check('Proyecto', 'rellenar', () => button(right, 'Rellenar'), [
      () => D('d.settings.fitMode'),
      () => page.evaluate(() => document.querySelector('[data-stage] canvas').className),
    ]);
    await tab('speed');
    const dur = () => D('p.duration');
    for (const sp of ['0.5', '0.75', '1.25', '1.5', '2', '3', '1'])
      await check('Velocidad', `${sp}×`, () => page.click(`[data-speed="${sp}"]`), [() => D('d.clips.map(c => c.speed || 1)'), dur]);
    await check('Velocidad', 'deslizador', () => setSlider(right, 'Velocidad', 0.5), [() => D('d.clips.map(c => c.speed || 1)'), dur]);
    await page.click('[data-speed="1"]');

    // =================================================== right: smart
    await tab('smart');
    await page.evaluate(() =>
      window.__verticut.useEditor.getState().commit((d) => {
        for (const c of d.clips) c.cuts = [];
      }),
    );
    await check(
      'Inteligente',
      'pausas de más de…',
      () => setSlider(right, 'Pausas de más de', 0.1),
      () => D('d.settings.silenceMin'),
    );
    await check(
      'Inteligente',
      'quitar silencios',
      () => page.click('[data-smart=silence]'),
      () => D('d.clips.map(c => c.cuts.length)'),
    );
    await check(
      'Inteligente',
      'recuperar los silencios',
      () => right.getByRole('button', { name: 'Recuperarlos' }).click(),
      () => D('d.clips.map(c => c.cuts.length)'),
    );
    await check(
      'Inteligente',
      'quitar los subtítulos',
      () => page.click('[data-smart=subtitles]'),
      () => D('d.subtitles.enabled'),
    );
    await check(
      'Inteligente',
      'añadir subtítulos a todo el vídeo',
      () => page.click('[data-smart=subtitles]'),
      () => D('d.subtitles.enabled'),
    );
    await check(
      'Inteligente',
      'quitar muletillas',
      () => page.click('[data-smart=filler]'),
      () => D('d.clips.map(c => c.cuts.length)'),
    );
    await check(
      'Inteligente',
      'quitar tomas repetidas',
      () => page.click('[data-smart=retake]'),
      () => page.locator('text=/toma|repetid/i').count(),
      (b, a) => a[0] > 0,
    );
    await page.evaluate(() =>
      window.__verticut.useEditor.getState().commit((d) => {
        for (const c of d.clips) c.cuts = [];
        d.settings.silenceMin = 0.4;
      }),
    );

    // =================================================== right: audio
    await tab('audio');
    await check('Audio', 'volumen de los vídeos', () => setSlider(right, 'Volumen', 0.4), [
      () => D('d.settings.mainVolume'),
      () => page.evaluate(() => window.__verticut.player.soundState().plain ?? window.__verticut.player.soundState().elementVolume),
    ]);
    await setSlider(right, 'Volumen', 1);
    if (await right.locator('button:has-text("Sin música")').count()) {
      const mixer = () =>
        page.evaluate(() => {
          const s = window.__verticut.player.soundState();
          return [s.plain, s.voice, s.music];
        });
      await check('Audio', 'sin música', () => button(right, 'Sin música'), [() => D('d.audioMix'), mixer]);
      await check('Audio', 'sin voz', () => button(right, 'Sin voz'), [() => D('d.audioMix'), mixer]);
      await check('Audio', 'deslizador de voz', () => setSlider(right, 'Voz', 0.6), [() => D('d.audioMix'), mixer]);
      await check('Audio', 'deslizador de música', () => setSlider(right, 'Música', 0.3), [() => D('d.audioMix'), mixer]);
      await check('Audio', 'original', () => button(right, 'Original'), [() => D('d.audioMix'), mixer]);
    } else console.log('NOTE  voz y música sin separar en este proyecto: sus controles se comprueban en audit-sound');

    // =================================================== left panel
    await tool('media');
    await check(
      'Multimedia',
      'botón + añade a la línea de tiempo',
      () => left.locator('button[aria-label="Añadir a la línea de tiempo"]').first().click(),
      () => D('d.clips.length'),
    );
    await undo();
    await check(
      'Multimedia',
      'arrastrar a la pista de superposición',
      () => page.dragAndDrop('aside >> nth=0 >> div[draggable=true] >> nth=1', '[data-track=broll]', { targetPosition: { x: 500, y: 20 } }),
      () => D('d.broll.length'),
    );
    await undo();

    await tool('text');
    await check(
      'Texto (izquierda)',
      'separar cada 2 palabras',
      async () => {
        await left.locator('textarea').fill('uno dos tres cuatro');
        await button(left, '2 palabras');
      },
      () => left.locator('button:has-text("Añadir")').innerText(),
    );
    await check(
      'Texto (izquierda)',
      'forma Onda',
      () => button(left, 'Onda'),
      () => left.locator('button:has-text("Onda")').getAttribute('class'),
    );
    await check(
      'Texto (izquierda)',
      'añadir bloques',
      () => left.locator('button:has-text("Añadir")').click(),
      () => D('d.texts.length'),
    );
    await undo();
    await check(
      'Texto (izquierda)',
      'dictar con el micrófono',
      async () => {
        await left.locator('textarea').fill('');
        await left.getByRole('button', { name: 'Dictar' }).click();
        await page.waitForTimeout(1500);
        await left.locator('button:has-text("Parar")').click();
        await page.waitForFunction(() => document.querySelector('aside textarea').value.length > 0, null, { timeout: 15000 });
      },
      () => left.locator('textarea').inputValue(),
    );

    await tool('templates');
    await page.waitForSelector('[data-preset=clave] canvas');
    await check('Plantillas', 'añadir una plantilla', () => page.click('[data-preset=clave]'), [() => D('d.texts.length'), () => D('s.selection')]);
    await check(
      'Plantillas',
      'cambiar el seleccionado',
      async () => {
        await left.getByRole('button', { name: 'Cambiar el seleccionado' }).click();
        await page.click('[data-preset=amarilla]');
      },
      () => D('d.texts[d.texts.length - 1].bgColor'),
    );
    await undo();
    await undo();
    await left.getByRole('button', { name: 'Añadir un texto nuevo' }).click();

    await tool('audio');
    await check(
      'Audio (izquierda)',
      'grabar mi voz',
      async () => {
        await left.getByRole('button', { name: 'Grabar mi voz' }).click();
        await page.waitForTimeout(1500);
        await left.locator('button:has-text("Parar"), button:has-text("Detener")').first().click();
        await page.waitForFunction(() => window.__verticut.useEditor.getState().doc.audio.length > 0, null, { timeout: 15000 });
      },
      () => D('d.audio.length'),
    );
    if ((await D('d.audio.length')) > 0) {
      await page
        .locator('[data-track=audio] > [data-item]')
        .first()
        .click({ position: { x: 6, y: 10 } });
      await page.waitForTimeout(200);
      const A = (k) => () => D(`d.audio[0].${k}`);
      await check(
        'Audio (clip de sonido)',
        'al seleccionarlo se abre Audio',
        () => Promise.resolve(),
        () => D('s.inspectorTab'),
        (b, a) => a[0] === 'audio',
      );
      await check('Audio (clip de sonido)', 'volumen', () => setSlider(right, 'Volumen', 0.2), A('volume'));
      await check('Audio (clip de sonido)', 'fundido de entrada', () => setSlider(right, 'Fundido entrada', 0.3), A('fadeIn'));
      await check('Audio (clip de sonido)', 'fundido de salida', () => setSlider(right, 'Fundido salida', 0.3), A('fadeOut'));
      await check(
        'Audio (clip de sonido)',
        'eliminar audio',
        () => right.getByRole('button', { name: 'Eliminar audio' }).click(),
        () => D('d.audio.length'),
      );
    }

    await tool('transcript');
    await page.waitForTimeout(300);
    const cuts = () => D('d.clips.map(c => c.cuts.map(x => x.reason).join(","))');
    await check(
      'Transcripción',
      'idioma',
      () => left.locator('select[title="Idioma de la transcripción"]').selectOption('en'),
      () => D('d.settings.language'),
    );
    await left.locator('select[title="Idioma de la transcripción"]').selectOption('es');
    await check(
      'Transcripción',
      'ajustes de limpieza (abrir)',
      () => left.locator('button[aria-label="Ajustes de limpieza"]').click(),
      () => left.locator('input[type=range]').count(),
    );
    await left.locator('button[aria-label="Ajustes de limpieza"]').click();
    await page.evaluate(() =>
      window.__verticut.useEditor.getState().commit((d) => {
        for (const c of d.clips) c.cuts = [];
      }),
    );
    await check('Transcripción', 'quitar silencios', () => left.getByRole('button', { name: 'Silencios', exact: true }).click(), cuts);
    await check('Transcripción', 'quitar muletillas', () => left.getByRole('button', { name: 'Muletillas', exact: true }).click(), cuts);
    await check(
      'Transcripción',
      'copiar texto',
      () => left.getByRole('button', { name: /Copiar/ }).click(),
      () => page.evaluate(() => navigator.clipboard.readText().catch(() => '')),
      (b, a) => a[0].length > 10,
    );
    await check(
      'Transcripción',
      'descargar TXT',
      async () => {
        const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 4000 }), left.getByRole('button', { name: 'TXT' }).click()]);
        globalThis.__txt = dl.suggestedFilename();
      },
      () => Promise.resolve(globalThis.__txt || null),
    );
    await check(
      'Transcripción',
      'descargar SRT',
      async () => {
        const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 4000 }), left.getByRole('button', { name: 'SRT' }).click()]);
        globalThis.__srt = dl.suggestedFilename();
      },
      () => Promise.resolve(globalThis.__srt || null),
    );
    // =================================================== transcript
    await page.waitForSelector('aside >> nth=0 >> [data-k]');
    const words = left.locator('[data-k]');
    console.log('NOTE  palabras en la transcripción:', await words.count());
    await page.evaluate(() =>
      window.__verticut.useEditor.getState().commit((d) => {
        for (const c of d.clips) c.cuts = [];
        d.words = {};
      }),
    );
    await page.waitForTimeout(200);
    await check('Transcripción', 'clic en una palabra salta a ella', () => words.nth(8).click(), [() => D('p.time'), () => D('s.selection')]);
    await check(
      'Transcripción',
      'Shift + clic amplía la selección',
      () => words.nth(10).click({ modifiers: ['Shift'] }),
      () => D('s.selection'),
    );
    await check(
      'Transcripción',
      'botón Cortar',
      () =>
        left
          .getByRole('button', { name: /Cortar/ })
          .first()
          .click(),
      cuts,
    );
    await words.nth(8).click();
    await words.nth(10).click({ modifiers: ['Shift'] });
    await check(
      'Transcripción',
      'botón Restaurar',
      () =>
        left
          .getByRole('button', { name: /Restaurar$/ })
          .first()
          .click(),
      cuts,
    );
    await words.nth(12).click();
    await check('Transcripción', 'Supr corta la palabra seleccionada', () => page.keyboard.press('Delete'), cuts);
    await undo();
    await words.nth(12).click();
    await check(
      'Transcripción',
      'ocultar en subtítulos',
      () => left.locator('button[aria-label="Ocultar / mostrar en subtítulos"]').click(),
      () => D('Object.values(d.words).filter(w => w.hidden).length'),
    );
    await check(
      'Transcripción',
      'empezar un subtítulo nuevo aquí',
      () => left.locator('button[aria-label="Empezar un subtítulo nuevo aquí"]').click(),
      () => D('Object.values(d.words).filter(w => w.breakBefore).length'),
    );
    await check(
      'Transcripción',
      'reproducir la selección',
      () => left.locator('button[aria-label="Reproducir selección"]').click(),
      () => D('p.playing'),
    );
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__verticut.player.pause());
    await check(
      'Transcripción',
      'quitar selección',
      () => left.locator('button[aria-label^="Quitar selección"]').click(),
      () => D('s.selection'),
    );
    const gap = left.locator('[data-gap]').first();
    if (await gap.count()) await check('Transcripción', 'clic en una pausa la quita o la recupera', () => gap.click(), cuts);
    else console.log('NOTE  no hay etiquetas de pausa visibles');
    await page.evaluate(() =>
      window.__verticut.useEditor.getState().commit((d) => {
        for (const c of d.clips) c.cuts = [];
        d.words = {};
      }),
    );
    await check(
      'Transcripción',
      'tomas repetidas',
      () => left.getByRole('button', { name: 'Tomas repetidas', exact: true }).click(),
      [cuts],
      async (b, a) => JSON.stringify(b) !== JSON.stringify(a) || (await page.locator('text=/toma|repetid/i').count()) > 0,
    );
    await page.evaluate(() =>
      window.__verticut.useEditor.getState().commit((d) => {
        for (const c of d.clips) c.cuts = [];
      }),
    );
    await check('Transcripción', 'limpiar todo', () => left.getByRole('button', { name: /Limpiar todo/ }).click(), cuts);
    await left.locator('button[aria-label="Ajustes de limpieza"]').click();
    await check('Transcripción', 'restaurar silencios', () => left.getByRole('button', { name: 'Restaurar silencios' }).click(), cuts);
    await check(
      'Transcripción',
      'ajuste: silencio mínimo',
      async () => {
        const r = left.locator('input[type=range]').nth(0);
        const b = await r.boundingBox();
        await page.mouse.click(b.x + b.width * 0.7, b.y + b.height / 2);
      },
      () => D('d.settings.silenceMin'),
    );
    await check(
      'Transcripción',
      'ajuste: margen junto a la voz',
      async () => {
        const r = left.locator('input[type=range]').nth(1);
        const b = await r.boundingBox();
        await page.mouse.click(b.x + b.width * 0.7, b.y + b.height / 2);
      },
      () => D('d.settings.silencePadding'),
    );
    await check(
      'Transcripción',
      'ajuste: lista de muletillas',
      async () => {
        const f = left.locator('input.h-8');
        await f.fill('eh, mm, pues');
        await f.blur();
      },
      () => D('d.settings.fillers'),
    );
    await check(
      'Transcripción',
      'ajuste: silencios automáticos',
      () => toggle(left, 'Quitar silencios automáticamente al añadir clips'),
      () => D('d.settings.autoSilence'),
    );
    await toggle(left, 'Quitar silencios automáticamente al añadir clips');
    await check(
      'Transcripción',
      'quitar todos los cortes',
      async () => {
        await left.getByRole('button', { name: 'Silencios', exact: true }).click();
        await page.waitForTimeout(100);
        await left.getByRole('button', { name: 'Quitar todos los cortes' }).click();
      },
      cuts,
      (b, a) => a[0].every((c) => c === ''),
    );
    await left.locator('button[aria-label="Ajustes de limpieza"]').click();

    // =================================================== script dialog
    await tab('subtitles');
    await right.getByRole('button', { name: 'Usar mi guión' }).click();
    await page.waitForSelector('.fixed.inset-0 textarea');
    await check(
      'Guión',
      'aplicar a los subtítulos',
      async () => {
        await page.locator('.fixed.inset-0 textarea').fill('Buenas a todo el planeta. Hoy vamos a charlar de la inflación.');
        await page.getByRole('button', { name: 'Aplicar a los subtítulos' }).click();
      },
      [() => D('d.script'), () => D('Object.keys(d.words).length')],
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    if (await page.locator('.fixed.inset-0').count()) await page.mouse.click(5, 5);

    // =================================================== main track: move a clip by dragging
    await page.keyboard.press('Escape');
    await check(
      'Línea de tiempo',
      'mover un clip arrastrando',
      async () => {
        const a = await page.locator('[data-track=main] > div.absolute').nth(0).boundingBox();
        const last = await page.locator('[data-track=main] > div.absolute').last().boundingBox();
        await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
        await page.mouse.down();
        await page.mouse.move(last.x + last.width - 10, a.y + a.height / 2, { steps: 8 });
        await page.mouse.up();
      },
      () => D('d.clips.map(c => c.id + ":" + c.start.toFixed(2)).join(" ")'),
    );
    await undo();
    await check(
      'Línea de tiempo',
      'recuadro de selección',
      async () => {
        const tr = await page.locator('[data-track=audio]').boundingBox();
        const top = await page.locator('[data-track=text]').boundingBox();
        await page.mouse.move(tr.x + 500, tr.y + tr.height - 3);
        await page.mouse.down();
        await page.mouse.move(tr.x + 250, top.y + 3, { steps: 6 });
        await page.mouse.up();
      },
      () => D('s.selection'),
      (b, a) => a[0] && a[0].kind === 'multi',
    );
    await check(
      'Selección múltiple',
      'eliminar todo lo seleccionado',
      () => right.getByRole('button', { name: 'Eliminar todo lo seleccionado' }).click(),
      [cutsOrEdges],
    );
    await undo();
    await check(
      'Línea de tiempo',
      'clic en un hueco quita la selección y mueve el cursor',
      async () => {
        const tr = await page.locator('[data-track=audio]').boundingBox();
        await page.mouse.click(tr.x + 620, tr.y + tr.height - 6);
      },
      [() => D('p.time')],
    );

    // =================================================== export dialog
    await page.click('button:has-text("Exportar")');
    await page.waitForSelector('button:has-text("Exportar MP4")');
    await check(
      'Exportar',
      'calidad Rápida',
      () => page.getByRole('button', { name: 'Rápida', exact: true }).click(),
      () => page.getByRole('button', { name: 'Rápida', exact: true }).getAttribute('class'),
    );
    await check(
      'Exportar',
      'exportar MP4 empieza',
      () => page.click('button:has-text("Exportar MP4")'),
      () => page.getByRole('button', { name: 'Cancelar', exact: true }).count(),
    );
    await check(
      'Exportar',
      'cancelar la exportación',
      () => page.getByRole('button', { name: 'Cancelar', exact: true }).click(),
      () => page.locator('button:has-text("Exportar MP4"), button:has-text("Exportar de nuevo")').count(),
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    if (await page.locator('.fixed.inset-0').count()) await page.mouse.click(5, 5);

    // =================================================== media: retranscribe and remove
    await tool('media');
    await left.locator('div[draggable=true]').first().hover();
    await check(
      'Multimedia',
      'volver a transcribir',
      () => left.locator('button[aria-label="Volver a transcribir"]').first().click({ force: true }),
      () => D('Object.values(s.media).map(m => m.transcript && m.transcript.status).join(",")'),
    );
    await page
      .waitForFunction(
        () =>
          Object.values(window.__verticut.useEditor.getState().media).every(
            (m) => !m.transcript || m.transcript.status === 'done' || m.transcript.status === 'none',
          ),
        null,
        { timeout: 60000 },
      )
      .catch(() => console.log('NOTE  la transcripción de prueba no terminó en 60 s'));
    await left.locator('div[draggable=true]').nth(2).hover();
    await check(
      'Multimedia',
      'quitar del proyecto',
      () => left.locator('div[draggable=true]').nth(2).locator('button[aria-label="Quitar del proyecto"]').click({ force: true }),
      () => D('d.media.length'),
    );
    await undo();

    // ---- report
    const failed = results.filter((r) => !r.pass);
    const slow = [...results]
      .filter((r) => r.pass)
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 6);
    console.log(`\n${results.length} controles probados · ${results.length - failed.length} correctos · ${failed.length} con fallo`);
    console.log('más lentos:', slow.map((r) => `${r.label} ${r.ms} ms`).join(' | '));
    console.log(errors.length ? 'errores de consola:\n' + [...new Set(errors)].join('\n') : 'sin errores de consola');
    if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(results, null, 1));
    if (failed.length) process.exitCode = 1;
  } finally {
    await browser.close();
    await restore(); // the project goes back as it was
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
