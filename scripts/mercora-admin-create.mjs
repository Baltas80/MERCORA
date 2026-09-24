import { createHash, timingSafeEqual } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 256;
const LOCK_STALE_MS = 10 * 60 * 1000;

export function hashOwnerBootstrapToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function verifyOwnerBootstrapToken(token, expectedHash) {
  if (typeof token !== 'string' || token.length < 32) return false;
  if (!/^[a-f0-9]{64}$/i.test(expectedHash ?? '')) return false;
  const actual = Buffer.from(hashOwnerBootstrapToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return timingSafeEqual(actual, expected);
}

export function normalizeUsername(username) {
  const value = String(username ?? '').trim();
  if (!/^[A-Za-z0-9_.]{3,64}$/.test(value)) {
    throw new Error('Username must contain only letters, numbers, underscores or dots and be 3-64 characters long.');
  }
  return value.toLowerCase();
}

export function databaseStateDir(databasePath) {
  return path.dirname(path.resolve(databasePath));
}

export function bootstrapMarkerPath(databasePath) {
  return path.join(databaseStateDir(databasePath), 'owner-bootstrap-used');
}

export async function acquireBootstrapLock(databasePath) {
  const stateDir = databaseStateDir(databasePath);
  await mkdir(stateDir, { recursive: true });
  const lockPath = path.join(stateDir, 'owner-bootstrap.lock');

  try {
    const info = await stat(lockPath);
    if (Date.now() - info.mtimeMs < LOCK_STALE_MS) {
      throw new Error('Another administrator bootstrap operation is already running.');
    }
    await rm(lockPath, { force: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  try {
    const handle = await open(lockPath, 'wx');
    await handle.writeFile(`${process.pid}\n`);
    await handle.close();
    return async () => rm(lockPath, { force: true });
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('Another administrator bootstrap operation is already running.');
    throw error;
  }
}

async function prompt(question, { secret = false } = {}) {
  if (!secret) {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      return (await rl.question(question)).trim();
    } finally {
      rl.close();
    }
  }

  if (!stdin.isTTY) throw new Error('Secret input requires an interactive terminal.');
  const rl = createInterface({ input: stdin, output: null, terminal: true });
  stdout.write(question);
  try {
    return await rl.question('');
  } finally {
    rl.close();
    stdout.write('\n');
  }
}

async function collectCredentials() {
  if (process.argv.includes('--non-interactive')) {
    const ownerToken = process.env.MERCORA_OWNER_BOOTSTRAP_TOKEN ?? '';
    const username = normalizeUsername(process.env.MERCORA_BOOTSTRAP_USERNAME ?? '');
    const password = process.env.MERCORA_BOOTSTRAP_PASSWORD ?? '';
    const confirmation = process.env.MERCORA_BOOTSTRAP_PASSWORD_CONFIRM ?? password;
    return { ownerToken, username, password, confirmation };
  }

  return {
    ownerToken: await prompt('Owner bootstrap token: ', { secret: true }),
    username: normalizeUsername(await prompt('Username: ')),
    password: await prompt('Password: ', { secret: true }),
    confirmation: await prompt('Confirm password: ', { secret: true }),
  };
}

async function main() {
  if (process.argv.includes('--hash-token')) {
    const token = await prompt('Owner bootstrap token: ', { secret: true });
    if (token.length < 32) throw new Error('Owner bootstrap token must be at least 32 characters.');
    stdout.write(`${hashOwnerBootstrapToken(token)}\n`);
    return;
  }

  const expectedHash = process.env.MERCORA_OWNER_BOOTSTRAP_TOKEN_HASH;
  if (!/^[a-f0-9]{64}$/i.test(expectedHash ?? '')) {
    throw new Error('Owner bootstrap is disabled. Configure MERCORA_OWNER_BOOTSTRAP_TOKEN_HASH on the MERCORA server.');
  }

  const { database, databasePath, auth } = await import('../server/auth/better-auth.js');
  const releaseLock = await acquireBootstrapLock(databasePath);

  try {
    const adminCount = database.prepare('SELECT COUNT(*) AS count FROM "user" WHERE role = ?').get('admin')?.count ?? 0;
    if (Number(adminCount) > 0) throw new Error('An administrator already exists. Owner bootstrap is one-time and permanently disabled.');

    const marker = bootstrapMarkerPath(databasePath);
    try {
      const markerContent = JSON.parse(await readFile(marker, 'utf8'));
      if (markerContent?.state === 'consumed') {
        throw new Error('Owner bootstrap has already been consumed.');
      }
      if (markerContent?.state !== 'pending') {
        throw new Error('Owner bootstrap state is invalid; refusing to continue.');
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    const { ownerToken, username, password, confirmation } = await collectCredentials();
    if (!verifyOwnerBootstrapToken(ownerToken, expectedHash)) throw new Error('Owner authorization failed.');

    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      throw new Error(`Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters long.`);
    }
    if (password !== confirmation) throw new Error('Passwords do not match.');

    const existingUsername = database.prepare('SELECT id FROM "user" WHERE username = ? LIMIT 1').get(username);
    if (existingUsername) throw new Error('Username is already in use.');

    const pendingMarker = JSON.stringify({ state: 'pending', username, startedAt: new Date().toISOString() });
    await writeFile(marker, pendingMarker, { encoding: 'utf8', mode: 0o600 });

    const email = `${username}@admin.mercora.invalid`;
    const result = await auth.api.createUser({
      body: {
        email,
        name: username,
        password,
        role: 'admin',
        data: { username, displayUsername: username },
      },
    });

    const user = result?.user ?? result?.data ?? result;
    if (!user?.id) throw new Error('Authentication provider did not return a created user.');

    const storedUsername = database.prepare('SELECT username FROM "user" WHERE id = ?').get(user.id)?.username;
    if (storedUsername !== username) {
      database.prepare('UPDATE "user" SET username = ?, displayUsername = ? WHERE id = ?')
        .run(username, username, user.id);
    }

    await writeFile(marker, JSON.stringify({ state: 'consumed', userId: user.id, consumedAt: new Date().toISOString() }), {
      encoding: 'utf8',
      mode: 0o600,
    });
    stdout.write('MERCORA owner administrator created successfully.\n');
    stdout.write('Owner bootstrap is now permanently disabled for this installation.\n');
  } finally {
    database.close();
    await releaseLock();
  }
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) {
  main().catch((error) => {
    console.error(`MERCORA admin bootstrap failed: ${error.message}`);
    process.exitCode = 1;
  });
}
