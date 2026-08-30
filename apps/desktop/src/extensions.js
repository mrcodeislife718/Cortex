import { VsCodeExtensionAdapter } from '../../../src/vscode-compatibility.js';
import './extensions.css';

const adapter = new VsCodeExtensionAdapter({ allowUnsupported: false });
const extensionsButton = document.querySelector('.activity[data-view="extensions"]');

extensionsButton?.addEventListener('click', (event) => {
  event.stopImmediatePropagation();
  document.querySelectorAll('.activity').forEach((item) => item.classList.toggle('active', item === extensionsButton));
  renderExtensions();
}, { capture: true });

function renderExtensions() {
  const title = document.getElementById('side-title');
  const side = document.getElementById('side-content');
  if (!title || !side) return;
  title.textContent = 'EXTENSIONS';
  side.replaceChildren();

  const header = document.createElement('section');
  header.className = 'extension-manager';
  header.innerHTML = `
    <div class="extension-manager-heading"><strong>Cortex Extensions</strong><span class="extension-state">SECURE BY DEFAULT</span></div>
    <p>Assess a VS Code extension manifest against Cortex's real compatibility boundary before installation or execution.</p>
    <label class="extension-import">Assess VS Code package.json<input id="extension-manifest-input" type="file" accept="application/json,.json" /></label>
    <div class="extension-policy"><span>✓ capability-scoped</span><span>✓ lazy activation</span><span>✓ signed package path</span><span>✓ process isolation</span></div>
    <div id="extension-assessment"></div>`;
  side.append(header);
  header.querySelector('#extension-manifest-input')?.addEventListener('change', assessSelectedManifest);
}

async function assessSelectedManifest(event) {
  const file = event.target.files?.[0];
  const target = document.getElementById('extension-assessment');
  if (!file || !target) return;
  target.replaceChildren();
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('Extension manifest exceeds Cortex 2 MB assessment limit.');
    const manifest = JSON.parse(await file.text());
    const result = adapter.qualify(manifest);
    if (!result.compatible) {
      renderRejected(target, manifest, result.unsupported);
      return;
    }
    renderCompatible(target, result.manifest);
  } catch (error) {
    const message = document.createElement('div');
    message.className = 'extension-assessment extension-rejected';
    message.textContent = `Assessment failed: ${String(error?.message ?? error)}`;
    target.append(message);
  } finally {
    event.target.value = '';
  }
}

function renderCompatible(target, manifest) {
  const card = document.createElement('article');
  card.className = 'extension-assessment extension-compatible';
  const contributions = Object.entries(manifest.contributions ?? {}).filter(([, value]) => Array.isArray(value) ? value.length : Boolean(value));
  card.innerHTML = `
    <div class="extension-result-title"><strong></strong><span>COMPATIBLE</span></div>
    <dl>
      <dt>Version</dt><dd></dd>
      <dt>Runtime</dt><dd></dd>
      <dt>Execution</dt><dd></dd>
      <dt>Capabilities</dt><dd></dd>
      <dt>Activation</dt><dd></dd>
      <dt>Contributions</dt><dd></dd>
    </dl>
    <p class="extension-note">Compatibility means the manifest can cross Cortex's translation boundary. It does not bypass signature, capability, isolation, or installation policy.</p>`;
  const [title, version, runtime, execution, capabilities, activation, contributionNode] = [
    card.querySelector('.extension-result-title strong'), ...card.querySelectorAll('dd')
  ];
  title.textContent = manifest.id;
  version.textContent = manifest.version;
  runtime.textContent = manifest.runtime;
  execution.textContent = manifest.executionLevel;
  capabilities.textContent = manifest.capabilities.join(', ') || 'none';
  activation.textContent = manifest.activationEvents.join(', ') || 'on demand';
  contributionNode.textContent = contributions.map(([name]) => name).join(', ') || 'none';
  target.append(card);
}

function renderRejected(target, source, unsupported) {
  const card = document.createElement('article');
  card.className = 'extension-assessment extension-rejected';
  const id = `${source.publisher ?? 'unpublished'}.${source.name ?? 'unknown'}`;
  card.innerHTML = `<div class="extension-result-title"><strong></strong><span>REJECTED</span></div><p>Cortex will not silently grant unsupported VS Code extension surfaces.</p><div class="extension-unsupported"></div>`;
  card.querySelector('strong').textContent = id;
  card.querySelector('.extension-unsupported').textContent = `Unsupported contributions: ${unsupported.join(', ') || 'unknown'}`;
  target.append(card);
}
