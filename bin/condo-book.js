#!/usr/bin/env node

/**
 * condo-book CLI Binary
 * Command-line interface for Unit 418 Serin East Tagaytay Booking & Calendar Operations.
 * Full CRUD on Google Calendar & SQLite Operations Ledger.
 */

import { Command } from 'commander';
import { CondoBookingClient } from '../src/index.js';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const program = new Command();
const client = new CondoBookingClient();

function handleOutput(result, isJson = false) {
  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
    if (!result.success) process.exit(1);
    return;
  }

  if (!result.success) {
    console.error(`\x1b[31m[ERROR ${result.status}]\x1b[0m ${result.error?.message || JSON.stringify(result.error)}`);
    process.exit(1);
  }

  console.log(`\x1b[32m[SUCCESS ${result.status}]\x1b[0m`);
  console.dir(result.data, { depth: null, colors: true });
}

program
  .name('condo-book')
  .description('Cost-free Booking Calendar CLI for Unit 418 Serin East Tagaytay')
  .version('1.0.0');

// 1. Availability
program
  .command('availability')
  .description('Query live Google Calendar busy intervals')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option('--json', 'Output raw JSON envelope')
  .action(async (opts) => {
    const res = await client.getAvailability({ from: opts.from, to: opts.to });
    handleOutput(res, opts.json);
  });

// 2. Quote
program
  .command('quote')
  .description('Calculate stay quote with dynamic undercut pricing and covered parking')
  .requiredOption('--checkin <date>', 'Check-in date (YYYY-MM-DD)')
  .requiredOption('--checkout <date>', 'Check-out date (YYYY-MM-DD)')
  .option('--guests <number>', 'Number of guests', '2')
  .option('--parking', 'Include ₱350/night covered parking slot')
  .option('--channel <channel>', 'Booking channel (direct, airbnb, agoda, booking_com)', 'direct')
  .option('--json', 'Output raw JSON envelope')
  .action(async (opts) => {
    const res = await client.calculateQuote({
      checkIn: opts.checkin,
      checkOut: opts.checkout,
      guests: parseInt(opts.guests, 10),
      coveredParking: !!opts.parking,
      channel: opts.channel
    });
    handleOutput(res, opts.json);
  });

// 3. Reserve (CRUD - Create)
program
  .command('reserve')
  .description('Create a new reservation on Google Calendar & operations ledger')
  .requiredOption('--name <guestName>', 'Primary guest name')
  .requiredOption('--checkin <date>', 'Check-in date (YYYY-MM-DD)')
  .requiredOption('--checkout <date>', 'Check-out date (YYYY-MM-DD)')
  .option('--ref <refId>', 'Explicit reference ID (e.g. CND-4821)')
  .option('--email <email>', 'Primary guest email')
  .option('--phone <phone>', 'Primary guest mobile number')
  .option('--guests <number>', 'Number of guests', '2')
  .option('--channel <channel>', 'Channel (direct, airbnb, agoda)', 'direct')
  .option('--parking', 'Include covered parking slot')
  .option('--plate <plate>', 'Vehicle plate number for covered parking')
  .option('--test-mode', 'Execute in isolated test mode (auto-prefixed TEST-XXXX, is_test=1)')
  .option('--live-gcal', 'When in test-mode, also create [TEST] event on live Google Calendar')
  .option('--json', 'Output raw JSON envelope')
  .action(async (opts) => {
    const res = await client.createReservation({
      refId: opts.ref,
      guestName: opts.name,
      guestEmail: opts.email,
      guestPhone: opts.phone,
      checkIn: opts.checkin,
      checkOut: opts.checkout,
      guests: parseInt(opts.guests, 10),
      channel: opts.channel,
      coveredParking: !!opts.parking,
      plateNumber: opts.plate,
      testMode: !!opts.testMode,
      liveGcal: !!opts.liveGcal
    });
    handleOutput(res, opts.json);
  });

// 4. List (CRUD - Read Multi)
program
  .command('list')
  .description('List reservations from operations ledger')
  .option('--from <date>', 'Filter check-outs after date (YYYY-MM-DD)')
  .option('--to <date>', 'Filter check-ins before date (YYYY-MM-DD)')
  .option('--include-cancelled', 'Include cancelled reservations')
  .option('--include-test', 'Include sandbox test reservations (is_test=1)')
  .option('--json', 'Output raw JSON envelope')
  .action(async (opts) => {
    const res = await client.listReservations({
      from: opts.from,
      to: opts.to,
      includeCancelled: !!opts.includeCancelled,
      includeTest: !!opts.includeTest
    });
    handleOutput(res, opts.json);
  });

