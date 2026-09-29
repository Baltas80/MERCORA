import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_TABS,
  CUSTODY_ASSETS,
  CUSTODY_LAYERS,
  publicAdminCapabilities,
  assertNoSecretFields
} from './admin-console-contract.js';

test('admin console exposes the eight required tabs', () => {
  assert.deepEqual(ADMIN_TABS.map((tab) => tab.id), [
    'dashboard', 'custody', 'catalog', 'orders', 'customers', 'store', 'infrastructure', 'settings'
  ]);
});

test('custody contract is limited to BTC/XMR and hot/cold/emergency layers', () => {
  assert.deepEqual(CUSTODY_ASSETS, ['BTC', 'XMR']);
  assert.deepEqual(CUSTODY_LAYERS, ['hot', 'cold', 'emergency']);
});

test('public capability contract contains no signing material', () => {
  const capabilities = publicAdminCapabilities();
  assert.doesNotThrow(() => assertNoSecretFields(capabilities));
  assert.equal(capabilities.secretPolicy.consoleAccess, false);
  assert.equal(capabilities.secretPolicy.signingBoundary, 'server/custody');
});

test('secret-field guard rejects accidental private-key fields', () => {
  assert.throws(() => assertNoSecretFields({ wallet: { privateKey: 'never-return-this' } }), /secret field exposed/);
  assert.throws(() => assertNoSecretFields({ custody: { mnemonic: 'never-return-this' } }), /secret field exposed/);
});
