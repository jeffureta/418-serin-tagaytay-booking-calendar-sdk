#!/usr/bin/env node

/**
 * condo-book CLI Binary
 * Command-line interface for Unit 418 Serin East Tagaytay Booking & Calendar Operations.
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

// 3. Reserve
program
  .command('reserve')
  .description('Create a new reservation in the operations ledger')
  .requiredOption('--name <guestName>', 'Primary guest name')
  .requiredOption('--checkin <date>', 'Check-in date (YYYY-MM-DD)')
  .requiredOption('--checkout <date>', 'Check-out date (YYYY-MM-DD)')
  .option('--email <email>', 'Primary guest email')
  .option('--phone <phone>', 'Primary guest mobile number')
  .option('--guests <number>', 'Number of guests', '2')
  .option('--channel <channel>', 'Channel (direct, airbnb, agoda)', 'direct')
  .option('--parking', 'Include covered parking slot')
  .option('--plate <plate>', 'Vehicle plate number for covered parking')
  .option('--json', 'Output raw JSON envelope')
  .action(async (opts) => {
    const res = await client.createReservation({
      guestName: opts.name,
      guestEmail: opts.email,
      guestPhone: opts.phone,
      checkIn: opts.checkin,
      checkOut: opts.checkout,
      guests: parseInt(opts.guests, 10),
      channel: opts.channel,
      coveredParking: !!opts.parking,
      plateNumber: opts.plate
    });
    handleOutput(res, opts.json);
  });

// 4. Endorse
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

// 5. Deposit
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

// 6. Turnover
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

// 7. Lock-Code
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

// 8. Expense
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

// 9. Sync Backend
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

program.parse(process.argv);
