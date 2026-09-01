import { openDb, seedUsers, seedDemoJobs, migrateFromJson } from './server/db.js';
import { loadOrCreateSecret } from './server/auth.js';
import { getOwnerUser } from './server/repo.js';
import { createApp } from './server/app.js';
import { resolveRuntimePaths } from './server/runtime-paths.js';

const PORT = Number(process.env.PORT) || 3004;
const paths = resolveRuntimePaths({ dataDirEnv: process.env.DATA_DIR });

const db = openDb(paths.dbPath);
seedUsers(db);
seedDemoJobs(db, paths.samplePath);

const owner = getOwnerUser(db);
if (owner) migrateFromJson(db, owner.id, paths.legacyJsonDir);

const secret = loadOrCreateSecret(paths.dataDir);
const app = createApp(db, { secret, dataDir: paths.dataDir });

app.listen(PORT, () => {
    console.log(`Job Viewer running on port ${PORT}`);
    console.log(`Access at: http://localhost:${PORT}/job-viewer`);
});