// 5. Get (CRUD - Read Single)
program
  .command('get')
  .description('Get single reservation by reference ID')
  .requiredOption('--ref <refId>', 'Reservation reference ID (e.g. CND-4821)')
  .option('--json', 'Output raw JSON envelope')
  .action(async (opts) => {
    const res = await client.getReservation(opts.ref);
    handleOutput(res, opts.json);
  });

// 6. Update (CRUD - Update)
program
  .command('update')
  .description('Update/reschedule a reservation on Google Calendar & SQLite')
  .requiredOption('--ref <refId>', 'Reservation reference ID')
  .option('--name <guestName>', 'Updated guest name')
  .option('--checkin <date>', 'Updated check-in date (YYYY-MM-DD)')
  .option('--checkout <date>', 'Updated check-out date (YYYY-MM-DD)')
  .option('--guests <number>', 'Updated guest count')
  .option('--parking', 'Add covered parking')
  .option('--no-parking', 'Remove covered parking')
  .option('--plate <plate>', 'Updated plate number')
  .option('--json', 'Output raw JSON envelope')
  .action(async (opts) => {
    const patch = {};
    if (opts.name) patch.guestName = opts.name;
    if (opts.checkin) patch.checkIn = opts.checkin;
    if (opts.checkout) patch.checkOut = opts.checkout;
    if (opts.guests) patch.guests = parseInt(opts.guests, 10);
    if (opts.parking !== undefined) patch.coveredParking = opts.parking;
    if (opts.plate) patch.plateNumber = opts.plate;

    const res = await client.updateReservation(opts.ref, patch);
    handleOutput(res, opts.json);
  });

// 7. Cancel (CRUD - Delete)
program
  .command('cancel')
  .description('Cancel reservation: remove from Google Calendar and soft-cancel in SQLite')
  .requiredOption('--ref <refId>', 'Reservation reference ID')
  .option('--reason <reason>', 'Cancellation reason')
  .option('--json', 'Output raw JSON envelope')
  .action(async (opts) => {
    const res = await client.cancelReservation(opts.ref, { reason: opts.reason });
    handleOutput(res, opts.json);
  });

// 8. Endorse
program
  .command('endorse')
  .description('Update Serin East building admin endorsement clearance')
  .requiredOption('--ref <refId>', 'Reservation reference ID (e.g. CND-4821)')
  .option('--status <status>', 'Endorsement status (PENDING, SUBMITTED, CLEARED)', 'CLEARED')
  .option('--plate <plate>', 'Vehicle plate number')
  .option('--json', 'Output raw JSON envelope')
  .action(async (opts) => {
    const res = await client.updateEndorsement(opts.ref, {
      status: opts.status,
      plateNumber: opts.plate
    });
    handleOutput(res, opts.json);
  });

// 9. Deposit
program
  .command('deposit')
  .description('Manage refundable security deposit (collect, refund, deduct)')
  .requiredOption('--ref <refId>', 'Reservation reference ID')
  .requiredOption('--action <action>', 'Action: collect, refund, deduct')
  .option('--amount <number>', 'Amount in PHP', '3000')
  .option('--notes <text>', 'Notes or deduction reasons')
  .option('--json', 'Output raw JSON envelope')
  .action(async (opts) => {
    const res = await client.manageDeposit(opts.ref, {
      action: opts.action,
      amount: parseFloat(opts.amount),
      notes: opts.notes
    });
    handleOutput(res, opts.json);
  });

// 10. Turnover
program
  .command('turnover')
  .description('Update caretaker cleaning and pre-arrival turnover status')
  .requiredOption('--ref <refId>', 'Reservation reference ID')
  .option('--status <status>', 'Status: PENDING, IN_PROGRESS, COMPLETED', 'COMPLETED')
  .option('--ready', 'Mark caretaker inspection complete and ready for guest')
  .option('--before-photos <url>', 'Drive URL of before-cleaning photos')
  .option('--after-photos <url>', 'Drive URL of after-cleaning photos')
  .option('--inventory-ok', 'Confirm 2BR 70sqm inventory checklist verified')
  .option('--json', 'Output raw JSON envelope')
  .action(async (opts) => {
    const res = await client.updateTurnover(opts.ref, {
      status: opts.status,
      ready: !!opts.ready,
      beforePhotos: opts.beforePhotos,
      afterPhotos: opts.afterPhotos,
      inventoryChecked: !!opts.inventoryOk
    });
    handleOutput(res, opts.json);
  });

