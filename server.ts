import path from 'path';
import { openDb } from './server/db.js';
import { loadConfig } from './server/config.js';
import { buildAuth } from './server/auth.js';
import { ensureOwner } from './server/owner.js';
import { createApp } from './server/app.js';

const config = loadConfig(process.env);
const db = openDb(path.join(config.dataDir, 'jobviewer.db'));
const auth = buildAuth({ db, config });
const ownerId = await ensureOwner({ auth, db, config, log: (m) => console.log(m) });
console.log(`owner id: ${ownerId}`);

const app = createApp(db, { auth, config });
app.listen(config.port, () => {
    console.log(`Job Viewer running on port ${config.port}`);
    console.log(`Access at: ${config.publicOrigin}`);
});
