import fs from 'node:fs/promises';
import path from 'node:path';

const EXISTS = async (fileSystem, file) => {
  try { await fileSystem.access(file); return true; } catch { return false; }
};

const LANGUAGE_MARKERS = Object.freeze([
  ['javascript', ['package.json']],
  ['typescript', ['tsconfig.json']],
  ['python', ['pyproject.toml', 'requirements.txt', 'Pipfile']],
  ['rust', ['Cargo.toml']],
  ['go', ['go.mod']],
  ['java', ['pom.xml', 'build.gradle', 'build.gradle.kts']],
  ['dotnet', ['global.json']],
]);

export class WorkspaceIntelligence {
  constructor(root, { fileSystem = fs } = {}) {
    this.root = path.resolve(root);
    this.fileSystem = fileSystem;
  }

  async inspect() {
    const rootEntries = await this.fileSystem.readdir(this.root, { withFileTypes: true });
    const names = new Set(rootEntries.map((entry) => entry.name));
    const packageJson = await this.#json('package.json');
    const packageManager = detectPackageManager(names, packageJson);
    const languages = detectLanguages(names);
    const scripts = packageJson?.scripts ?? {};
    const containers = ['Dockerfile', 'compose.yml', 'compose.yaml', 'docker-compose.yml', 'docker-compose.yaml'].filter((name) => names.has(name));
    const infrastructure = ['terraform', 'infra', 'infrastructure', 'k8s', 'kubernetes'].filter((name) => names.has(name));
    const cicd = await this.#detectCi();
    const envFiles = [...names].filter((name) => /^\.env(?:\.|$)/.test(name));
    const databases = detectDatabases(packageJson);
    const commands = deriveCommands({ packageManager, scripts, languages, names });

    return {
      schema: 'cortex.workspace-intelligence/v1',
      root: this.root,
      packageManager,
      languages,
      commands,
      containers,
      infrastructure,
      cicd,
      envFiles,
      databases,
      health: this.#health({ packageManager, languages, commands, envFiles }),
    };
  }

  async #json(relative) {
    try {
      return JSON.parse(await this.fileSystem.readFile(path.join(this.root, relative), 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async #detectCi() {
    const workflows = path.join(this.root, '.github', 'workflows');
    if (!await EXISTS(this.fileSystem, workflows)) return [];
    const entries = await this.fileSystem.readdir(workflows, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name)).map((entry) => `.github/workflows/${entry.name}`).sort();
  }

  #health({ packageManager, languages, commands, envFiles }) {
    const findings = [];
    if (!languages.length) findings.push({ severity: 'warning', code: 'language.unknown', message: 'No supported language markers detected.' });
    if (languages.includes('javascript') && !packageManager) findings.push({ severity: 'warning', code: 'package-manager.unknown', message: 'JavaScript project has no deterministic package-manager signal.' });
    if (!commands.test) findings.push({ severity: 'info', code: 'test.command.missing', message: 'No conventional test command detected.' });
    if (envFiles.some((name) => name === '.env')) findings.push({ severity: 'info', code: 'env.local-present', message: 'Local environment file detected; Cortex must not send it to models by default.' });
    return { ok: !findings.some((finding) => finding.severity === 'error'), findings };
  }
}

function detectPackageManager(names, manifest) {
  const declared = manifest?.packageManager?.split('@')[0];
  if (declared) return declared;
  if (names.has('pnpm-lock.yaml')) return 'pnpm';
  if (names.has('yarn.lock')) return 'yarn';
  if (names.has('bun.lock') || names.has('bun.lockb')) return 'bun';
  if (names.has('package-lock.json') || names.has('npm-shrinkwrap.json')) return 'npm';
  return null;
}

function detectLanguages(names) {
  const result = [];
  for (const [language, markers] of LANGUAGE_MARKERS) if (markers.some((marker) => names.has(marker))) result.push(language);
  return result;
}

function detectDatabases(manifest) {
  const deps = { ...(manifest?.dependencies ?? {}), ...(manifest?.devDependencies ?? {}) };
  const mapping = [
    ['postgresql', ['pg', 'postgres', '@prisma/client']],
    ['mysql', ['mysql', 'mysql2']],
    ['sqlite', ['better-sqlite3', 'sqlite3']],
    ['mongodb', ['mongodb', 'mongoose']],
    ['redis', ['redis', 'ioredis']],
  ];
  return mapping.filter(([, packages]) => packages.some((name) => deps[name])).map(([database]) => database);
}

function deriveCommands({ packageManager, scripts, languages, names }) {
  const commands = {};
  if (packageManager && Object.keys(scripts).length) {
    const run = (script) => packageManager === 'npm' ? `npm run ${script}` : `${packageManager} ${script}`;
    for (const kind of ['dev', 'start', 'build', 'test', 'lint', 'typecheck', 'check']) if (scripts[kind]) commands[kind] = run(kind);
  }
  if (!commands.test && languages.includes('rust')) commands.test = 'cargo test';
  if (!commands.build && languages.includes('rust')) commands.build = 'cargo build';
  if (!commands.test && languages.includes('go')) commands.test = 'go test ./...';
  if (!commands.build && languages.includes('go')) commands.build = 'go build ./...';
  if (!commands.test && languages.includes('python')) commands.test = 'python -m pytest';
  if (!commands.build && names.has('pom.xml')) commands.build = './mvnw package';
  return commands;
}
