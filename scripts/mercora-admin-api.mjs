import { createAdminApi } from '../server/admin-control-api.js';
import { loadOrCreateAdminCredential } from '../server/auth/admin-credential.js';

const credential = await loadOrCreateAdminCredential();
const port = Number(process.env.MERCORA_ADMIN_PORT ?? '8787');
const api = createAdminApi({
  token: credential.token,
  tokenFile: credential.tokenFile,
  bootstrapPending: credential.bootstrapPending,
  port
});
await api.listen();
console.log(`MERCORA Admin Control API listening on 127.0.0.1:${port}`);
if (credential.source === 'generated') {
  console.log('MERCORA admin credential generated locally; complete first-run bootstrap from the Admin Console.');
}
