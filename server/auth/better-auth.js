import { mkdirSync, chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { hash, verify } from '@node-rs/argon2';
import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins';
import { username } from 'better-auth/plugins';

const DEFAULT_STATE_DIR = process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'MERCORA', 'Admin')
  : path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), '.local', 'state'), 'mercora', 'admin');

const databasePath = path.resolve(
  process.env.MERCORA_ADMIN_AUTH_DB ?? path.join(DEFAULT_STATE_DIR, 'admin-auth.db')
);
const secret = process.env.BETTER_AUTH_SECRET;

if (!secret || secret.length < 32) {
  throw new Error('BETTER_AUTH_SECRET must be configured with at least 32 characters.');
}

mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
const database = new Database(databasePath);
database.pragma('journal_mode = WAL');
database.pragma('foreign_keys = ON');
try { chmodSync(databasePath, 0o600); } catch {}

const argon2Options = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  outputLen: 32,
  algorithm: 2,
};

export const auth = betterAuth({
  database,
  secret,
  baseURL: process.env.BETTER_AUTH_URL ?? `http://127.0.0.1:${process.env.MERCORA_ADMIN_PORT ?? '8787'}`,
  basePath: '/api/auth',
  trustedOrigins: ['tauri://localhost', 'http://127.0.0.1', 'http://localhost'],
  telemetry: { enabled: false },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 256,
    password: {
      hash: (password) => hash(password, argon2Options),
      verify: ({ password, hash: storedHash }) => verify(storedHash, password),
    },
  },
  session: {
    expiresIn: 30 * 60,
    updateAge: 5 * 60,
    freshAge: 5 * 60,
    disableCookieCache: true,
  },
  rateLimit: {
    enabled: true,
    storage: 'database',
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/username': { window: 60, max: 5 },
    },
  },
  advanced: {
    useSecureCookies: false,
    cookiePrefix: 'mercora_admin',
    ipAddress: {
      ipAddressHeaders: ['x-forwarded-for'],
      trustedProxies: ['127.0.0.1', '::1'],
    },
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
    },
  },
  plugins: [
    username({
      minUsernameLength: 3,
      maxUsernameLength: 64,
      immutableUsername: true,
      displayUsername: false,
    }),
    admin({
      defaultRole: 'user',
      adminRoles: ['admin'],
    }),
  ],
});

export { database, databasePath };
