import { createAdminApi } from '../server/admin-control-api.js';

const port = Number(process.env.MERCORA_ADMIN_PORT ?? '8787');
const api = createAdminApi({ port });
await api.listen();
console.log(`MERCORA Admin Control API listening on 127.0.0.1:${port}`);
