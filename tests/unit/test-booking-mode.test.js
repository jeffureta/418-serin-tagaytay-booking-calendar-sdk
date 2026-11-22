import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CondoBookingClient } from '../../src/index.js';
import { CondoOpsStore } from '../../src/store/sqlite-store.js';

describe('Test Booking Mode & Pipeline Unit Tests', () => {
  it('should isolate test reservations with is_test = 1 and hide from default list', async () => {
    const store = new CondoOpsStore(':memory:');
    store.initSchema();

    // Normal booking
    store.saveReservation({
      refId: 'CND-8888',
      guestName: 'Real Guest',
      checkIn: '2026-12-01',
      checkOut: '2026-12-03',
      isTest: false
    });

    // Test booking
    store.saveReservation({
      refId: 'TEST-1234',
      guestName: 'Test Guest',
      checkIn: '2026-12-05',
      checkOut: '2026-12-07',
      isTest: true
    });

    // Default list should exclude test bookings
    const defaultList = store.listReservations();
    assert.equal(defaultList.length, 1);
    assert.equal(defaultList[0].refId, 'CND-8888');

    // List with includeTest: true should show both
    const allList = store.listReservations({ includeTest: true });
    assert.equal(allList.length, 2);
    const testRow = allList.find(r => r.refId === 'TEST-1234');
    assert.ok(testRow);
    assert.equal(testRow.isTest, true);

    // Purge test reservations
    store.purgeTestReservations();
    const afterPurge = store.listReservations({ includeTest: true });
    assert.equal(afterPurge.length, 1);
    assert.equal(afterPurge[0].refId, 'CND-8888');
    store.close();
  });

  it('should execute full 8-stage test booking pipeline successfully with auto-cleanup', async () => {
    const client = new CondoBookingClient({
      dbPath: ':memory:',
      skipGcal: true
    });

    const report = await client.runTestBookingPipeline({
      checkIn: '2027-01-10',
      checkOut: '2027-01-12',
      channel: 'direct',
      coveredParking: true
    });

    assert.equal(report.success, true);
    assert.equal(report.status, 'TEST_PIPELINE_PASSED');
    assert.ok(report.data.refId.startsWith('TEST-'));
    assert.equal(report.data.stages.length, 8);
    for (const stage of report.data.stages) {
      assert.equal(stage.passed, true, `Stage ${stage.name} failed: ${stage.details}`);
    }

    // Verify auto-cleanup: record should no longer exist in store
    const checkRes = await client.getReservation(report.data.refId);
    assert.equal(checkRes.success, false);
    assert.equal(checkRes.status, 'NOT_FOUND');
  });

  it('should preserve test booking record when keep: true is set', async () => {
    const client = new CondoBookingClient({
      dbPath: ':memory:',
      skipGcal: true
    });

    const report = await client.runTestBookingPipeline({
      checkIn: '2027-02-10',
      checkOut: '2027-02-12',
      channel: 'direct',
      keep: true
    });

    assert.equal(report.success, true);
    assert.equal(report.status, 'TEST_PIPELINE_PASSED');

    const checkRes = await client.getReservation(report.data.refId);
    assert.equal(checkRes.success, true);
    assert.equal(checkRes.data.isTest, true);

    // Explicit cleanup
    const cleanRes = await client.cleanupTestBookings(report.data.refId);
    assert.equal(cleanRes.success, true);

    const afterClean = await client.getReservation(report.data.refId);
    assert.equal(afterClean.success, false);
  });
});
