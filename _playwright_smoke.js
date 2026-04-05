const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
  await page.goto('http://127.0.0.1:4200/#/login', { waitUntil: 'networkidle' });
  console.log('title:', await page.title());
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
