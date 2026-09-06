import { pathToFileURL } from 'node:url';

let handled = false;

process.on('message', async (message) => {
  if (!message || message.type !== 'execute' || handled) return;
  handled = true;
  try {
    const url = pathToFileURL(message.modulePath).href;
    const module = await import(url);
    const handler = module[message.exportName];
    if (typeof handler !== 'function') throw new Error(`extension export is not callable: ${message.exportName}`);
    const result = await handler(message.payload);
    assertSerializable(result);
    sendTerminal({ type: 'result', result }, 0);
  } catch (error) {
    sendTerminal({
      type: 'error',
      message: String(error?.message ?? error),
      name: error?.name ?? 'Error',
    }, 1);
  }
});

function sendTerminal(message, exitCode) {
  if (typeof process.send !== 'function' || !process.connected) {
    process.exit(exitCode);
    return;
  }
  process.send(message, (error) => {
    if (error && exitCode === 0) exitCode = 1;
    try { process.disconnect(); } catch {}
    process.exit(exitCode);
  });
}

function assertSerializable(value) {
  try {
    JSON.stringify(value);
  } catch {
    throw new Error('extension result must be JSON serializable');
  }
}
