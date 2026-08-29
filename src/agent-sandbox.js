import fs from 'node:fs/promises';
import path from 'node:path';
import { BoundedProcessRunner } from './remote-execution.js';

export class ContainerAgentSandbox {
  constructor({ runner = new BoundedProcessRunner(), runtime = 'docker', securityKernel = null, image = 'node:24-alpine', defaultMemoryMb = 512, defaultCpu = 1, defaultPids = 128 } = {}) {
    if (!['docker', 'podman'].includes(runtime)) throw new Error('unsupported sandbox runtime');
    this.runner = runner;
    this.runtime = runtime;
    this.securityKernel = securityKernel;
    this.image = image;
    this.defaultMemoryMb = defaultMemoryMb;
    this.defaultCpu = defaultCpu;
    this.defaultPids = defaultPids;
  }

  commandSpec({ workspace, command, args = [], network = false, writableWorkspace = false, memoryMb = this.defaultMemoryMb, cpu = this.defaultCpu, pids = this.defaultPids, env = {} }) {
    if (!workspace || !command) throw new Error('sandbox requires workspace and command');
    const root = path.resolve(workspace);
    const mount = `type=bind,src=${root},dst=/workspace${writableWorkspace ? '' : ',readonly'}`;
    const runtimeArgs = [
      'run', '--rm', '--init',
      '--security-opt', 'no-new-privileges=true',
      '--cap-drop', 'ALL',
      '--pids-limit', String(pids),
      '--memory', `${memoryMb}m`,
      '--cpus', String(cpu),
      '--read-only',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=128m,mode=1777',
      '--mount', mount,
      '--workdir', '/workspace',
    ];
    const hostUser = hostUserSpec();
    if (hostUser) runtimeArgs.push('--user', hostUser);
    if (!network) runtimeArgs.push('--network', 'none');
    for (const [key, value] of Object.entries(env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`invalid sandbox environment key: ${key}`);
      runtimeArgs.push('--env', `${key}=${value}`);
    }
    runtimeArgs.push(this.image, command, ...args);
    return { command: this.runtime, args: runtimeArgs, mount };
  }

  async run(request, { token = null, timeoutMs = 120_000 } = {}) {
    const stat = await fs.stat(path.resolve(request.workspace));
    if (!stat.isDirectory()) throw new Error('sandbox workspace must be a directory');
    const capability = request.writableWorkspace ? 'sandbox.workspace.write' : 'sandbox.workspace.read';
    this.securityKernel?.require(token, { capability, executionLevel: 'SANDBOX_EXECUTE', resource: path.resolve(request.workspace) });
    if (request.network) this.securityKernel?.require(token, { capability: 'network.internet', executionLevel: 'SANDBOX_EXECUTE', resource: 'agent-sandbox' });
    const spec = this.commandSpec(request);
    return this.runner.run(spec.command, spec.args, { timeoutMs, env: pickRuntimeEnvironment(process.env) });
  }
}

export class SandboxPolicy {
  constructor({ allowedImages = [], maxMemoryMb = 2048, maxCpu = 4, maxPids = 256, allowNetwork = false } = {}) {
    this.allowedImages = new Set(allowedImages);
    this.maxMemoryMb = maxMemoryMb;
    this.maxCpu = maxCpu;
    this.maxPids = maxPids;
    this.allowNetwork = allowNetwork;
  }
  evaluate(request, image) {
    const reasons = [];
    if (this.allowedImages.size && !this.allowedImages.has(image)) reasons.push('image-not-allowed');
    if ((request.memoryMb ?? 0) > this.maxMemoryMb) reasons.push('memory-limit-exceeded');
    if ((request.cpu ?? 0) > this.maxCpu) reasons.push('cpu-limit-exceeded');
    if ((request.pids ?? 0) > this.maxPids) reasons.push('pid-limit-exceeded');
    if (request.network && !this.allowNetwork) reasons.push('network-not-allowed');
    return { allowed: reasons.length === 0, reasons };
  }
}

export function pickRuntimeEnvironment(source) {
  const output = {};
  for (const key of ['PATH', 'HOME', 'USERPROFILE', 'DOCKER_HOST', 'XDG_RUNTIME_DIR']) if (source[key] !== undefined) output[key] = source[key];
  return output;
}

export function hostUserSpec() {
  if (typeof process.getuid !== 'function' || typeof process.getgid !== 'function') return null;
  return `${process.getuid()}:${process.getgid()}`;
}
