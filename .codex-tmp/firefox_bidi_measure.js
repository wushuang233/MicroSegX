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
  if (!result) {
    return null;
  }
  if (result.type === 'string') {
    return result.value;
  }
  if (result.type === 'boolean' || result.type === 'number') {
    return String(result.value);
  }
  if (result.type === 'null') {
    return null;
  }
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
  await waitFor(context, `window.location.href.includes(${JSON.stringify(route)})`, timeoutMs);
  if (readySelector) {
    await waitFor(context, `document.querySelector(${JSON.stringify(readySelector)})`, timeoutMs);
  }
  await sleep(2500);
}

async function login(context) {
  await send('browsingContext.navigate', {
    context,
    url: `${baseUrl}/#/login`,
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
      const button = document.querySelector('button[type="submit"]');
      button.click();
      return JSON.stringify({ clicked: true });
    })()`
  );
  await waitFor(context, `!window.location.href.includes('/#/login')`, 30000);
  await sleep(2500);
}

async function collect(context, route, readySelector, selectors, rowSelector) {
  await navigateTo(context, route, readySelector);
  if (rowSelector) {
    await evaluate(
      context,
      `(() => {
        const row = document.querySelector(${JSON.stringify(rowSelector)});
        if (row) {
          row.click();
          return JSON.stringify({ clicked: true });
        }
        return JSON.stringify({ clicked: false });
      })()`
    );
    await sleep(1200);
  }

  const payload = await evaluate(
    context,
    `(() => {
      const serialize = selector => {
        const node = document.querySelector(selector);
        if (!node) {
          return null;
        }
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return {
          selector,
          tag: node.tagName.toLowerCase(),
          id: node.id || '',
          className: node.className || '',
          width: Number(rect.width.toFixed(2)),
          clientWidth: node.clientWidth,
          scrollWidth: node.scrollWidth,
          display: style.display,
          flex: style.flex,
          flexGrow: style.flexGrow,
          flexShrink: style.flexShrink,
          flexBasis: style.flexBasis,
          widthStyle: style.width,
          minWidth: style.minWidth,
          maxWidth: style.maxWidth,
          overflow: style.overflow,
          position: style.position,
        };
      };

      return JSON.stringify(
        Object.fromEntries(
          Object.entries(${JSON.stringify(selectors)}).map(([key, selector]) => [key, serialize(selector)])
        )
      );
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

    const group = await collect(
      context,
      '/#/group',
      '#groups-grid',
      {
        adjustableHost: 'app-adjustable-div',
        adjustableGrid: '.adjustable-div',
        firstPane: '.adjustable-div > .adjustable-div__pane:first-child',
        firstPaneChild: '.adjustable-div > .adjustable-div__pane:first-child > *',
        secondPane: '.adjustable-div > .adjustable-div__pane:last-child',
        secondPaneChild: '.adjustable-div > .adjustable-div__pane:last-child > *',
        groupListCard: '.groups-page__split-card--list',
        groupListContent: '.groups-page__split-card--list .groups-page__split-content',
        appGroups: 'app-groups',
        groupsGrid: '#groups-grid',
        groupsGridRoot: '#groups-grid .ag-root-wrapper',
        groupDetailCard: '.groups-page__split-card--detail',
        groupDetailHost: 'app-group-details',
      },
      '#groups-grid .ag-center-cols-container .ag-row'
    );

    const waf = await collect(
      context,
      '/#/waf-sensors',
      '#waf-sensors-grid',
      {
        adjustableHost: 'app-adjustable-div',
        adjustableGrid: '.adjustable-div',
        firstPane: '.adjustable-div > .adjustable-div__pane:first-child',
        firstPaneChild: '.adjustable-div > .adjustable-div__pane:first-child > *',
        secondPane: '.adjustable-div > .adjustable-div__pane:last-child',
        secondPaneChild: '.adjustable-div > .adjustable-div__pane:last-child > *',
        wafListCard: '.waf-card--list',
        wafListGrid: '#waf-sensors-grid',
        wafListRoot: '#waf-sensors-grid .ag-root-wrapper',
        wafDetailCard: '.waf-card--detail',
        wafRulesGrid: '#waf-rules-grid',
        wafRulesRoot: '#waf-rules-grid .ag-root-wrapper',
        wafPatternsGrid: '#waf-patterns-grid',
        wafPatternsRoot: '#waf-patterns-grid .ag-root-wrapper',
      },
      '#waf-sensors-grid .ag-center-cols-container .ag-row'
    );

    console.log(JSON.stringify({ group, waf }, null, 2));
    completed = true;
    process.exitCode = 0;
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