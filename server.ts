import path from 'path';
import { openDb, seedUsers, seedDemoJobs, migrateFromJson } from './server/db.js';
import { loadOrCreateSecret } from './server/auth.js';
import { getOwnerUser } from './server/repo.js';
import { createApp } from './server/app.js';

const PORT = Number(process.env.PORT) || 3004;
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'jobviewer.db');
const SAMPLE_PATH = path.join(process.cwd(), 'public-sample.json');

const db = openDb(DB_PATH);
seedUsers(db);
seedDemoJobs(db, SAMPLE_PATH);

const owner = getOwnerUser(db);
if (owner) migrateFromJson(db, owner.id, process.cwd());

const secret = loadOrCreateSecret(DATA_DIR);
const app = createApp(db, { secret, dataDir: DATA_DIR });

app.listen(PORT, () => {
    console.log(`Job Viewer running on port ${PORT}`);
    console.log(`Access at: http://localhost:${PORT}/job-viewer`);
});
