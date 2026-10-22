// Delete the job databases (live and dry-run) so every job is processed again.
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const which = process.argv.includes('--dry-only') ? ['jobs.dry.db'] : ['jobs.db', 'jobs.dry.db'];
for (const base of which) {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = path.join(process.cwd(), base + suffix);
    if (existsSync(f)) {
      rmSync(f);
      console.log('deleted', path.basename(f));
    }
  }
}
console.log('Database reset done.');
