// Home screen: folders, selection of projects, settings. Leaves the library as it found it.
//
//   node scripts/audit/audit-home.cjs          (the app must be running; needs Playwright)
const { chromium } = require('playwright');
const BASE = process.env.VERTICUT_URL || 'http://localhost:3000';
const SHOTS = process.env.SHOTS;
const j = async (url, init) => (await fetch(BASE + url, init)).json();
const send = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

(async () => {
  const results = [];
  const ok = (name, pass, detail = '') => {
    results.push({ name, pass });
    console.log(pass ? 'ok  ' : 'FAIL', name, detail);
  };
  const settingsBefore = (await j('/api/settings')).settings;
  const base = (await j('/api/projects')).projects[0];
  if (!base) throw new Error('Hace falta al menos un proyecto');
  const doc = (await j(`/api/projects/${base.id}`)).project;
  const made = [];
  for (const name of ['Audit A', 'Audit B', 'Audit C']) made.push((await j('/api/projects', send('POST', { name, doc }))).project.id);
  const foldersBefore = (await j('/api/folders')).folders.map((f) => f.id);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160));
  });
  page.on('dialog', (d) => d.accept());
  try {
    await page.goto(BASE + '/');
    await page.waitForSelector('[data-project]');
    const tile = (name) => page.locator('[data-project]', { hasText: name }).first();
    const folderTile = (name) => page.locator('[data-folder]', { hasText: name }).first();
    const library = async () => {
      const p = (await j('/api/projects')).projects;
      const f = (await j('/api/folders')).folders;
      return { p, f };
    };
    const inFolder = async (folderName) => {
      const { p, f } = await library();
      const id = f.find((x) => x.name === folderName)?.id;
      return p
        .filter((x) => id && x.folderId === id)
        .map((x) => x.name)
        .sort()
        .join(',');
    };

    ok(
      'el inicio no muestra el aviso de transcripción',
      (await page.locator('text=Transcripción local').count()) === 0 && (await page.locator('text=Reconoce la voz').count()) === 0,
    );
    ok(
      'están Nuevo proyecto, Importar proyecto y Nueva carpeta',
      (await page.locator('[data-new-project]').count()) === 1 &&
        (await page.locator('button:has-text("Importar proyecto")').count()) === 1 &&
        (await page.locator('[data-new-folder]').count()) === 1,
    );
    ok(
      'botón Ajustes arriba a la derecha',
      await page.evaluate(() => {
        const r = document.querySelector('[data-settings-button]').getBoundingClientRect();
        return r.top < 90 && r.left > window.innerWidth / 2;
      }),
    );

    // ---- new folder: choose its projects in the same list
    await page.click('[data-new-folder]');
    await page.waitForSelector('[data-folder-bar] input');
    await page.fill('[data-folder-bar] input', 'Clientes');
    await tile('Audit A').locator('a').click();
    await tile('Audit B').locator('a').click();
    ok(
      'al elegir, un clic marca el proyecto en vez de abrirlo',
      page.url() === BASE + '/' && (await page.locator('[data-project][data-selected]').count()) === 2,
    );
    if (SHOTS) await page.screenshot({ path: SHOTS + '/50-new-folder.png' });
    await page.click('[data-folder-bar] button:has-text("Crear carpeta")');
    await page.waitForSelector('[data-folder]:has-text("Clientes")');
    ok('carpeta creada con los dos proyectos marcados', (await inFolder('Clientes')) === 'Audit A,Audit B', await inFolder('Clientes'));
    ok(
      'los proyectos de la carpeta ya no están en la pantalla principal',
      (await tile('Audit A').count()) === 0 && (await tile('Audit C').count()) === 1,
    );
    ok('la carpeta dice cuántos proyectos tiene', (await folderTile('Clientes').innerText()).includes('2 proyectos'));

    // ---- drag a project onto the folder
    await page.dragAndDrop('[data-project]:has-text("Audit C") a', '[data-folder]:has-text("Clientes") button >> nth=0');
    await page.waitForFunction(() => !document.querySelector('[data-project] p[title^="Audit C"]'), null, { timeout: 5000 }).catch(() => undefined);
    ok(
      'arrastrar un proyecto sobre la carpeta lo mete dentro',
      (await inFolder('Clientes')) === 'Audit A,Audit B,Audit C',
      await inFolder('Clientes'),
    );
    if (SHOTS) {
      await page.mouse.move(700, 880);
      await page.waitForTimeout(300);
      await page.screenshot({ path: SHOTS + '/51-home-folders.png' });
    }

    // ---- open the folder, take one out with the selection bar
    await folderTile('Clientes').locator('button').first().click();
    await page.waitForSelector('[data-back]');
    ok(
      'abrir la carpeta muestra solo sus proyectos',
      (await page.locator('[data-project]').count()) === 3 && (await page.locator('[data-folder]').count()) === 0,
    );
    await tile('Audit C').hover();
    await tile('Audit C').locator('[role=checkbox]').click();
    await page.waitForSelector('[data-selection-bar]');
    if (SHOTS) await page.screenshot({ path: SHOTS + '/52-folder-open.png' });
    await page.click('[data-move-out]');
    await page.waitForFunction(() => document.querySelectorAll('[data-project]').length === 2);
    ok('«Sacar de la carpeta» devuelve el proyecto a la pantalla principal', (await inFolder('Clientes')) === 'Audit A,Audit B');

    // ---- a new project made inside the folder stays in it
    await page.click('[data-new-project]');
    await page.waitForURL(/\/editor\//);
    const newId = page.url().split('/').pop();
    made.push(newId);
    ok(
      'un proyecto creado dentro de la carpeta queda en ella',
      (await library()).p.find((x) => x.id === newId)?.folderId === (await library()).f.find((x) => x.name === 'Clientes')?.id,
    );

    // ---- editor: settings button and the export default
    // The home screen has its own "Ajustes" button: wait until the editor is the page on screen.
    // (The title is matched exactly: the hint of the language setting also says "proyectos nuevos".)
    await page.waitForSelector('[data-timeline]');
    await page.click('button[aria-label="Ajustes"]');
    await page.waitForSelector('[data-settings] >> text="Proyectos nuevos"', { timeout: 8000 }).catch(() => undefined);
    ok('el editor tiene el botón Ajustes y abre el mismo diálogo', (await page.locator('[data-settings] >> text="Proyectos nuevos"').count()) === 1);
    await page.locator('[data-settings]').getByRole('button', { name: 'Alta', exact: true }).click();
    for (let i = 0; i < 30 && (await j('/api/settings')).settings.exportQuality !== 'high'; i++) await page.waitForTimeout(100);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    if (await page.locator('[data-settings]').count()) await page.mouse.click(5, 5);
    ok('la calidad de exportación se guarda', (await j('/api/settings')).settings.exportQuality === 'high');

    // ---- home: settings dialog
    await page.goto(BASE + '/');
    await page.waitForSelector('[data-folder]');
    await page.click('[data-settings-button]');
    await page.waitForSelector('[data-settings]');
    const dlg = page.locator('[data-settings]');
    ok('Ajustes contiene el modelo de transcripción', (await dlg.locator('text=Transcripción local').count()) === 1);
    await dlg.locator('select[aria-label="Idioma por defecto"]').selectOption('en');
    await dlg.getByRole('switch', { name: 'Quitar los silencios automáticamente al añadir clips' }).click();
    await dlg.locator('select[aria-label="Estilo de subtítulos por defecto"]').selectOption('caja');
    await dlg.getByRole('button', { name: 'Fondo borroso', exact: true }).click();
    await dlg.getByRole('button', { name: 'A la derecha', exact: true }).click();
    await page.waitForTimeout(500);
    if (SHOTS) await page.screenshot({ path: SHOTS + '/53-settings.png' });
    const s = (await j('/api/settings')).settings;
    ok(
      'idioma, silencios, estilo y clips horizontales se guardan',
      s.language === 'en' && s.autoSilence === !settingsBefore.autoSilence && s.subtitlePreset === 'caja' && s.fitMode === 'blur',
      JSON.stringify(s),
    );
    ok(
      'la posición del reproductor se guarda en este navegador',
      await page.evaluate(() => JSON.parse(localStorage.getItem('verticut.layout')).player === 'right'),
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    if (await page.locator('[data-settings]').count()) await page.mouse.click(5, 5);

    // ---- a new project starts with those settings
    await page.click('[data-new-project]');
    await page.waitForURL(/\/editor\//);
    const fresh = page.url().split('/').pop();
    made.push(fresh);
    const fd = (await j(`/api/projects/${fresh}`)).project;
    ok(
      'un proyecto nuevo empieza con los ajustes generales',
      fd.settings.language === 'en' &&
        fd.settings.fitMode === 'blur' &&
        fd.settings.autoSilence === s.autoSilence &&
        fd.subtitles.highlightBox === true,
      JSON.stringify([fd.settings.language, fd.settings.fitMode, fd.subtitles.highlightBox]),
    );
    await page.waitForSelector('[data-stage]');
    ok(
      'el editor se abre con el reproductor a la derecha',
      await page.evaluate(() => document.querySelector('[data-stage]').getBoundingClientRect().left > window.innerWidth * 0.6),
    );

    // ---- rename and remove the folder
    await page.goto(BASE + '/');
    await page.waitForSelector('[data-folder]');
    await folderTile('Clientes').hover();
    await folderTile('Clientes').locator('button[aria-label="Cambiar el nombre de la carpeta"]').click();
    await page.keyboard.type('Trabajo');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-folder]:has-text("Trabajo")');
    ok(
      'cambiar el nombre de la carpeta',
      (await library()).f.some((f) => f.name === 'Trabajo'),
    );
    await folderTile('Trabajo').hover();
    await folderTile('Trabajo').locator('button[aria-label="Quitar la carpeta"]').click();
    await page.waitForFunction(() => !document.querySelector('[data-folder]'), null, { timeout: 5000 }).catch(() => undefined);
    const after = await library();
    ok(
      'quitar la carpeta no borra sus proyectos',
      !after.f.some((f) => f.name === 'Trabajo') && made.every((id) => after.p.some((p) => p.id === id && p.folderId === null)),
    );
    // ---- selection bar on the main screen: move several to a new folder through "Mover a"
    await tile('Audit A').hover();
    await tile('Audit A').locator('[role=checkbox]').click();
    await tile('Audit B')
      .locator('a')
      .click({ modifiers: ['Control'] });
    ok('Ctrl + clic añade a la selección', (await page.locator('[data-project][data-selected]').count()) === 2);
    await page.locator('[data-selection-bar] button:has-text("Carpeta nueva")').click();
    await page.fill('[data-folder-bar] input', 'Semana');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-folder]:has-text("Semana")');
    ok('«Mover a › Carpeta nueva» crea la carpeta con la selección', (await inFolder('Semana')) === 'Audit A,Audit B', await inFolder('Semana'));
  } finally {
    await browser.close();
    // put everything back
    for (const id of made) await fetch(`${BASE}/api/projects/${id}`, { method: 'DELETE' });
    for (const f of (await j('/api/folders')).folders)
      if (!foldersBefore.includes(f.id)) await fetch(`${BASE}/api/folders/${f.id}`, { method: 'DELETE' });
    await fetch(BASE + '/api/settings', send('PUT', settingsBefore));
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length} comprobaciones · ${results.length - failed.length} correctas · ${failed.length} con fallo`);
  console.log(errors.length ? 'errores de consola:\n' + [...new Set(errors)].join('\n') : 'sin errores de consola');
  if (failed.length) process.exitCode = 1;
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
