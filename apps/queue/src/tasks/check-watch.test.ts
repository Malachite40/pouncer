import test from 'node:test';
import assert from 'node:assert/strict';

import { __testables } from './check-watch';

test('jittered overload backoff stays above base delay', () => {
    const originalRandom = Math.random;
    Math.random = () => 0;

    try {
        assert.equal(__testables.getJitteredBackoffMs(300_000), 300_000);
    } finally {
        Math.random = originalRandom;
    }
});

test('jittered overload backoff adds up to ten percent jitter', () => {
    const originalRandom = Math.random;
    Math.random = () => 0.9999;

    try {
        const backoffMs = __testables.getJitteredBackoffMs(300_000);
        assert.equal(backoffMs, 329_997);
    } finally {
        Math.random = originalRandom;
    }
});
