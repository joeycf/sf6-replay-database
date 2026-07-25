// One-off generator for the site's default OG card (public/og-default.png,
// 1200×630). Renders an on-token HTML card in headless Chrome — Google-Fonts
// CDN is fine here (generator only; the site itself self-hosts fonts).
//
// Reads data/characters.json so the accent strip along the bottom tracks the
// roster: add a character, re-run, and the card reflects it.
//
// Run: npx tsx scripts/og.ts

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import type { CharacterRecord } from '../types/index';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Reused verbatim as the shell selector card's tagline (lib/games.ts). */
export const KICKER = 'character usage · matchup data · meta over time';

async function main(): Promise<void> {
  const characters = JSON.parse(
    await readFile(join(ROOT, 'data/characters.json'), 'utf8'),
  ) as CharacterRecord[];
  const accents = characters.map((c) => c.accent ?? '#FF7D00');
  const strip = accents.map((a) => `<span style="flex:1;background:${a};"></span>`).join('');

  const html = `<!doctype html><html><head>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;800&family=Public+Sans:wght@500;600&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>*{margin:0;box-sizing:border-box}</style></head>
<body style="width:1200px;height:630px;background:#141009;overflow:hidden;position:relative;font-family:'Public Sans',sans-serif;">
  <div style="position:absolute;inset:0;background:repeating-linear-gradient(135deg,#1D1810,#1D1810 22px,#171208 22px,#171208 44px);opacity:.6;"></div>
  <div style="position:absolute;inset:0;background:radial-gradient(75% 110% at 82% 10%,rgba(255,125,0,.26),transparent 60%);"></div>
  <div style="position:absolute;inset:0;background:radial-gradient(55% 80% at 12% 95%,rgba(155,230,74,.13),transparent 60%);"></div>
  <div style="position:absolute;left:80px;top:132px;">
    <div style="display:flex;align-items:center;gap:26px;">
      <div style="width:118px;height:118px;background:#FF7D00;clip-path:polygon(0 0,calc(100% - 24px) 0,100% 24px,100% 100%,24px 100%,0 calc(100% - 24px));display:flex;align-items:center;justify-content:center;">
        <span style="font-family:'Big Shoulders Display';font-weight:800;font-size:64px;color:#1A130A;transform:skewX(-8deg);">/</span>
      </div>
      <div style="font-family:'Big Shoulders Display';font-weight:800;font-size:96px;letter-spacing:.01em;color:#F4EEE1;">SF6<span style="color:#FF7D00;">/</span>REPLAY</div>
    </div>
    <div style="margin-top:34px;font-size:30px;font-weight:600;color:#CBC1AC;">The competitive Street Fighter 6 replay database</div>
    <div style="margin-top:16px;font-family:'JetBrains Mono';font-size:20px;color:#A3987F;">${KICKER}</div>
  </div>
  <div style="position:absolute;left:0;right:0;bottom:0;height:14px;display:flex;">${strip}</div>
</body></html>`;

  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome-stable',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await (
    await browser.newContext({ viewport: { width: 1200, height: 630 } })
  ).newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const png = await page.screenshot({ type: 'png' });
  await browser.close();
  await writeFile(join(ROOT, 'public/og-default.png'), png);
  console.log(`✓ public/og-default.png (${png.length} bytes)`);
}

main().catch((err) => {
  console.error('✖ og.ts failed:', err);
  process.exit(1);
});
