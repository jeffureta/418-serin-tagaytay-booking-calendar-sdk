/**
 * SQLite Operational Store for Unit 418 Serin East Tagaytay.
 * Powered by Node.js native `node:sqlite` (DatabaseSync).
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export class CondoOpsStore {
  constructor(dbPath = 'data/condo_ops.db') {
    if (dbPath !== ':memory:') {
      const absPath = resolve(dbPath);
      try {
        mkdirSync(dirname(absPath), { recursive: true });
      } catch (err) {
        // ignore if exists
      }
      this.db = new DatabaseSync(absPath);
    } else {
      this.db = new DatabaseSync(':memory:');
    }
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
        gcal_event_id TEXT,
        gcal_link TEXT,
        booking_status TEXT DEFAULT 'CONFIRMED',
        cancel_reason TEXT,
        is_test INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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

    // Safe migration check for existing tables
    try {
      const pragma = this.db.prepare(`PRAGMA table_info(reservations)`).all();
      const colNames = new Set(pragma.map(c => c.name));
      if (!colNames.has('gcal_event_id')) {
        this.db.exec(`ALTER TABLE reservations ADD COLUMN gcal_event_id TEXT`);
      }
      if (!colNames.has('gcal_link')) {
        this.db.exec(`ALTER TABLE reservations ADD COLUMN gcal_link TEXT`);
      }
      if (!colNames.has('booking_status')) {
        this.db.exec(`ALTER TABLE reservations ADD COLUMN booking_status TEXT DEFAULT 'CONFIRMED'`);
      }
      if (!colNames.has('cancel_reason')) {
        this.db.exec(`ALTER TABLE reservations ADD COLUMN cancel_reason TEXT`);
      }
      if (!colNames.has('is_test')) {
        this.db.exec(`ALTER TABLE reservations ADD COLUMN is_test INTEGER DEFAULT 0`);
      }
      if (!colNames.has('updated_at')) {
        this.db.exec(`ALTER TABLE reservations ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP`);
      }
    } catch (e) {
      // pragma migration error guard
    }
  }

  saveReservation(res) {
    const isTestVal = (res.isTest || (typeof res.refId === 'string' && res.refId.startsWith('TEST-'))) ? 1 : 0;
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO reservations (
        ref_id, guest_name, guest_email, guest_phone,
        check_in, check_out, guests, channel,
        covered_parking, plate_number, total_price,
        endorsement_status, caretaker_ready, lock_pin, pin_released,
        gcal_event_id, gcal_link, booking_status, cancel_reason, is_test, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
      res.pinReleased ? 1 : 0,
      res.gcalEventId || null,
      res.gcalLink || null,
      res.bookingStatus || 'CONFIRMED',
      res.cancelReason || null,
      isTestVal
    );
  }

  getReservation(refId) {
    const stmt = this.db.prepare(`SELECT * FROM reservations WHERE ref_id = ?`);
    const row = stmt.get(refId);
    if (!row) return null;
    return this._formatReservationRow(row);
  }

  listReservations({ from, to, includeCancelled = false, includeTest = false } = {}) {
    let sql = `SELECT * FROM reservations WHERE 1=1`;
    const params = [];
    if (!includeCancelled) {
      sql += ` AND booking_status != 'CANCELLED'`;
    }
    if (!includeTest) {
      sql += ` AND (is_test = 0 OR is_test IS NULL)`;
    }
    if (from) {
      sql += ` AND check_out >= ?`;
      params.push(from);
    }
    if (to) {
      sql += ` AND check_in <= ?`;
      params.push(to);
    }
    sql += ` ORDER BY check_in ASC`;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);
    return rows.map(r => this._formatReservationRow(r));
  }

  updateReservation(refId, patch) {
    const existing = this.getReservation(refId);
    if (!existing) return null;

    const merged = { ...existing, ...patch };
    this.saveReservation(merged);
    return this.getReservation(refId);
  }

  cancelReservation(refId, reason = '') {
    const stmt = this.db.prepare(`
      UPDATE reservations
      SET booking_status = 'CANCELLED', cancel_reason = ?, updated_at = CURRENT_TIMESTAMP
      WHERE ref_id = ?
    `);
    stmt.run(reason || null, refId);
    return this.getReservation(refId);
  }

  _formatReservationRow(row) {
    return {
      refId: row.ref_id,
      guestName: row.guest_name,
      guestEmail: row.guest_email,
      guestPhone: row.guest_phone,
      checkIn: row.check_in,
      checkOut: row.check_out,
      guests: row.guests,
      channel: row.channel,
      coveredParking: row.covered_parking ? 1 : 0,
      plateNumber: row.plate_number,
      totalPrice: row.total_price,
      endorsementStatus: row.endorsement_status,
      caretakerReady: row.caretaker_ready ? 1 : 0,
      lockPin: row.lock_pin,
      pinReleased: row.pin_released === 1,
      gcalEventId: row.gcal_event_id,
      gcalLink: row.gcal_link,
      bookingStatus: row.booking_status || 'CONFIRMED',
      cancelReason: row.cancel_reason,
      isTest: row.is_test === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  purgeTestReservations(refId = null) {
    if (refId) {
      this.db.prepare(`DELETE FROM reservations WHERE ref_id = ? AND (is_test = 1 OR ref_id LIKE 'TEST-%')`).run(refId);
      this.db.prepare(`DELETE FROM security_deposits WHERE ref_id = ?`).run(refId);
      this.db.prepare(`DELETE FROM caretaker_turnovers WHERE ref_id = ?`).run(refId);
    } else {
      this.db.prepare(`DELETE FROM reservations WHERE is_test = 1 OR ref_id LIKE 'TEST-%'`).run();
      this.db.prepare(`DELETE FROM security_deposits WHERE ref_id LIKE 'TEST-%'`).run();
      this.db.prepare(`DELETE FROM caretaker_turnovers WHERE ref_id LIKE 'TEST-%'`).run();
    }
  }

  updateEndorsement(refId, { status, plateNumber }) {
    const stmt = this.db.prepare(`
      UPDATE reservations
      SET endorsement_status = COALESCE(?, endorsement_status),
          plate_number = COALESCE(?, plate_number),
          updated_at = CURRENT_TIMESTAMP
      WHERE ref_id = ?
    `);
    stmt.run(status || null, plateNumber || null, refId);
  }

  updateTurnover(refId, { status, ready, beforePhotos, afterPhotos, inventoryChecked }) {
    const readyVal = ready ? 1 : 0;
    const stmtRes = this.db.prepare(`UPDATE reservations SET caretaker_ready = ?, updated_at = CURRENT_TIMESTAMP WHERE ref_id = ?`);
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
      SET lock_pin = ?, pin_released = ?, updated_at = CURRENT_TIMESTAMP
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
