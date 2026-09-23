import crypto from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const TOKEN_BYTES = 32;
const CREDENTIAL_VERSION = 1;

function defaultTokenFile() {
  if (process.env.MERCORA_ADMIN_TOKEN_FILE) return path.resolve(process.env.MERCORA_ADMIN_TOKEN_FILE);
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'MERCORA', 'Admin', 'admin-token.json');
  }
  const base = process.env.XDG_STATE_HOME ?? path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'mercora', 'admin-token.json');
}

export function isValidAdminToken(token) {
  return typeof token === 'string' && token.length >= 32 && token.length <= 512 && !/[\r\n]/.test(token);
}

export function hashAdminToken(token) {
  if (!isValidAdminToken(token)) throw new Error('Invalid admin token.');
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function isValidTokenHash(tokenHash) {
  return typeof tokenHash === 'string' && /^[0-9a-f]{64}$/i.test(tokenHash);
}

function generateAdminToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

async function readCredential(tokenFile) {
  const raw = await readFile(tokenFile, 'utf8');
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error('MERCORA admin credential file is invalid JSON.'); }
  if (value?.version !== CREDENTIAL_VERSION || typeof value.bootstrapPending !== 'boolean') {
    throw new Error('MERCORA admin credential file is invalid.');
  }
  if (value.bootstrapPending) return { token: null, tokenHash: null, bootstrapPending: true };
  if (!isValidTokenHash(value.tokenHash)) throw new Error('MERCORA admin credential file is invalid.');
  return { token: null, tokenHash: value.tokenHash.toLowerCase(), bootstrapPending: false };
}

async function writeCredential(tokenFile, credential) {
  const directory = path.dirname(tokenFile);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temp = path.join(directory, `.admin-token-${process.pid}-${crypto.randomBytes(8).toString('hex')}.tmp`);
  await writeFile(temp, JSON.stringify({ version: CREDENTIAL_VERSION, ...credential }) + '\n', {
    encoding: 'utf8', mode: 0o600, flag: 'wx'
  });
  try {
    await chmod(temp, 0o600).catch(() => {});
    await rename(temp, tokenFile);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

export async function loadOrCreateAdminCredential({ token = process.env.MERCORA_ADMIN_TOKEN, tokenFile = defaultTokenFile() } = {}) {
  if (token !== undefined && token !== null && token !== '') {
    if (!isValidAdminToken(token)) throw new Error('MERCORA_ADMIN_TOKEN must be 32-512 characters.');
    return { token, tokenHash: hashAdminToken(token), tokenFile: null, bootstrapPending: false, source: 'environment' };
  }
  const resolved = path.resolve(tokenFile);
  try {
    const credential = await readCredential(resolved);
    if (credential.bootstrapPending) {
      return { ...credential, token: generateAdminToken(), tokenFile: resolved, source: 'pending' };
    }
    return { ...credential, tokenFile: resolved, source: 'file' };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await writeCredential(resolved, { bootstrapPending: true });
    return { token: generateAdminToken(), tokenHash: null, tokenFile: resolved, bootstrapPending: true, source: 'generated' };
  }
}

export async function claimBootstrapToken(tokenFile, token) {
  if (!tokenFile) throw new Error('Bootstrap is disabled when an explicit environment token is configured.');
  if (!isValidAdminToken(token)) throw new Error('Invalid bootstrap credential.');
  const resolved = path.resolve(tokenFile);
  const lockFile = `${resolved}.bootstrap.lock`;
  let lockHandle;
  try {
    lockHandle = await open(lockFile, 'wx', 0o600);
    const credential = await readCredential(resolved);
    if (!credential.bootstrapPending) throw new Error('Admin bootstrap has already been completed.');
    await writeCredential(resolved, { bootstrapPending: false, tokenHash: hashAdminToken(token) });
    return token;
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('Admin bootstrap is already being completed.');
    throw error;
  } finally {
    await lockHandle?.close().catch(() => {});
    await unlink(lockFile).catch(() => {});
  }
}

export { defaultTokenFile };
