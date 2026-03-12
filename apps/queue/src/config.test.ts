import assert from 'node:assert/strict';
import test from 'node:test';

import { __testables } from './config';

test('defaults scraper request timeout to 60000ms', () => {
    assert.equal(__testables.parseScraperRequestTimeoutMs(undefined), 60_000);
});

test('parses scraper request timeout override when valid', () => {
    assert.equal(__testables.parseScraperRequestTimeoutMs('65000'), 65_000);
});

test('falls back when scraper request timeout override is invalid', () => {
    assert.equal(__testables.parseScraperRequestTimeoutMs('invalid'), 60_000);
    assert.equal(__testables.parseScraperRequestTimeoutMs('0'), 60_000);
});
