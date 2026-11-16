/**
 * SQLite Operational Store for Unit 418 Serin East Tagaytay.
 * Powered by Node.js native `node:sqlite` (DatabaseSync).
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class CondoOpsStore {
  constructor(dbPath = 'data/condo_ops.db') {
    if (dbPath !== ':memory:') {
      try {
        mkdirSync(dirname(dbPath), { recursive: true });
      } catch (err) {
        // ignore if exists
      }
    }
    this.db = new DatabaseSync(dbPath);
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reservations (
        ref_id TEXT PRIMARY KEY,
        guest_name TEXT NOT NULL,
        guest_email TEXT,
        guest_phone TEXT,
        check_in TEXT NOT NULL,
        check_out TEXT NOT NULL,
        guests INTEGER DEFAULT 2,
        channel TEXT DEFAULT 'direct',
        covered_parking INTEGER DEFAULT 0,
        plate_number TEXT,
        total_price REAL DEFAULT 0,
        endorsement_status TEXT DEFAULT 'PENDING',
        caretaker_ready INTEGER DEFAULT 0,
        lock_pin TEXT,
        pin_released INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS security_deposits (
        ref_id TEXT PRIMARY KEY,
        channel_policy TEXT,
        amount REAL DEFAULT 0,
        status TEXT DEFAULT 'PENDING',
        notes TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS caretaker_turnovers (
        ref_id TEXT PRIMARY KEY,
        turnover_date TEXT,
        status TEXT DEFAULT 'PENDING',
        before_photos_url TEXT,
        after_photos_url TEXT,
        inventory_checked INTEGER DEFAULT 0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS unit_expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        category TEXT NOT NULL,
        amount REAL NOT NULL,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  saveReservation(res) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO reservations (
        ref_id, guest_name, guest_email, guest_phone,
        check_in, check_out, guests, channel,
        covered_parking, plate_number, total_price,
        endorsement_status, caretaker_ready, lock_pin, pin_released
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      res.refId,
      res.guestName,
      res.guestEmail || null,
      res.guestPhone || null,
      res.checkIn,
      res.checkOut,
      res.guests || 2,
      res.channel || 'direct',
      res.coveredParking ? 1 : 0,
      res.plateNumber || null,
      res.totalPrice || 0,
      res.endorsementStatus || 'PENDING',
      res.caretakerReady ? 1 : 0,
      res.lockPin || null,
      res.pinReleased ? 1 : 0
    );
  }

  getReservation(refId) {
    const stmt = this.db.prepare(`SELECT * FROM reservations WHERE ref_id = ?`);
    const row = stmt.get(refId);
    if (!row) return null;
    return {
      refId: row.ref_id,
      guestName: row.guest_name,
      guestEmail: row.guest_email,
      guestPhone: row.guest_phone,
      checkIn: row.check_in,
      checkOut: row.check_out,
      guests: row.guests,
      channel: row.channel,
      coveredParking: row.covered_parking,
      plateNumber: row.plate_number,
      totalPrice: row.total_price,
      endorsementStatus: row.endorsement_status,
      caretakerReady: row.caretaker_ready,
      lockPin: row.lock_pin,
      pinReleased: row.pin_released
    };
  }

  updateEndorsement(refId, { status, plateNumber }) {
    const stmt = this.db.prepare(`
      UPDATE reservations
      SET endorsement_status = COALESCE(?, endorsement_status),
          plate_number = COALESCE(?, plate_number)
      WHERE ref_id = ?
    `);
    stmt.run(status || null, plateNumber || null, refId);
  }

  updateTurnover(refId, { status, ready, beforePhotos, afterPhotos, inventoryChecked }) {
    const readyVal = ready ? 1 : 0;
    const stmtRes = this.db.prepare(`UPDATE reservations SET caretaker_ready = ? WHERE ref_id = ?`);
    stmtRes.run(readyVal, refId);

    const stmtTurnover = this.db.prepare(`
      INSERT OR REPLACE INTO caretaker_turnovers (
        ref_id, status, before_photos_url, after_photos_url, inventory_checked
      ) VALUES (?, ?, ?, ?, ?)
    `);
    stmtTurnover.run(refId, status || 'COMPLETED', beforePhotos || null, afterPhotos || null, inventoryChecked ? 1 : 0);
  }

  recordDeposit({ refId, channelPolicy, amount, status = 'PENDING', notes }) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO security_deposits (ref_id, channel_policy, amount, status, notes)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(refId, channelPolicy || null, amount || 0, status, notes || null);
  }

  getDeposit(refId) {
    const stmt = this.db.prepare(`SELECT * FROM security_deposits WHERE ref_id = ?`);
    const row = stmt.get(refId);
    if (!row) return null;
    return {
      refId: row.ref_id,
      channelPolicy: row.channel_policy,
      amount: row.amount,
      status: row.status,
      notes: row.notes
    };
  }

  updateDepositStatus(refId, status, notes) {
    const stmt = this.db.prepare(`
      UPDATE security_deposits
      SET status = ?, notes = COALESCE(?, notes), updated_at = CURRENT_TIMESTAMP
      WHERE ref_id = ?
    `);
    stmt.run(status, notes || null, refId);
  }

  setLockPin(refId, pin, release = false) {
    const stmt = this.db.prepare(`
      UPDATE reservations
      SET lock_pin = ?, pin_released = ?
      WHERE ref_id = ?
    `);
    stmt.run(pin, release ? 1 : 0, refId);
  }

  addExpense({ date, category, amount, notes }) {
    const stmt = this.db.prepare(`
      INSERT INTO unit_expenses (date, category, amount, notes)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(date, category, amount, notes || null);
    return { id: result.lastInsertRowid, date, category, amount, notes };
  }

  getMonthlyExpenseReport(yearMonth) {
    const stmt = this.db.prepare(`
      SELECT * FROM unit_expenses
      WHERE date LIKE ?
      ORDER BY date ASC
    `);
    const rows = stmt.all(`${yearMonth}%`);

    let totalAmount = 0;
    const byCategory = {};

    for (const row of rows) {
      totalAmount += row.amount;
      byCategory[row.category] = (byCategory[row.category] || 0) + row.amount;
    }

    return {
      month: yearMonth,
      totalAmount,
      byCategory,
      expenses: rows
    };
  }

  close() {
    this.db.close();
  }
}
