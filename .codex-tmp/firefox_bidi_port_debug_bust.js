const ws = new WebSocket('ws://127.0.0.1:9222/session');

const cacheBust = `ui45probe=${Date.now()}`;
const baseUrl = `https://127.0.0.1:18443/?${cacheBust}`;
const username = 'uiverify';
const password = 'MxVerify-2026-04-14!Aa9';

let nextId = 1;
const pending = new Map();
let completed = false;

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function unwrapStringResult(result) {
  if (!result) return null;
  if (result.type === 'string') return result.value;
  if (result.type === 'boolean' || result.type === 'number') return String(result.value);
  if (result.type === 'null') return null;
  return JSON.stringify(result);
}

async function evaluate(context, expression) {
  const response = await send('script.evaluate', {
    expression,
    target: { context },
    awaitPromise: true,
    resultOwnership: 'none',
  });
  return unwrapStringResult(response.result);
}

async function waitFor(context, conditionExpression, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await evaluate(context, `JSON.stringify(Boolean(${conditionExpression}))`);
    if (result === 'true') return true;
    await sleep(500);
  }
  throw new Error(`Timeout waiting for condition: ${conditionExpression}`);
}

async function login(context) {
  await send('browsingContext.navigate', {
    context,
    url: `${baseUrl}#/login`,
    wait: 'complete',
  });
  await waitFor(context, `document.querySelector('#Email1') && document.querySelector('#password1')`);
  await evaluate(
    context,
    `(() => {
      const setValue = (selector, value) => {
        const input = document.querySelector(selector);
        input.focus();
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setValue('#Email1', ${JSON.stringify(username)});
      setValue('#password1', ${JSON.stringify(password)});
      document.querySelector('button[type="submit"]').click();
      return JSON.stringify({ clicked: true });
    })()`
  );
  await waitFor(context, `!window.location.href.includes('/#/login')`, 30000);
  await sleep(3000);
}

ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject, method } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(`${method}: ${message.error} ${message.message || ''}`));
    } else {
      resolve(message.result);
    }
  }
});

ws.addEventListener('open', async () => {
  try {
    await send('session.new', {
      capabilities: { alwaysMatch: { acceptInsecureCerts: true } },
    });

    const created = await send('browsingContext.create', { type: 'tab' });
    const context = created.context;
    await login(context);

    await send('browsingContext.navigate', {
      context,
      url: `${baseUrl}#/microsegx/port-exposure`,
      wait: 'complete',
    });
    await sleep(5000);

    const payload = await evaluate(
      context,
      `(() => JSON.stringify({
        href: window.location.href,
        hash: window.location.hash,
        title: document.title,
        bodyText: (document.body?.innerText || '').slice(0, 1200),
        modeSwitchCount: document.querySelectorAll('.mode-switch__button').length,
        portExposurePageCount: document.querySelectorAll('.port-exposure-page').length,
      }))()`
    );

    console.log(payload);
    completed = true;
    process.exitCode = 0;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    ws.close();
  }
});

ws.addEventListener('error', error => {
  console.error('ws-error', error);
  process.exitCode = 1;
});

ws.addEventListener('close', event => {
  if (!completed) {
    console.error('ws-close', JSON.stringify({ code: event.code, reason: event.reason }));
    process.exitCode = 1;
  }
});

setTimeout(() => {
  if (!completed) {
    console.error('timeout');
    ws.close();
    process.exit(1);
  }
}, 90000);
