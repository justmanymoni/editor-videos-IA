// Checks that what is HEARD follows the sound controls at once: it reads the loudness that leaves the
// player's mixer while it moves the volume, voice and music controls.
//
//   node scripts/audit/audit-sound.cjs         (the app must be running; needs Playwright)
//
// It uses the first project of the list (or PROJECT=<id>), which must start with a video that has sound.
// The first run separates voice and music, which can take a while.
const { chromium } = require('playwright');
const BASE = process.env.VERTICUT_URL || 'http://localhost:3000';
(async () => {
  const id = process.env.PROJECT || (await (await fetch(BASE + '/api/projects')).json()).projects[0].id;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1534, height: 845 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });
  await page.goto(`${BASE}/editor/${id}`);
  await page.waitForSelector('[data-track=main] > div', { timeout: 30000 });
  await page.waitForFunction(() => !!window.__verticut);
  await page.waitForTimeout(2500);
  const state = () =>
    page.evaluate(() => {
      const v = window.__verticut;
      return {
        ...v.player.soundState(),
        mix: v.useEditor.getState().doc.audioMix,
        main: v.useEditor.getState().doc.settings.mainVolume,
        mixUrls: Object.keys(v.useEditor.getState().mixUrls).length,
      };
    });
  // loudest level seen during ~500 ms of playback
  // Loudest level in a second and a half of playback (long enough to cover a pause in the speech).
  const level = () =>
    page.evaluate(async () => {
      let max = 0;
      for (let i = 0; i < 75; i++) {
        max = Math.max(max, window.__verticut.player.outputLevel());
        await new Promise((r) => setTimeout(r, 20));
      }
      return +max.toFixed(4);
    });
  const right = page.locator('aside >> nth=1');
  await page.click('[data-inspector-tab=audio]');
  const sliders = right.locator('input[type=range]');
  const setSlider = async (i, frac) => {
    const b = await sliders.nth(i).boundingBox();
    await page.mouse.click(b.x + 5 + (b.width - 10) * frac, b.y + b.height / 2);
    await page.waitForTimeout(120);
  };
  const row = (name, s, l) => console.log(name.padEnd(46), 'level', String(l).padEnd(7), JSON.stringify(s));

  console.log('sliders in the audio tab:', await sliders.count());
  await page.keyboard.press('Home');
  await page.keyboard.press('Space');
  await page.waitForTimeout(900);
  row('playing, volume 100 %', await state(), await level());
  await setSlider(0, 0);
  row('volume → 0 (while playing)', await state(), await level());
  await setSlider(0, 0.55);
  row('volume → 55 % (while playing)', await state(), await level());
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  console.log('space after using a slider pauses:', await page.evaluate(() => !window.__verticut.usePlayback.getState().playing));
  await setSlider(0, 0);
  await setSlider(0, 1);
  await page.keyboard.press('Space');
  await page.waitForTimeout(700);
  row('paused: 0 then 100 %, then play', await state(), await level());

  // voice / music
  if (await right.locator('button:has-text("Separar voz y música")').count()) {
    await right.locator('button:has-text("Separar voz y música")').first().click();
  }
  await right.locator('button:has-text("Sin música")').waitFor({ timeout: 180000 });
  await page.waitForFunction(() => Object.keys(window.__verticut.useEditor.getState().mixUrls).length > 0, null, { timeout: 60000 });
  console.log('stems preview ready before touching any slider:', (await state()).mixUrls);
  const t0 = Date.now();
  await right.locator('button:has-text("Sin música")').click();
  await page.waitForFunction(() => window.__verticut.player.soundState().voice === 1 && window.__verticut.player.soundState().music === 0, null, {
    timeout: 5000,
  });
  console.log('"Sin música" applied to the mixer in', Date.now() - t0, 'ms');
  await page.waitForTimeout(1200); // the deck reloads once with the stems preview
  if (!(await page.evaluate(() => window.__verticut.usePlayback.getState().playing))) await page.keyboard.press('Space');
  await page.waitForTimeout(900);
  row('sin música (voice only)', await state(), await level());
  await right.locator('button:has-text("Sin voz")').click();
  await page.waitForTimeout(250);
  row('sin voz (music only)', await state(), await level());
  await setSlider(1, 0); // voice slider → 0
  await setSlider(2, 0); // music slider → 0
  row('voice 0, music 0', await state(), await level());
  await setSlider(1, 0.55);
  row('voice → 55 % (was silent)', await state(), await level());
  await setSlider(2, 0.55);
  row('music → 55 %', await state(), await level());
  await setSlider(0, 0.5);
  row('main volume → 50 % with a mix', await state(), await level());
  await setSlider(0, 1);
  await right.locator('button:has-text("Original")').click();
  await page.waitForTimeout(1500);
  if (!(await page.evaluate(() => window.__verticut.usePlayback.getState().playing))) await page.keyboard.press('Space');
  await page.waitForTimeout(900);
  row('original again', await state(), await level());
  await page.keyboard.press('Space');
  await page.waitForTimeout(1500);
  console.log(errors.join('\n') || 'no errors');
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
