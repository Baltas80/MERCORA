import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const composePath = path.resolve(process.cwd(), 'docker-compose.onion.yml');
const compose = fs.readFileSync(composePath, 'utf8');

test('Tor Onion Service disables public relay and directory listeners', () => {
  assert.match(compose, /ORPORT:\s*"0"/);
  assert.match(compose, /DIRPORT:\s*"0"/);
  assert.match(compose, /EXITPOLICY:\s*"reject \*:\*"/);
});

test('Tor Onion Service keeps the torrc configuration read-only', () => {
  assert.match(compose, /\.\/tor\/torrc\.onion:\/data\/torrc:ro/);
});
