import '../src/server/quietSqliteWarning';
import readline from 'node:readline';
import dotenv from 'dotenv';
import { SqliteRepo } from '../src/server/db';
import { firestoreFromEnv } from '../src/server/firestoreRepo';
import { DB_FILE } from '../src/server/paths';
import { sqliteAsRepo, type Repo } from '../src/server/repo';
export { DB_FILE };

dotenv.config({ path: ['.env.local', '.env'], quiet: true });

// The same store the server uses: Firestore when FIREBASE_SERVICE_ACCOUNT is
// set (in .env.local or the shell), otherwise the local SQLite file.
export async function openRepo(): Promise<Repo> {
  const fsRepo = await firestoreFromEnv(m => console.log(m.replace(/^\[FinAI\] /, '')));
  if (fsRepo) return fsRepo;
  console.log(`Storage: local SQLite file ${DB_FILE}`);
  return sqliteAsRepo(new SqliteRepo(DB_FILE));
}


// Read a line from the terminal without echoing it.
export function promptHidden(question: string): Promise<string> {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let asked = false;
    out._writeToOutput = (s: string) => {
      if (!asked) {
        out.output.write(s);
        asked = true;
      }
    };
    rl.question(question, answer => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}
