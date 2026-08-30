import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export class SignedUpdateVerifier {
  constructor({ publicKey }) {
    if (!publicKey) throw new Error('update public key is required');
    this.publicKey = publicKey;
  }

  verify(manifest, signatureBase64) {
    validateManifest(manifest);
    const canonical = canonicalJson(manifest);
    const signature = Buffer.from(signatureBase64, 'base64');
    const ok = crypto.verify(null, Buffer.from(canonical), this.publicKey, signature);
    if (!ok) throw new Error('update signature verification failed');
    return true;
  }
}

export class TransactionalUpdateManager {
  constructor({ installDir, stagingDir, fileSystem = fs } = {}) {
    if (!installDir || !stagingDir) throw new Error('installDir and stagingDir are required');
    this.installDir = path.resolve(installDir);
    this.stagingDir = path.resolve(stagingDir);
    this.fileSystem = fileSystem;
  }

  async stage({ version, artifactPath, sha256 }) {
    if (!version || !artifactPath || !/^[a-f0-9]{64}$/i.test(sha256 ?? '')) throw new Error('invalid update artifact');
    const source = path.resolve(artifactPath);
    const bytes = await this.fileSystem.readFile(source);
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    if (digest !== sha256.toLowerCase()) throw new Error('update artifact checksum mismatch');
    const target = path.join(this.stagingDir, version, path.basename(source));
    await this.fileSystem.mkdir(path.dirname(target), { recursive: true });
    await this.fileSystem.writeFile(target, bytes, { mode: 0o700 });
    return { version, target, sha256: digest, bytes: bytes.length };
  }

  async commit({ version, stagedPath }) {
    const source = path.resolve(stagedPath);
    if (!source.startsWith(`${path.join(this.stagingDir, version)}${path.sep}`)) throw new Error('staged update path escapes version staging directory');
    const releaseDir = path.join(this.installDir, 'releases');
    const finalDir = path.join(releaseDir, version);
    const backupFile = path.join(this.installDir, 'previous-release');
    const currentFile = path.join(this.installDir, 'current-release');
    await this.fileSystem.mkdir(finalDir, { recursive: true });
    const finalArtifact = path.join(finalDir, path.basename(source));
    await this.fileSystem.rename(source, finalArtifact);
    const current = await readOptional(this.fileSystem, currentFile);
    if (current) await this.fileSystem.writeFile(backupFile, current, 'utf8');
    await atomicTextWrite(this.fileSystem, currentFile, version);
    return { version, artifact: finalArtifact, previous: current?.trim() ?? null };
  }

  async rollback() {
    const backupFile = path.join(this.installDir, 'previous-release');
    const currentFile = path.join(this.installDir, 'current-release');
    const previous = (await this.fileSystem.readFile(backupFile, 'utf8')).trim();
    if (!previous) throw new Error('no previous release available');
    const releaseDir = path.join(this.installDir, 'releases', previous);
    const stat = await this.fileSystem.stat(releaseDir);
    if (!stat.isDirectory()) throw new Error('previous release is missing');
    const current = (await readOptional(this.fileSystem, currentFile))?.trim() ?? null;
    await atomicTextWrite(this.fileSystem, currentFile, previous);
    if (current) await atomicTextWrite(this.fileSystem, backupFile, current);
    return { version: previous, replaced: current };
  }
}

export class ReleaseChannelPolicy {
  constructor({ channel = 'stable', allowPrerelease = false } = {}) {
    if (!['stable', 'beta', 'nightly'].includes(channel)) throw new Error('invalid release channel');
    this.channel = channel;
    this.allowPrerelease = allowPrerelease || channel !== 'stable';
  }
  allows(version) {
    const prerelease = String(version).includes('-');
    return this.allowPrerelease || !prerelease;
  }
}

function validateManifest(manifest) {
  if (!manifest || manifest.schema !== 'cortex.update/v1' || !manifest.version || !manifest.artifact || !/^[a-f0-9]{64}$/i.test(manifest.sha256 ?? '')) throw new Error('invalid update manifest');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

async function readOptional(fileSystem, file) {
  try { return await fileSystem.readFile(file, 'utf8'); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function atomicTextWrite(fileSystem, file, text) {
  await fileSystem.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fileSystem.writeFile(temp, String(text), { encoding: 'utf8', mode: 0o600 });
  await fileSystem.rename(temp, file);
}
