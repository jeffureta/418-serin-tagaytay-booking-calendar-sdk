import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CLI_PATH = './bin/condo-book.js';

describe('condo-book CLI Subprocess Verification', () => {
  it('should display help when run with --help', async () => {
    const { stdout } = await execFileAsync('node', [CLI_PATH, '--help']);
    assert.ok(stdout.includes('condo-book'));
    assert.ok(stdout.includes('availability'));
    assert.ok(stdout.includes('quote'));
    assert.ok(stdout.includes('reserve'));
  });

  it('should output quote calculation in JSON envelope with --json', async () => {
    const { stdout } = await execFileAsync('node', [
      CLI_PATH,
      'quote',
      '--checkin', '2026-12-20',
      '--checkout', '2026-12-22',
      '--guests', '4',
      '--parking',
      '--json'
    ]);

    const res = JSON.parse(stdout);
    assert.equal(res.success, true);
    assert.equal(res.status, 'OK');
    assert.equal(res.data.parkingNights, 2);
    assert.equal(res.data.parkingTotal, 700);
    assert.equal(res.data.securityDeposit, 3000);
  });

  it('should support expense add and report in JSON format', async () => {
    const { stdout: addOut } = await execFileAsync('node', [
      CLI_PATH,
      'expense',
      'add',
      '--category', 'meralco',
      '--amount', '2150.75',
      '--date', '2026-11-14',
      '--notes', 'Test electricity bill',
      '--json'
    ]);

    const addRes = JSON.parse(addOut);
    assert.equal(addRes.success, true);
    assert.equal(addRes.status, 'EXPENSE_ADDED');

    const { stdout: repOut } = await execFileAsync('node', [
      CLI_PATH,
      'expense',
      'report',
      '--month', '2026-11',
      '--json'
    ]);

    const repRes = JSON.parse(repOut);
    assert.equal(repRes.success, true);
    assert.ok(repRes.data.totalAmount >= 2150.75);
  });
});
