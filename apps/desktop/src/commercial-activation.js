import { invoke } from '@tauri-apps/api/core';

const apiUrl = String(import.meta.env.VITE_CORTEX_COMMERCIAL_API_URL ?? '').trim().replace(/\/$/, '');

if (apiUrl) await enforceCommercialActivation();

async function enforceCommercialActivation() {
  const overlay = buildOverlay();
  document.body.append(overlay);
  const status = overlay.querySelector('[data-status]');
  const form = overlay.querySelector('form');
  const input = overlay.querySelector('input');
  const accountLink = overlay.querySelector('[data-account]');
  let config = null;

  try {
    config = await fetchJson(`${apiUrl}?action=config`);
    accountLink.href = `${String(config.appUrl).replace(/\/$/, '')}/account`;
  } catch {
    accountLink.href = '#';
  }

  try {
    const hasSession = await invoke('has_commercial_session');
    if (hasSession) {
      status.textContent = 'Verifying Cortex entitlement…';
      const entitlement = await invoke('commercial_entitlements', { apiUrl });
      if (isDesktopEntitled(entitlement)) {
        overlay.remove();
        return;
      }
    }
  } catch {
    // A stale or unavailable session falls through to explicit activation.
  }

  status.textContent = 'Enter the one-time code from your Cortex account.';
  input.focus();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = input.value.trim();
    if (!code) return;
    setBusy(true);
    try {
      status.textContent = 'Activating Cortex…';
      await invoke('redeem_activation', { apiUrl, code });
      const entitlement = await invoke('commercial_entitlements', { apiUrl });
      if (!isDesktopEntitled(entitlement)) throw new Error('Desktop entitlement is not active.');
      status.textContent = 'Cortex activated.';
      overlay.classList.add('activation-success');
      setTimeout(() => overlay.remove(), 320);
    } catch (error) {
      status.textContent = readableError(error);
      input.select();
      setBusy(false);
    }
  });

  accountLink.addEventListener('click', async (event) => {
    if (!config?.appUrl) {
      event.preventDefault();
      status.textContent = 'Cortex account service is unavailable.';
      return;
    }
    // target=_blank lets the OS/webview open the commercial account without replacing the IDE document.
  });

  function setBusy(busy) {
    input.disabled = busy;
    form.querySelector('button').disabled = busy;
  }
}

function isDesktopEntitled(value) {
  return value?.active === true && Array.isArray(value.entitlements) && (value.entitlements.includes('ide.desktop') || value.entitlements.includes('*'));
}

function buildOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'commercial-activation';
  overlay.innerHTML = `
    <style>
      .commercial-activation{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;background:radial-gradient(circle at 50% 10%,#241b3b 0,transparent 32rem),#101014;color:#eceaf1;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;transition:opacity .28s ease}
      .commercial-activation.activation-success{opacity:0}
      .activation-card{width:min(440px,calc(100vw - 40px));padding:30px;border:1px solid #332d40;border-radius:14px;background:linear-gradient(180deg,#1a191f,#151519);box-shadow:0 28px 90px rgba(0,0,0,.42)}
      .activation-brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:.12em;font-size:12px}.activation-mark{width:34px;height:34px;display:grid;place-items:center;border-radius:9px;background:#211b31;border:1px solid #594b7c;color:#f3efff;font-size:16px}
      .activation-card h1{font-size:25px;letter-spacing:-.035em;margin:28px 0 8px}.activation-card p{color:#aaa6b3;font-size:13px;line-height:1.6;margin:0 0 18px}.activation-card form{display:flex;gap:8px}.activation-card input{min-width:0;flex:1;border:1px solid #3a3743;border-radius:7px;padding:11px 12px;color:#eee;background:#101014;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;outline:none}.activation-card input:focus{border-color:#8f74ff;box-shadow:0 0 0 2px rgba(143,116,255,.12)}.activation-card button{border:0;border-radius:7px;background:#8066ee;color:white;font-weight:650;padding:0 16px;cursor:pointer}.activation-card button:disabled{opacity:.5}.activation-status{min-height:20px;margin-top:12px!important;font-size:11px!important}.activation-footer{display:flex;align-items:center;justify-content:space-between;margin-top:20px;padding-top:16px;border-top:1px solid #282630;font-size:11px;color:#888491}.activation-footer a{color:#aa96ff;text-decoration:none}.activation-footer a:hover{text-decoration:underline}
    </style>
    <section class="activation-card" role="dialog" aria-modal="true" aria-labelledby="activation-title">
      <div class="activation-brand"><span class="activation-mark">C</span><span>CORTEX</span></div>
      <h1 id="activation-title">Activate Cortex</h1>
      <p>Your Cortex desktop license unlocks the full IDE on this device. Activation is stored securely by your operating system.</p>
      <form><input name="code" autocomplete="one-time-code" spellcheck="false" placeholder="One-time activation code" aria-label="Cortex activation code"/><button type="submit">Activate</button></form>
      <p class="activation-status" data-status>Checking Cortex entitlement…</p>
      <div class="activation-footer"><span>Pro · Team · Enterprise</span><a data-account target="_blank" rel="noopener noreferrer">Get activation code</a></div>
    </section>`;
  return overlay;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`Cortex account service returned ${response.status}`);
  return response.json();
}

function readableError(error) {
  const message = String(error?.message ?? error ?? 'Activation failed.');
  if (/402|entitlement/i.test(message)) return 'This account does not currently include Cortex desktop access.';
  if (/401|activation/i.test(message)) return 'That activation code is invalid or expired. Generate a new code from your Cortex account.';
  return `Activation failed: ${message}`;
}
