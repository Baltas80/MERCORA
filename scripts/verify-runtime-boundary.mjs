#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';

const composePath = process.argv[2] ?? 'docker-compose.yml';
const text = fs.readFileSync(composePath, 'utf8');
const failures = [];
const mustMatch = (re, message) => { if (!re.test(text)) failures.push(message); };
const mustNotMatch = (re, message) => { if (re.test(text)) failures.push(message); };

mustMatch(/postgres:\s*[\s\S]*?networks:\s*\[backend\]/, 'postgres must be attached to backend network');
mustNotMatch(/postgres:[\s\S]*?ports:/, 'postgres must not publish ports');
mustMatch(/networks:\s*[\s\S]*?backend:\s*\n\s*internal:\s*true/, 'backend network must be internal');
mustMatch(/127\.0\.0\.1:8080:8080/, 'development app listener must be loopback-only');
mustMatch(/POSTGRES_PASSWORD:\s*\$\{POSTGRES_PASSWORD:\?set POSTGRES_PASSWORD\}/, 'database password must be required from runtime environment');
mustNotMatch(/(tor\/keys|\.onion|PRIVATE KEY|mnemonic|seed phrase)/i, 'compose file must not contain Tor private material or wallet secrets');

if (failures.length) {
  console.error('Runtime boundary verification FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Runtime boundary verification PASSED');
console.log('Verified: database is not published, backend network is internal, app bind is loopback-only, runtime DB secret is required, and compose contains no obvious private material.');
