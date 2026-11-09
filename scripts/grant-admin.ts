// Give an existing account the admin role (or take it away with --revoke).
// The admin view only opens for accounts the server reports as admins; there
// is no admin password anywhere in the frontend. Safe to run while the server
// is up.
//
//   npm run admin:grant -- <username>
//   npm run admin:grant -- <username> --revoke

import { openRepo } from './cli-common';
import type { Repo } from '../src/server/repo';

const username = process.argv[2];
const revoke = process.argv.includes('--revoke');
let repo: Repo | null = null;
try {
  if (!username || username.startsWith('--')) throw new Error('Usage: npm run admin:grant -- <username> [--revoke]');
  repo = await openRepo();
  const user = await repo.findUserByUsername(username);
  if (!user) throw new Error(`No account named ${username}. Register it in the app first.`);
  await repo.setRole(user.id, revoke ? null : 'admin');
  console.log(revoke ? `${user.username} is no longer an admin.` : `${user.username} is now an admin.`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await repo?.close();
}
