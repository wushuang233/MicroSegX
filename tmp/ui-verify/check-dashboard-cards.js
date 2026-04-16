const { Builder, By, Key, until } = require('selenium-webdriver');
const firefox = require('selenium-webdriver/firefox');

async function main() {
  const options = new firefox.Options();
  options.addArguments('-headless');
  options.setAcceptInsecureCerts(true);
  options.setBinary('/snap/firefox/7967/usr/lib/firefox/firefox');

  const driver = await new Builder()
    .forBrowser('firefox')
    .setFirefoxOptions(options)
    .build();

  try {
    await driver.get('https://127.0.0.1:18443/');

    const username = await driver.wait(
      until.elementLocated(By.css('input[formcontrolname="username"]')),
      20000
    );
    const password = await driver.findElement(
      By.css('input[formcontrolname="password"]')
    );

    await username.clear();
    await username.sendKeys('admin');
    await password.clear();
    await password.sendKeys('Qwer123@', Key.RETURN);

    await driver.wait(async () => {
      const url = await driver.getCurrentUrl();
      return url.includes('dashboard') || url.includes('#/dashboard');
    }, 30000);

    await driver.wait(
      until.elementLocated(By.css('.dashboard-hero-shell__metric-grid')),
      30000
    );

    const cards = await driver.findElements(
      By.css('.dashboard-hero-shell__metric-grid .dashboard-metric-card')
    );

    const texts = [];
    for (const card of cards) {
      texts.push((await card.getText()).replace(/\s+/g, ' ').trim());
    }

    console.log(JSON.stringify({ count: cards.length, cards: texts }, null, 2));
  } finally {
    await driver.quit();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
