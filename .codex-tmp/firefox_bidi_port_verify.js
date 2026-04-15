const ws = new WebSocket('ws://127.0.0.1:9222/session');

const baseUrl = 'https://127.0.0.1:18443';
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
  if (result.type === 'boolean' || result.type === 'number') {
    return String(result.value);
  }
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
    const result = await evaluate(
      context,
      `JSON.stringify(Boolean(${conditionExpression}))`
    );
    if (result === 'true') {
      return true;
    }
    await sleep(500);
  }
  throw new Error(`Timeout waiting for condition: ${conditionExpression}`);
}

async function navigateTo(context, route, readySelector, timeoutMs = 30000) {
  await evaluate(
    context,
    `(() => {
      window.location.href = ${JSON.stringify(`${baseUrl}${route}`)};
      return JSON.stringify({ href: window.location.href });
    })()`
  );
  await waitFor(
    context,
    `window.location.href.includes(${JSON.stringify(route)})`,
    timeoutMs
  );
  if (readySelector) {
    await waitFor(
      context,
      `document.querySelector(${JSON.stringify(readySelector)})`,
      timeoutMs
    );
  }
  await sleep(2500);
}

async function login(context) {
  await send('browsingContext.navigate', {
    context,
    url: `${baseUrl}/#/login`,
    wait: 'complete',
  });
  await waitFor(
    context,
    `document.querySelector('#Email1') && document.querySelector('#password1')`
  );
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
  await sleep(2500);
}

async function capturePortExposureState(context) {
  await navigateTo(
    context,
    '/#/microsegx/port-exposure',
    '.mode-switch__button'
  );
  await waitFor(
    context,
    `document.querySelector('.quick-actions-card') || document.querySelector('.ziti-embedded-shell')`,
    30000
  );

  const payload = await evaluate(
    context,
    `(() => {
      const normalizedText = node =>
        (node?.textContent || '').replace(/\s+/g, ' ').trim();
      const isVisible = selector => {
        const node = document.querySelector(selector);
        if (!node) return false;
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const buttons = [...document.querySelectorAll('.mode-switch__button')].map(button => ({
        text: normalizedText(button),
        active: button.classList.contains('is-active'),
      }));
      const sidebarTexts = [...document.querySelectorAll('.sidebar-nav span')]
        .map(normalizedText)
        .filter(Boolean);
      return JSON.stringify({
        hash: window.location.hash,
        buttons,
        activeButton: buttons.find(button => button.active)?.text || null,
        quickActionsVisible: isVisible('.quick-actions-card'),
        statsGridVisible: isVisible('.stats-grid'),
        zitiEmbeddedVisible: isVisible('.ziti-embedded-shell') || isVisible('app-microsegx-ziti'),
        sidebarTexts,
        hasSigstoreMenu: sidebarTexts.some(text => text.includes('Sigstore')),
      });
    })()`
  );

  return JSON.parse(payload);
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

ws.addEventListener('open', async () => {
  try {
    await send('session.new', {
      capabilities: { alwaysMatch: { acceptInsecureCerts: true } },
    });

    const created = await send('browsingContext.create', { type: 'tab' });
    const context = created.context;
    await login(context);

    const state = await capturePortExposureState(context);
    const failures = [];

    const buttonTexts = state.buttons.map(button => button.text);
    const expectedButtons = ['端口暴露', '服务治理', '零信任'];
    for (const expected of expectedButtons) {
      if (!buttonTexts.includes(expected)) {
        failures.push(`missing-tab:${expected}`);
      }
    }
    if (state.activeButton !== '端口暴露') {
      failures.push(`default-tab:${state.activeButton || 'none'}`);
    }
    if (!state.quickActionsVisible || !state.statsGridVisible) {
      failures.push('exposure-content-not-visible');
    }
    if (state.zitiEmbeddedVisible) {
      failures.push('ziti-visible-in-default-view');
    }
    if (state.hasSigstoreMenu) {
      failures.push('sigstore-still-visible-in-sidebar');
    }

    console.log(JSON.stringify({ state, failures }, null, 2));
    completed = true;
    process.exitCode = failures.length === 0 ? 0 : 2;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    ws.close();
  }
});

setTimeout(() => {
  if (!completed) {
    console.error('timeout');
    ws.close();
    process.exit(1);
  }
}, 90000);
