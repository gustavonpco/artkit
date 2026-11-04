#!/usr/bin/env node
// Regenerates the README screenshots in docs/images from the browser playground.
// Start the playground first (pnpm --filter @artkit-ai/example-playground dev), then:
//   node scripts/readme-screenshots.mjs [--chrome <path to a Chrome/Chromium executable>]
// Without --chrome it uses Playwright's own Chromium (pnpm --filter @artkit-ai/node exec playwright install chromium).
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'docs/images');
const url = 'http://localhost:5287';
const require = createRequire(resolve(root, 'packages/node/package.json'));
const { chromium } = require('playwright');

const chromeFlag = process.argv.indexOf('--chrome');
const executablePath = chromeFlag > 0 ? process.argv[chromeFlag + 1] : undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});

// The whole playground after the agent applied its operation scenario to the document.
{
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1.5,
    colorScheme: 'light',
  });
  await page.goto(url);
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /Aplicar como agente/ }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${out}/playground.png` });
  await page.close();
}

// One view-mode screenshot per kind, with the playground's side columns hidden.
const page = await browser.newPage({
  viewport: { width: 1200, height: 2400 },
  deviceScaleFactor: 1.5,
  colorScheme: 'light',
});
const kinds = { document: 'Proposta', sheet: 'Estimativa', slides: 'Apresenta', diagram: 'Arquitetura' };
for (const [kind, title] of Object.entries(kinds)) {
  await page.goto(url);
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Visualizar' }).click();
  await page.locator('.ak-card', { hasText: title }).getByRole('button', { name: /Abrir/ }).click();
  await page.waitForTimeout(2000);
  await page.addStyleTag({
    content:
      '.pg-list,.pg-agent,.pg-mode{display:none!important}.pg-layout{grid-template-columns:1fr!important}',
  });
  await page.waitForTimeout(800);
  if (kind === 'slides') {
    // Show the chart slide; the thumbnails still show the whole deck.
    await page.locator('.ak-slides-thumb').nth(3).click();
    await page.waitForTimeout(800);
  }
  // Crop the panel to its content (panels stretch to the viewport height).
  const clip = await page.evaluate(() => {
    const panel = document.querySelector('.ak-panel');
    const box = panel.getBoundingClientRect();
    let bottom = box.top;
    for (const el of panel.querySelectorAll('*')) {
      if (el.children.length && !(el instanceof SVGElement)) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.height && r.bottom > bottom) bottom = r.bottom;
    }
    // The sheet grid is virtualized and always fills the panel: keep the first rows only.
    if (panel.dataset.kind === 'sheet') bottom = Math.min(bottom, box.top + 459);
    return { x: box.left, y: box.top, width: box.width, height: Math.min(box.height, bottom - box.top + 24) };
  });
  await page.screenshot({ path: `${out}/${kind}.png`, clip });
  console.log(`docs/images/${kind}.png`);
}
await browser.close();
console.log('docs/images/playground.png');
