import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.js';

const valid = {
    NODE_ENV: 'test',
    PUBLIC_ORIGIN: 'https://jobs.example.test',
    SESSION_SECRET: '0123456789abcdef0123456789abcdef',
    OWNER_EMAIL: 'owner@example.test',
    OWNER_PASSWORD: 'owner-correct-horse',
    WEBHOOK_SECRET: 'wh-secret',
};

test('loadConfig accepts a valid environment', () => {
    const config = loadConfig(valid);
    assert.equal(config.publicOrigin, 'https://jobs.example.test');
    assert.equal(config.ownerUsername, 'owner');
    assert.equal(config.sessionMaxAgeSeconds, 30 * 24 * 60 * 60);
    assert.equal(config.scrapeDailyLimit, 5);
    assert.equal(config.runExpiryMinutes, 30);
});

test('loadConfig rejects a short session secret', () => {
    assert.throws(() => loadConfig({ ...valid, SESSION_SECRET: 'too-short' }));
});

test('loadConfig rejects an owner password under 12 characters', () => {
    assert.throws(() => loadConfig({ ...valid, OWNER_PASSWORD: 'short' }));
});

test('loadConfig rejects a PUBLIC_ORIGIN carrying a path', () => {
    assert.throws(() => loadConfig({ ...valid, PUBLIC_ORIGIN: 'https://jobs.example.test/app' }));
});

test('loadConfig rejects a missing session secret', () => {
    const { SESSION_SECRET: _drop, ...withoutSecret } = valid;
    assert.throws(() => loadConfig(withoutSecret));
});
