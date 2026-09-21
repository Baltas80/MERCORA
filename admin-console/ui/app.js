const invoke = window.__TAURI__?.core?.invoke;
const login = document.querySelector('#login');
const dashboard = document.querySelector('#dashboard');
const form = document.querySelector('#login-form');
const tokenInput = document.querySelector('#token');
const loginError = document.querySelector('#login-error');
const output = document.querySelector('#output');
const grid = document.querySelector('#status-grid');
const overall = document.querySelector('#overall');

const services = ['MERCORA','TOR','BACKEND','POSTGRESQL','ONION SERVICE','STORAGE','HEALTH CHECKS'];
let authenticated = false;

function showDashboard() {
  login.classList.add('hidden');
  dashboard.classList.remove('hidden');
}

function render(status) {
  const values = {
    'MERCORA': status.mercora ?? 'unknown',
    'TOR': status.tor ?? 'unknown',
    'BACKEND': status.backend ?? 'unknown',
    'POSTGRESQL': status.postgresql ?? 'unknown',
    'ONION SERVICE': status.onionService ?? 'unknown',
    'STORAGE': status.storage ?? 'unknown',
    'HEALTH CHECKS': status.health ?? 'unknown'
  };
  grid.innerHTML = services.map(name => {
    const state = String(values[name]).toUpperCase();
    const cls = state === 'ONLINE' || state === 'OK' || state === 'RUNNING' ? 'ok' : state === 'OFFLINE' || state === 'ERROR' ? 'bad' : 'unknown';
    return `<article class="status-card"><div class="name">${name}</div><div class="state ${cls}">${state}</div></article>`;
  }).join('');
  const allGood = ['MERCORA','TOR','BACKEND','POSTGRESQL','HEALTH CHECKS'].every(k => ['ONLINE','OK','RUNNING'].includes(String(values[k]).toUpperCase()));
  overall.textContent = allGood ? 'ONLINE' : 'DEGRADED';
  overall.className = `badge ${allGood ? 'ok' : 'bad'}`;
}

async function request(method, path, body) {
  if (!invoke) throw new Error('Tauri runtime unavailable');
  return JSON.parse(await invoke('admin_request', { method, path, body: body ? JSON.stringify(body) : null }));
}

async function refresh() {
  try {
    const status = await request('GET', '/api/admin/status');
    render(status);
  } catch (error) {
    overall.textContent = 'OFFLINE';
    overall.className = 'badge bad';
    output.textContent = String(error.message || error);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.hidden = true;
  try {
    await invoke('set_token', { token: tokenInput.value });
    await request('GET', '/api/admin/status');
    authenticated = true;
    tokenInput.value = '';
    showDashboard();
    await refresh();
  } catch (error) {
    await invoke('clear_token').catch(() => {});
    loginError.textContent = 'Connection failed. Check the local Admin Control API and token.';
    loginError.hidden = false;
  }
});

document.querySelector('#logout').addEventListener('click', async () => {
  authenticated = false;
  await invoke('clear_token').catch(() => {});
  dashboard.classList.add('hidden');
  login.classList.remove('hidden');
});

document.querySelectorAll('[data-action]').forEach(button => {
  button.addEventListener('click', async () => {
    if (!authenticated) return;
    const action = button.dataset.action;
    output.textContent = `Executing ${action}...`;
    try {
      const result = await request('POST', '/api/admin/action', { action });
      output.textContent = JSON.stringify(result, null, 2);
      await refresh();
    } catch (error) {
      output.textContent = String(error.message || error);
    }
  });
});

render({});
