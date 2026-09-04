import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveRuntimePaths } from './runtime-paths.js';

test('runtime paths use DATA_DIR for the database', () => {
    const paths = resolveRuntimePaths({
        cwd: '/app',
        dataDirEnv: '/app/data',
    });

    assert.equal(paths.dataDir, '/app/data');
    assert.equal(paths.dbPath, path.join('/app/data', 'jobviewer.db'));
    assert.equal(paths.samplePath, path.join('/app', 'public-sample.json'));
});
