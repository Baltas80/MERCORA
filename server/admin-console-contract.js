export const ADMIN_TABS = Object.freeze([
  Object.freeze({ id: 'dashboard', title: 'Dashboard', access: 'read' }),
  Object.freeze({ id: 'custody', title: 'Custody & Funds', access: 'read' }),
  Object.freeze({ id: 'catalog', title: 'Product Catalog', access: 'read-write' }),
  Object.freeze({ id: 'orders', title: 'Orders', access: 'read-write' }),
  Object.freeze({ id: 'customers', title: 'Customers & CRM', access: 'read-write' }),
  Object.freeze({ id: 'store', title: 'Store Builder', access: 'read-write' }),
  Object.freeze({ id: 'infrastructure', title: 'Infrastructure & Tor', access: 'read-write' }),
  Object.freeze({ id: 'settings', title: 'Settings & Emergency', access: 'critical' })
]);

export const SECRET_FIELDS = Object.freeze([
  'privateKey', 'private_key', 'seed', 'mnemonic', 'walletCredential',
  'wallet_credentials', 'hsmMaterial', 'hsm_material', 'signingKey', 'signing_key'
]);

export const CUSTODY_LAYERS = Object.freeze(['hot', 'cold', 'emergency']);
export const CUSTODY_ASSETS = Object.freeze(['BTC', 'XMR']);

export const ADMIN_CAPABILITIES = Object.freeze({
  dashboard: Object.freeze(['status', 'health']),
  custody: Object.freeze(['balances', 'wallet-health', 'pending-transactions']),
  catalog: Object.freeze(['list', 'create', 'update', 'stock']),
  orders: Object.freeze(['list', 'update-status', 'refund-request']),
  customers: Object.freeze(['list', 'account', 'membership', 'support']),
  store: Object.freeze(['content', 'menus', 'banners', 'visual-settings']),
  infrastructure: Object.freeze(['status', 'health-check', 'recover']),
  settings: Object.freeze(['rbac', 'audit', 'panic-freeze', 'panic-sweep'])
});

export function publicAdminCapabilities() {
  return {
    tabs: ADMIN_TABS,
    custody: { assets: CUSTODY_ASSETS, layers: CUSTODY_LAYERS },
    capabilities: ADMIN_CAPABILITIES,
    secretPolicy: {
      consoleAccess: false,
      secretFields: SECRET_FIELDS,
      signingBoundary: 'server/custody',
      disclosure: 'never'
    },
    availability: {
      custody: 'pending-isolated-custody-service',
      commerce: 'pending-domain-backends',
      panic: 'fail-closed-until-custody-boundary-is-connected'
    }
  };
}

export function assertNoSecretFields(value) {
  const text = JSON.stringify(value ?? null).toLowerCase();
  for (const field of SECRET_FIELDS) {
    if (text.includes(`"${field.toLowerCase()}"`)) {
      throw new Error(`secret field exposed: ${field}`);
    }
  }
  return value;
}
