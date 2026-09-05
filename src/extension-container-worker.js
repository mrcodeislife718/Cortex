import { pathToFileURL } from 'node:url';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

try {
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!request || request.protocol !== 'cortex-extension/1') throw new Error('unsupported extension worker protocol');
  if (typeof request.modulePath !== 'string' || !request.modulePath.startsWith('/extension/')) throw new Error('extension module path must be inside /extension');
  const module = await import(pathToFileURL(request.modulePath).href);
  const handler = module[request.exportName ?? 'activate'];
  if (typeof handler !== 'function') throw new Error(`extension export is not callable: ${request.exportName ?? 'activate'}`);
  const result = await handler(request.payload ?? null, Object.freeze({ workspace: request.workspace ?? '/workspace' }));
  assertSerializable(result);
  process.stdout.write(JSON.stringify({ protocol: 'cortex-extension/1', ok: true, result }) + '\n');
} catch (error) {
  process.stdout.write(JSON.stringify({
    protocol: 'cortex-extension/1',
    ok: false,
    error: { name: error?.name ?? 'Error', message: error?.message ?? String(error) }
  }) + '\n');
  process.exitCode = 1;
}

function assertSerializable(value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('extension result must be JSON serializable');
}
