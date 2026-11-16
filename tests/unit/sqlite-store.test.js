import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CondoOpsStore } from '../../src/store/sqlite-store.js';

describe('Condo Operations SQLite Store (node:sqlite)', () => {
  let store;

  beforeEach(() => {
    // In-memory sqlite for sub-millisecond targeted testing
    store = new CondoOpsStore(':memory:');
    store.initSchema();
  });

  it('should create and retrieve a reservation with default endorsement and turnover status', () => {
    const reservation = {
      refId: 'CND-1001',
      guestName: 'Maria Santos',
      guestEmail: 'maria@example.com',
      guestPhone: '+639170001111',
      checkIn: '2026-12-20',
      checkOut: '2026-12-22',
      guests: 4,
      channel: 'direct',
      coveredParking: true,
      plateNumber: 'NAA-1234',
      totalPrice: 6100
    };

    store.saveReservation(reservation);
    const fetched = store.getReservation('CND-1001');

    assert.ok(fetched);
    assert.equal(fetched.refId, 'CND-1001');
    assert.equal(fetched.guestName, 'Maria Santos');
    assert.equal(fetched.coveredParking, 1);
    assert.equal(fetched.endorsementStatus, 'PENDING');
    assert.equal(fetched.caretakerReady, 0);
  });

  it('should update endorsement status and plate number', () => {
    store.saveReservation({
      refId: 'CND-1002',
      guestName: 'Jose Rizal',
      checkIn: '2026-12-25',
      checkOut: '2026-12-27',
      guests: 2,
      channel: 'agoda'
    });

    store.updateEndorsement('CND-1002', {
      status: 'CLEARED',
      idVerified: true,
      guestList: 'Jose Rizal, Josephine Bracken',
      plateNumber: 'XYZ-789'
    });

    const updated = store.getReservation('CND-1002');
    assert.equal(updated.endorsementStatus, 'CLEARED');
    assert.equal(updated.plateNumber, 'XYZ-789');
  });

  it('should manage security deposits (collect, refund, deduct)', () => {
    store.recordDeposit({
      refId: 'CND-1003',
      channelPolicy: 'CASH_DEPOSIT_3000',
      amount: 3000,
      status: 'HELD',
      notes: 'Collected via GCash at check-in'
    });

    let dep = store.getDeposit('CND-1003');
    assert.equal(dep.status, 'HELD');
    assert.equal(dep.amount, 3000);

    store.updateDepositStatus('CND-1003', 'REFUNDED', 'Clean inspection after 12NN checkout');
    dep = store.getDeposit('CND-1003');
    assert.equal(dep.status, 'REFUNDED');
  });

  it('should log expenses and aggregate monthly reports', () => {
    store.addExpense({
      date: '2026-11-01',
      category: 'meralco',
      amount: 2450.50,
      notes: 'November electricity'
    });
    store.addExpense({
      date: '2026-11-05',
      category: 'laundry',
      amount: 600,
      notes: 'Bed linen & towels'
    });
    store.addExpense({
      date: '2026-10-15',
      category: 'water',
      amount: 450,
      notes: 'October water'
    });

    const reportNov = store.getMonthlyExpenseReport('2026-11');
    assert.equal(reportNov.totalAmount, 3050.50);
    assert.equal(reportNov.expenses.length, 2);
    assert.equal(reportNov.byCategory.meralco, 2450.50);
    assert.equal(reportNov.byCategory.laundry, 600);
  });
});
