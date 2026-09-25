import { readFile } from 'node:fs/promises';

const compose = await readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8');
const onion = await readFile(new URL('../docker-compose.onion.yml', import.meta.url), 'utf8');
const torrc = await readFile(new URL('../tor/torrc.onion', import.meta.url), 'utf8');
const postgres = compose.match(/^  postgres:\n([\s\S]*?)(?=^  app:\n|^networks:\n|^volumes:\n)/m)?.[1] ?? '';

const required = [
  ['PostgreSQL service must exist', postgres.length > 0],
  ['PostgreSQL must not publish host ports', !/^\s+ports:/m.test(postgres)],
  ['backend network must be internal', /networks:\s*\n\s*backend:\s*\n\s*internal:\s*true/m.test(compose)],
  ['application must bind only to loopback during development', /127\.0\.0\.1:8080:8080/.test(compose)],
  ['database must use a required environment password', /POSTGRES_PASSWORD:\s*\$\{POSTGRES_PASSWORD:\?set POSTGRES_PASSWORD\}/.test(compose)],
  ['application must depend on a healthy database', /depends_on:[\s\S]*?postgres:[\s\S]*?condition:\s*service_healthy/m.test(compose)],
  ['compose must not contain private Tor or wallet material', !/(tor\/keys|PRIVATE KEY|mnemonic|seed phrase)/i.test(`${compose}\n${onion}`)],
  ['Tor staging image must use an explicit release tag', /svengo\/tor:0\.4\.9\.\d+(?:-\d+)?/.test(onion)],
  ['Tor staging must disable relay and directory listeners', /ORPORT:\s*"0"/.test(onion) && /DIRPORT:\s*"0"/.test(onion)],
  ['Tor staging must publish no host ports', !/^\s+ports:/m.test(onion)],
  ['Tor service must use a private internal edge network', /onion_edge:\s*\n\s*internal:\s*true/m.test(onion)],
  ['Tor must have a separate network for Tor egress', /tor_egress:\s*\n\s*driver:\s*bridge/m.test(onion)],
  ['Tor SOCKS and control ports must be disabled', /SocksPort\s+0/.test(torrc) && /ControlPort\s+0/.test(torrc)],
  ['Tor staging must use Onion Service v3', /HiddenServiceVersion\s+3/.test(torrc)],
  ['Tor must route only to the application service', /HiddenServicePort\s+80\s+app:8080/.test(torrc)],
];

const failures = required.filter(([, ok]) => !ok).map(([name]) => name);

if (failures.length) {
  console.error('Compose security verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Compose security verification passed.');
