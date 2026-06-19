import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.js';

test('openDb creates the expected tables', () => {
    const db = openDb(':memory:');
    const names = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
        .all()
        .map((r: any) => r.name);
    assert.ok(names.includes('users'));
    assert.ok(names.includes('jobs'));
    assert.ok(names.includes('history'));
    assert.ok(names.includes('scrape_info'));
    db.close();
});
