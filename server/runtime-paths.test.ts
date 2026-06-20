import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRuntimePaths } from './runtime-paths.js';

test('runtime paths use DATA_DIR for db and legacy json import', () => {
    const paths = resolveRuntimePaths({
        cwd: '/app',
        dataDirEnv: '/app/data',
    });

    assert.equal(paths.dataDir, '/app/data');
    assert.equal(paths.dbPath, '/app/data/jobviewer.db');
    assert.equal(paths.legacyJsonDir, '/app/data');
    assert.equal(paths.samplePath, '/app/public-sample.json');
});
