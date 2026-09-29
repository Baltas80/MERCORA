import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const script = fs.readFileSync(path.join(process.cwd(), 'scripts', 'windows', 'mercora-service-manager.ps1'), 'utf8');

test('Windows service manager exposes only the fixed MERCORA action set', () => {
  for (const action of ['START', 'STOP', 'RESTART', 'STATUS', 'HEALTH_CHECK', 'RECOVER']) {
    assert.match(script, new RegExp(`'${action}'`));
  }
  for (const service of ['backend', 'postgres', 'tor']) {
    assert.match(script, new RegExp(`\\b${service}\\b`));
  }
});

test('Windows service manager contains no arbitrary command execution boundary', () => {
  assert.doesNotMatch(script, /Invoke-Expression|Invoke-Command|Start-Process|cmd\.exe|powershell\.exe|pwsh\.exe/i);
  assert.match(script, /Get-Service -Name \$ServiceMap\[\$Key\]/);
});

test('Windows recovery is targeted and blocks backend recovery on unhealthy PostgreSQL', () => {
  assert.match(script, /foreach \(\$candidate in @\('postgres', 'backend', 'tor'\)\)/);
  assert.match(script, /backend recovery blocked because PostgreSQL is not healthy/);
  assert.match(script, /Never restart healthy services/);
});

test('Windows manager probes backend only through the fixed loopback health endpoint', () => {
  assert.match(script, /http:\/\/127\.0\.0\.1:8080\/api\/healthz/);
  assert.doesNotMatch(script, /https?:\/\/[^'\"]+/i);
});
