// Puts the demo data into a freshly created dev panel (8 servers, a day of history, news, the administrator).
// Runs inside the backend container: node /app/tools/dev/seed.mjs
import { ADMIN, seed } from '../shots/seed.mjs';

const base = process.env.COREGSM_BASE ?? 'http://127.0.0.1:3000';
const dbPath = process.env.DB_PATH ?? '/data/coregsm.db';

const status = await (await fetch(`${base}/api/setup/status`)).json();
if (!status.needed) {
  console.log('The panel is already set up, nothing to seed. To start from scratch: node tools/dev/dev.mjs reset');
  process.exit(0);
}
await seed({ base, dbPath });
console.log(`Demo data is in. Sign in: ${ADMIN.username} / ${ADMIN.password}`);
