import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.MOCK_SQL = '1';
process.env.MOCK_CRYPTO = '1';
process.env.MOCK_ETHERS = '1';

const {
  initSchemaIfNeeded,
  setSqlClient,
  __resetSqlClientForTesting,
  __resetInitForTesting,
} = await import('../db.js');

let calls;

beforeEach(() => {
  calls = [];
  __resetInitForTesting();
  setSqlClient(async (strings) => {
    calls.push(strings.join(' '));
    return { rowCount: 0, rows: [] };
  });
});

afterEach(() => {
  __resetSqlClientForTesting();
});

test('initSchemaIfNeeded creates all tables exactly once', async () => {
  await initSchemaIfNeeded();
  assert.equal(calls.length, 4);
  await initSchemaIfNeeded();
  assert.equal(calls.length, 4);
});
