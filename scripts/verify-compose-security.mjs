import { readFile } from 'node:fs/promises';

const compose = await readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8');
const postgres = compose.match(/^  postgres:\n([\s\S]*?)(?=^  app:\n|^networks:\n|^volumes:\n)/m)?.[1] ?? '';

const required = [
  ['PostgreSQL service must exist', postgres.length > 0],
  ['PostgreSQL must not publish host ports', !/^\s+ports:/m.test(postgres)],
  ['backend network must be internal', /networks:\s*\n\s*backend:\s*\n\s*internal:\s*true/m.test(compose)],
  ['application must bind only to loopback during development', /127\.0\.0\.1:8080:8080/.test(compose)],
  ['database must use a required environment password', /POSTGRES_PASSWORD:\s*\$\{POSTGRES_PASSWORD:\?set POSTGRES_PASSWORD\}/.test(compose)],
  ['application must depend on a healthy database', /depends_on:[\s\S]*?postgres:[\s\S]*?condition:\s*service_healthy/m.test(compose)],
  ['compose must not contain private Tor or wallet material', !/(tor\/keys|PRIVATE KEY|mnemonic|seed phrase)/i.test(compose)],
];

const failures = required.filter(([, ok]) => !ok).map(([name]) => name);

if (failures.length) {
  console.error('Compose security verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Compose security verification passed.');
