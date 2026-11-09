// Set or reset an account's password: the legitimate way back in when a
// password is lost. Needs shell access to the machine holding the database,
// the same trust level as opening the database directly.
//
//   npm run user:set-password -- <username>
//
// The password is typed at a hidden prompt (or piped on stdin), hashed with
// scrypt, and never printed or logged. Safe to run while the server is up.

import { openRepo, promptHidden } from './cli-common';
import { hashPassword } from '../src/server/auth';

async function readPassword(): Promise<string> {
  if (process.stdin.isTTY) {
    const a = await promptHidden('New password: ');
    const b = await promptHidden('Repeat it: ');
    if (a !== b) throw new Error('The two passwords do not match.');
    return a;
  }
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf-8').replace(/\r?\n$/, '');
}

async function main() {
  const username = process.argv[2];
  if (!username) throw new Error('Usage: npm run user:set-password -- <username>');
  const repo = await openRepo();
  try {
    const user = await repo.findUserByUsername(username);
    if (!user) throw new Error(`No account named ${username}.`);
    const password = await readPassword();
    if (password.length < 8 || password.length > 128) throw new Error('Password must be 8–128 characters.');
    await repo.setPasswordHash(user.id, await hashPassword(password));
    console.log(`Password updated for ${user.username}.`);
  } finally {
    await repo.close();
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
