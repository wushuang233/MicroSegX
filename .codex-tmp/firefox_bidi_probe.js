const ws = new WebSocket('ws://127.0.0.1:9222/session');

let nextId = 1;
const pending = new Map();
let completed = false;

function send(method, params = {}) {
  const id = nextId++;
  const payload = { id, method, params };
  ws.send(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method });
  });
}

function unwrapRemoteValue(remoteValue) {
  if (!remoteValue) {
    return remoteValue;
  }
  if (
    remoteValue.type === 'string' ||
    remoteValue.type === 'number' ||
    remoteValue.type === 'boolean'
  ) {
    return remoteValue.value;
  }
  if (remoteValue.type === 'null') {
    return null;
  }
  return remoteValue;
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
    const session = await send('session.new', {
      capabilities: { alwaysMatch: { acceptInsecureCerts: true } },
    });
    console.log('session', JSON.stringify(session));

    const created = await send('browsingContext.create', { type: 'tab' });
    console.log('created', JSON.stringify(created));

    const context = created.context;

    await send('browsingContext.navigate', {
      context,
      url: 'https://127.0.0.1:18443/#/login',
      wait: 'complete',
    });

    const evaluation = await send('script.evaluate', {
      expression: 'document.title',
      target: { context },
      awaitPromise: true,
      resultOwnership: 'none',
    });

    console.log('title', JSON.stringify(unwrapRemoteValue(evaluation.result)));
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
}, 15000);