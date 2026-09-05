import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BoundedProcessRunner } from './remote-execution.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultWorker = path.join(here, 'extension-container-worker.js');

export class ExtensionContainerHost {
  constructor({
    runner = new BoundedProcessRunner({ defaultTimeoutMs: 15_000, maxOutputBytes: 512 * 1024 }),
    runtime = 'docker',
    image = 'node:24-alpine',
    workerPath = defaultWorker,
    memoryMb = 256,
    cpu = 1,
    pids = 64,
    maxOutputBytes = 512 * 1024,
    defaultTimeoutMs = 15_000
  } = {}) {
    if (!['docker','podman'].includes(runtime)) throw new Error('unsupported extension container runtime');
    this.runner = runner;
    this.runtime = runtime;
    this.image = image;
    this.workerPath = path.resolve(workerPath);
    this.memoryMb = positive(memoryMb, 'memoryMb');
    this.cpu = positive(cpu, 'cpu');
    this.pids = positive(pids, 'pids');
    this.maxOutputBytes = positive(maxOutputBytes, 'maxOutputBytes');
    this.defaultTimeoutMs = positive(defaultTimeoutMs, 'defaultTimeoutMs');
  }

  async commandSpec({ extensionRoot, modulePath, workspace, writableWorkspace = false, network = false } = {}) {
    if (!extensionRoot || !modulePath || !workspace) throw new Error('extensionRoot, modulePath, and workspace are required');
    const extension = await realDirectory(extensionRoot, 'extensionRoot');
    const work = await realDirectory(workspace, 'workspace');
    const module = await realContainedFile(extension, modulePath);
    const worker = await fs.realpath(this.workerPath);
    const workerStat = await fs.stat(worker);
    if (!workerStat.isFile()) throw new Error('extension worker must be a file');
    const relativeModule = path.relative(extension, module);
    const containerModule = `/extension/${relativeModule.split(path.sep).join('/')}`;
    const args = [
      'run','--rm','--init','-i',
      '--security-opt','no-new-privileges=true',
      '--cap-drop','ALL',
      '--pids-limit',String(this.pids),
      '--memory',`${this.memoryMb}m`,
      '--cpus',String(this.cpu),
      '--read-only',
      '--tmpfs','/tmp:rw,noexec,nosuid,size=64m,mode=1777',
      '--mount',`type=bind,src=${extension},dst=/extension,readonly`,
      '--mount',`type=bind,src=${work},dst=/workspace${writableWorkspace ? '' : ',readonly'}`,
      '--mount',`type=bind,src=${worker},dst=/cortex/extension-worker.mjs,readonly`,
      '--workdir','/workspace'
    ];
    const user = hostUser();
    if (user) args.push('--user', user);
    if (!network) args.push('--network','none');
    args.push(this.image, 'node', '/cortex/extension-worker.mjs');
    return { command: this.runtime, args, containerModule, extensionRoot: extension, workspace: work };
  }

  async run({ extensionRoot, modulePath, workspace, exportName = 'activate', payload = null, writableWorkspace = false, network = false } = {}, { timeoutMs = this.defaultTimeoutMs } = {}) {
    const spec = await this.commandSpec({ extensionRoot, modulePath, workspace, writableWorkspace, network });
    const request = JSON.stringify({ protocol:'cortex-extension/1', modulePath:spec.containerModule, exportName, payload, workspace:'/workspace' });
    const result = await this.runner.run(spec.command, spec.args, { timeoutMs, stdin: request, env: pickContainerEnvironment(process.env) });
    const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length !== 1) throw new Error(`extension sandbox returned ${lines.length} response lines`);
    let message;
    try { message = JSON.parse(lines[0]); }
    catch (error) { throw new Error(`extension sandbox returned invalid JSON: ${error.message}`); }
    if (message?.protocol !== 'cortex-extension/1') throw new Error('extension sandbox returned unsupported protocol');
    if (!result.ok || !message.ok) throw new Error(`sandboxed extension failed: ${message?.error?.message ?? result.stderr.trim() ?? `exit ${result.code}`}`);
    return { ok:true, result:message.result, stdout:result.stdout, stderr:result.stderr, isolation:{ runtime:this.runtime, image:this.image, network, writableWorkspace } };
  }
}

async function realDirectory(value, label) {
  const real = await fs.realpath(path.resolve(value));
  const stat = await fs.stat(real);
  if (!stat.isDirectory()) throw new Error(`${label} must be a directory`);
  return real;
}

async function realContainedFile(root, modulePath) {
  const candidate = path.resolve(root, modulePath);
  const real = await fs.realpath(candidate);
  if (real !== root && !real.startsWith(root + path.sep)) throw new Error('extension module escapes extension root');
  const stat = await fs.stat(real);
  if (!stat.isFile()) throw new Error('extension module must be a file');
  return real;
}

function positive(value, name) { if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${name} must be positive`); return value; }
function hostUser() { return typeof process.getuid === 'function' && typeof process.getgid === 'function' ? `${process.getuid()}:${process.getgid()}` : null; }
function pickContainerEnvironment(source) { const output={}; for(const key of ['PATH','HOME','USERPROFILE','DOCKER_HOST','XDG_RUNTIME_DIR']) if(source[key]!==undefined) output[key]=source[key]; return output; }
