const action = String(process.argv[2] ?? 'STATUS').toUpperCase();
const service = process.argv[3];
const username = process.env.MERCORA_ADMIN_USERNAME;
const password = process.env.MERCORA_ADMIN_PASSWORD;
const port = Number(process.env.MERCORA_ADMIN_PORT ?? '8787');

if (!username || !password) {
  console.error('MERCORA_ADMIN_USERNAME and MERCORA_ADMIN_PASSWORD are required for CLI authentication.');
  process.exit(2);
}

const login = await fetch(`http://127.0.0.1:${port}/v1/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, password })
});
if (!login.ok) {
  console.error('Admin authentication failed.');
  process.exit(1);
}

const setCookie = login.headers.getSetCookie?.() ?? [];
const cookie = setCookie[0]?.split(';', 1)[0] ?? login.headers.get('set-cookie')?.split(';', 1)[0];
if (!cookie) {
  console.error('Admin authentication session was not established.');
  process.exit(1);
}

try {
  const response = await fetch(`http://127.0.0.1:${port}/v1/control`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...(service ? { service } : {}) })
  });
  console.log(await response.text());
  process.exit(response.ok ? 0 : 1);
} finally {
  await fetch(`http://127.0.0.1:${port}/v1/logout`, {
    method: 'POST',
    headers: { cookie }
  }).catch(() => {});
}
