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
    terminalExitGraceMs = 250,
  } = {}) {
    this.workerPath = workerPath;
    this.node = node;
    this.envKeys = [...new Set(envKeys)];
    this.defaultTimeoutMs = positiveInteger(defaultTimeoutMs, 'defaultTimeoutMs');
    this.maxOutputBytes = positiveInteger(maxOutputBytes, 'maxOutputBytes');
    this.maxOldSpaceMb = positiveInteger(maxOldSpaceMb, 'maxOldSpaceMb');
    this.terminalExitGraceMs = positiveInteger(terminalExitGraceMs, 'terminalExitGraceMs');
  }

  async run({ modulePath, exportName = 'activate', payload = null, cwd = process.cwd(), timeoutMs = this.defaultTimeoutMs } = {}) {
    if (!modulePath) throw new Error('extension modulePath is required');
    timeoutMs = positiveInteger(timeoutMs, 'timeoutMs');
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
    let terminal = null;
    let forcedTermination = false;
    let terminalTimer = null;

    return await new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeoutTimer);
        if (terminalTimer) clearTimeout(terminalTimer);
      };
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
      const kill = (signal = 'SIGKILL') => {
        if (child.exitCode == null && child.signalCode == null) {
          forcedTermination = true;
          try { child.kill(signal); } catch {}
        }
      };
      const failAndKill = (error) => {
        if (terminal == null) terminal = { type: 'host-error', error };
        kill('SIGKILL');
      };
      const awaitTerminalExit = () => {
        if (terminalTimer || settled) return;
        terminalTimer = setTimeout(() => kill('SIGKILL'), this.terminalExitGraceMs);
        terminalTimer.unref?.();
      };

      const append = (stream, chunk) => {
        const bytes = Buffer.from(chunk);
        totalBytes += bytes.length;
        if (totalBytes > this.maxOutputBytes) {
          failAndKill(new Error(`extension output exceeded ${this.maxOutputBytes} bytes`));
          return;
        }
        const text = bytes.toString();
        if (stream === 'stdout') stdout += text;
        else stderr += text;
      };

      child.stdout?.on('data', (chunk) => append('stdout', chunk));
      child.stderr?.on('data', (chunk) => append('stderr', chunk));

      const timeoutTimer = setTimeout(() => {
        failAndKill(new Error(`extension execution exceeded ${timeoutMs}ms`));
      }, timeoutMs);
      timeoutTimer.unref?.();

      child.once('error', (error) => {
        finishReject(error);
      });

      child.once('exit', (code, signal) => {
        if (settled) return;
        if (terminal?.type === 'result') {
          finishResolve({ ok: true, result: terminal.result, stdout, stderr, pid: child.pid, forcedTermination, exit: { code, signal } });
          return;
        }
        if (terminal?.type === 'extension-error') {
          finishReject(new Error(`extension failed: ${terminal.message}`));
          return;
        }
        if (terminal?.type === 'host-error') {
          finishReject(terminal.error);
          return;
        }
        if (totalBytes > this.maxOutputBytes) {
          finishReject(new Error(`extension output exceeded ${this.maxOutputBytes} bytes`));
          return;
        }
        finishReject(new Error(`extension host exited before result (code=${code}, signal=${signal})`));
      });

      child.on('message', (message) => {
        if (terminal || !message || typeof message !== 'object') return;
        if (message.type === 'result') {
          terminal = { type: 'result', result: message.result };
          awaitTerminalExit();
        } else if (message.type === 'error') {
          terminal = { type: 'extension-error', message: message.message };
          awaitTerminalExit();
        }
      });

      try {
        child.send({ type: 'execute', modulePath: absoluteModule, exportName, payload }, (error) => {
          if (error && !settled) failAndKill(new Error(`extension IPC send failed: ${error.message}`));
        });
      } catch (error) {
        failAndKill(new Error(`extension IPC send failed: ${error.message}`));
      }
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

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
  return value;
}
