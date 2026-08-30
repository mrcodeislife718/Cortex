import { fork } from 'node:child_process';
import path from 'node:path';

const DEFAULT_ENV_KEYS = ['PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'ComSpec'];

export class ExtensionProcessHost {
  constructor({
    workerPath = new URL('./extension-worker.js', import.meta.url),
    node = process.execPath,
    envKeys = DEFAULT_ENV_KEYS,
    defaultTimeoutMs = 5_000,
    maxOutputBytes = 256 * 1024,
    maxOldSpaceMb = 128,
  } = {}) {
    this.workerPath = workerPath;
    this.node = node;
    this.envKeys = [...new Set(envKeys)];
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.maxOutputBytes = maxOutputBytes;
    this.maxOldSpaceMb = maxOldSpaceMb;
  }

  async run({ modulePath, exportName = 'activate', payload = null, cwd = process.cwd(), timeoutMs = this.defaultTimeoutMs } = {}) {
    if (!modulePath) throw new Error('extension modulePath is required');
    const absoluteModule = path.resolve(cwd, modulePath);
    const env = pickEnvironment(process.env, this.envKeys);
    const child = fork(this.workerPath, [], {
      cwd: path.resolve(cwd),
      env,
      execPath: this.node,
      execArgv: [`--max-old-space-size=${this.maxOldSpaceMb}`],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      serialization: 'json',
    });

    let stdout = '';
    let stderr = '';
    let totalBytes = 0;
    let settled = false;

    const append = (stream, chunk) => {
      const text = chunk.toString();
      totalBytes += Buffer.byteLength(text);
      if (totalBytes > this.maxOutputBytes) {
        child.kill('SIGKILL');
        return;
      }
      if (stream === 'stdout') stdout += text;
      else stderr += text;
    };

    child.stdout?.on('data', (chunk) => append('stdout', chunk));
    child.stderr?.on('data', (chunk) => append('stderr', chunk));

    return await new Promise((resolve, reject) => {
      const cleanup = () => clearTimeout(timer);
      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const finishResolve = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finishReject(new Error(`extension execution exceeded ${timeoutMs}ms`));
      }, timeoutMs);

      child.once('error', finishReject);
      child.once('exit', (code, signal) => {
        if (settled) return;
        if (totalBytes > this.maxOutputBytes) {
          finishReject(new Error(`extension output exceeded ${this.maxOutputBytes} bytes`));
          return;
        }
        finishReject(new Error(`extension host exited before result (code=${code}, signal=${signal})`));
      });
      child.on('message', (message) => {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'result') {
          finishResolve({ ok: true, result: message.result, stdout, stderr, pid: child.pid });
          child.disconnect();
          child.kill('SIGTERM');
        } else if (message.type === 'error') {
          finishReject(new Error(`extension failed: ${message.message}`));
          child.disconnect();
          child.kill('SIGTERM');
        }
      });

      child.send({ type: 'execute', modulePath: absoluteModule, exportName, payload });
    });
  }
}

export function pickEnvironment(source, allowedKeys = DEFAULT_ENV_KEYS) {
  const env = {};
  for (const key of allowedKeys) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  return env;
}
