import { pathToFileURL } from 'node:url';

process.on('message', async (message) => {
  if (!message || message.type !== 'execute') return;
  try {
    const url = pathToFileURL(message.modulePath).href;
    const module = await import(url);
    const handler = module[message.exportName];
    if (typeof handler !== 'function') throw new Error(`extension export is not callable: ${message.exportName}`);
    const result = await handler(message.payload);
    assertSerializable(result);
    process.send?.({ type: 'result', result });
  } catch (error) {
    process.send?.({
      type: 'error',
      message: String(error?.message ?? error),
      name: error?.name ?? 'Error',
    });
  }
});

function assertSerializable(value) {
  try {
    JSON.stringify(value);
  } catch {
    throw new Error('extension result must be JSON serializable');
  }
}