// 11. Lock-Code
program
  .command('lock-code')
  .description('Evaluate clearance gates and release digital smart lock PIN')
  .requiredOption('--ref <refId>', 'Reservation reference ID')
  .option('--set-pin <pin>', 'Specific 6-digit PIN to set')
  .option('--json', 'Output raw JSON envelope')
  .action(async (opts) => {
    const res = await client.releaseLockPin(opts.ref, opts.setPin);
    handleOutput(res, opts.json);
  });

// 12. Expense
const expenseCmd = program.command('expense').description('Track condo monthly utilities and expenses');

expenseCmd
  .command('add')
  .description('Log a unit operational expense')
  .requiredOption('--category <category>', 'Category: cleaning, laundry, meralco, water, condo_dues, repair')
  .requiredOption('--amount <number>', 'Amount in PHP')
  .requiredOption('--date <date>', 'Expense date (YYYY-MM-DD)')
  .option('--notes <notes>', 'Expense description / notes')
  .option('--json', 'Output raw JSON envelope')
  .action(async (opts) => {
    const res = await client.addExpense({
      category: opts.category,
      amount: parseFloat(opts.amount),
      date: opts.date,
      notes: opts.notes
    });
    handleOutput(res, opts.json);
  });

expenseCmd
  .command('report')
  .description('Generate monthly expense report')
  .requiredOption('--month <yearMonth>', 'Target month (YYYY-MM)')
  .option('--json', 'Output raw JSON envelope')
  .action(async (opts) => {
    const res = await client.getExpenseReport(opts.month);
    handleOutput(res, opts.json);
  });

// 13. Sync Backend
program
  .command('sync')
  .description('Trigger Tri-Way backend synchronization (Calendar <-> Sheets <-> SQLite)')
  .option('--direction <dir>', 'Sync direction: pull, push, bidirectional', 'bidirectional')
  .option('--dry-run', 'Simulate sync without modifying database')
  .option('--json', 'Output raw JSON envelope')
  .action((opts) => {
    const syncScript = join(__dirname, '../python/condo_booking_sdk/sync.py');
    const args = [syncScript, '--direction', opts.direction];
    if (opts.dryRun) args.push('--dry-run');
    if (opts.json) args.push('--json');

    const proc = spawn('python3', args, { stdio: 'inherit' });
    proc.on('close', (code) => {
      process.exit(code);
    });
  });

// 14. Test Booking (End-to-End Test Mode Pipeline)
const testBookingCmd = program.command('test-booking').description('Zero-risk automated E2E test booking pipeline');

testBookingCmd
  .command('run')
  .description('Run full 8-stage test booking pipeline (Quote -> Reserve -> Gate -> Endorse -> Turnover -> Deposit -> Lock -> Cleanup)')
  .option('--checkin <date>', 'Test check-in date (YYYY-MM-DD)', '2027-01-10')
  .option('--checkout <date>', 'Test check-out date (YYYY-MM-DD)', '2027-01-12')
  .option('--channel <channel>', 'Channel (direct, airbnb, agoda)', 'direct')
  .option('--live-gcal', 'Also create and verify [TEST] event on live Google Calendar')
  .option('--keep', 'Preserve the test booking record in SQLite (is_test=1) instead of auto-cleaning')
  .option('--json', 'Output raw JSON envelope')
  .action(async (opts) => {
    const res = await client.runTestBookingPipeline({
      checkIn: opts.checkin,
      checkOut: opts.checkout,
      channel: opts.channel,
      liveGcal: !!opts.liveGcal,
      keep: !!opts.keep
    });
    handleOutput(res, opts.json);
  });

testBookingCmd
  .command('cleanup')
  .description('Purge all sandbox test bookings from SQLite and Google Calendar')
  .option('--ref <refId>', 'Specific test reference ID to purge (optional)')
  .option('--json', 'Output raw JSON envelope')
  .action(async (opts) => {
    const res = await client.cleanupTestBookings(opts.ref);
    handleOutput(res, opts.json);
  });

program.parse(process.argv);
