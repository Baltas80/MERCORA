const action = String(process.argv[2] ?? 'STATUS').toUpperCase();
const service = process.argv[3];
const token = process.env.MERCORA_ADMIN_TOKEN;
const port = Number(process.env.MERCORA_ADMIN_PORT ?? '8787');

if (!token) {
  console.error('MERCORA_ADMIN_TOKEN is required.');
  process.exit(2);
}

const response = await fetch(`http://127.0.0.1:${port}/v1/control`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ action, ...(service ? { service } : {}) })
});
const body = await response.text();
console.log(body);
process.exit(response.ok ? 0 : 1);
