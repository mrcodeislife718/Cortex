import { spawn } from 'node:child_process';

const clone = (value) => globalThis.structuredClone(value);

export class BoundedProcessRunner {
  constructor({ spawnImpl = spawn, defaultTimeoutMs = 60_000, maxOutputBytes = 2 * 1024 * 1024 } = {}) {
    this.spawnImpl = spawnImpl;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.maxOutputBytes = maxOutputBytes;
  }

  run(command, args = [], { cwd, env = process.env, timeoutMs = this.defaultTimeoutMs, stdin = null } = {}) {
    if (!command || typeof command !== 'string') throw new Error('process command is required');
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) throw new Error('process args must be strings');
    return new Promise((resolve, reject) => {
      const child = this.spawnImpl(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
      let stdout = '';
      let stderr = '';
      let bytes = 0;
      let settled = false;
      let timer = null;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        fn(value);
      };
      const collect = (target, chunk) => {
        bytes += chunk.length;
        if (bytes > this.maxOutputBytes) {
          child.kill('SIGKILL');
          finish(reject, new Error(`process output exceeded ${this.maxOutputBytes} bytes`));
          return;
        }
        if (target === 'stdout') stdout += chunk.toString();
        else stderr += chunk.toString();
      };
      child.stdout.on('data', (chunk) => collect('stdout', chunk));
      child.stderr.on('data', (chunk) => collect('stderr', chunk));
      child.once('error', (error) => finish(reject, error));
      child.once('exit', (code, signal) => finish(resolve, {
        ok: code === 0,
        code,
        signal,
        stdout,
        stderr,
        command: { command, args: [...args] },
      }));
      timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(reject, new Error(`process execution exceeded ${timeoutMs}ms`));
      }, timeoutMs);
      if (stdin !== null) child.stdin.end(String(stdin)); else child.stdin.end();
    });
  }
}

export class SshRemoteExecutor {
  constructor({ runner = new BoundedProcessRunner(), securityKernel = null, sshBinary = 'ssh' } = {}) {
    this.runner = runner;
    this.securityKernel = securityKernel;
    this.sshBinary = sshBinary;
  }

  commandSpec({ host, user = null, port = null, identityFile = null, command, args = [] }) {
    if (!validHost(host)) throw new Error('invalid SSH host');
    if (!command) throw new Error('remote command is required');
    const sshArgs = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes'];
    if (port !== null) sshArgs.push('-p', String(port));
    if (identityFile) sshArgs.push('-i', identityFile);
    sshArgs.push(user ? `${user}@${host}` : host, '--', command, ...args);
    return { command: this.sshBinary, args: sshArgs };
  }

  async run(request, { token = null, timeoutMs } = {}) {
    this.securityKernel?.require(token, { capability: 'remote.ssh.execute', executionLevel: 'WORKSPACE_EXECUTE', resource: request.host });
    const spec = this.commandSpec(request);
    return this.runner.run(spec.command, spec.args, { timeoutMs });
  }
}

export class ContainerExecutor {
  constructor({ runner = new BoundedProcessRunner(), securityKernel = null, runtime = 'docker' } = {}) {
    if (!['docker', 'podman'].includes(runtime)) throw new Error('unsupported container runtime');
    this.runner = runner;
    this.securityKernel = securityKernel;
    this.runtime = runtime;
  }

  commandSpec({ container, command, args = [], workdir = null, env = {} }) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container ?? '')) throw new Error('invalid container identifier');
    if (!command) throw new Error('container command is required');
    const runtimeArgs = ['exec'];
    if (workdir) runtimeArgs.push('--workdir', workdir);
    for (const [key, value] of Object.entries(env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`invalid environment key: ${key}`);
      runtimeArgs.push('--env', `${key}=${value}`);
    }
    runtimeArgs.push(container, command, ...args);
    return { command: this.runtime, args: runtimeArgs };
  }

  async run(request, { token = null, timeoutMs } = {}) {
    this.securityKernel?.require(token, { capability: 'remote.container.execute', executionLevel: 'WORKSPACE_EXECUTE', resource: request.container });
    const spec = this.commandSpec(request);
    return this.runner.run(spec.command, spec.args, { timeoutMs });
  }
}

export class RemoteWorkspaceRegistry {
  constructor() { this.workspaces = new Map(); }
  register({ id, kind, target, metadata = {} }) {
    if (!id || !['ssh', 'container', 'vm', 'cloud'].includes(kind) || !target) throw new Error('invalid remote workspace');
    if (this.workspaces.has(id)) throw new Error(`remote workspace already registered: ${id}`);
    this.workspaces.set(id, { id, kind, target, metadata: clone(metadata), status: 'disconnected' });
    return this.get(id);
  }
  setStatus(id, status) {
    if (!['disconnected', 'connecting', 'connected', 'degraded', 'failed'].includes(status)) throw new Error('invalid remote workspace status');
    const entry = this.#get(id); entry.status = status; return clone(entry);
  }
  get(id) { return clone(this.#get(id)); }
  list() { return [...this.workspaces.values()].map(clone); }
  #get(id) { const value = this.workspaces.get(id); if (!value) throw new Error(`unknown remote workspace: ${id}`); return value; }
}

function validHost(host) {
  return typeof host === 'string' && host.length > 0 && host.length <= 253 && /^[A-Za-z0-9._:-]+$/.test(host);
}
