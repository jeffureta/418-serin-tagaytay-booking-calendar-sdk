import os
import unittest
import tempfile
import sqlite3
from condo_booking_sdk.sync import CondoSyncCoordinator

class TestCondoSyncCoordinator(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.temp_dir.name, "test_condo_ops.db")
        self.coordinator = CondoSyncCoordinator(db_path=self.db_path)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_schema_initialization(self):
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
            tables = {row[0] for row in cursor.fetchall()}
            self.assertIn("reservations", tables)
            self.assertIn("sync_audit_log", tables)

    def test_pull_remote_records(self):
        mock_remote = {
            "reservations": [
                {
                    "refId": "CND-9901",
                    "guestName": "Juan Dela Cruz",
                    "checkIn": "2026-12-20",
                    "checkOut": "2026-12-22",
                    "guests": 4,
                    "channel": "direct",
                    "coveredParking": 1,
                    "plateNumber": "ABC-1234",
                    "totalPrice": 7500.0,
                    "endorsementStatus": "CLEARED"
                }
            ]
        }
        res = self.coordinator.pull(mock_remote_data=mock_remote)
        self.assertTrue(res["success"])
        self.assertEqual(res["pulled"], 1)

        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT guest_name, total_price, endorsement_status FROM reservations WHERE ref_id='CND-9901'")
            row = cursor.fetchone()
            self.assertIsNotNone(row)
            self.assertEqual(row[0], "Juan Dela Cruz")
            self.assertEqual(row[1], 7500.0)
            self.assertEqual(row[2], "CLEARED")

    def test_push_local_records(self):
        # Insert a local un-synced reservation
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO reservations (ref_id, guest_name, check_in, check_out, total_price, synced_at)
                VALUES ('CND-7788', 'Maria Santos', '2026-12-24', '2026-12-26', 8200.0, NULL)
            """)
            conn.commit()

        pushed_payloads = []
        def mock_sender(payload):
            pushed_payloads.append(payload)

        res = self.coordinator.push(mock_sender=mock_sender)
        self.assertTrue(res["success"])
        self.assertEqual(res["pushed"], 1)
        self.assertEqual(len(pushed_payloads), 1)
        self.assertEqual(pushed_payloads[0]["reservations"][0]["refId"], "CND-7788")

    def test_bidirectional_sync(self):
        mock_remote = {
            "reservations": [
                {
                    "refId": "CND-8822",
                    "guestName": "Robert Tan",
                    "checkIn": "2026-12-28",
                    "checkOut": "2026-12-30",
                    "totalPrice": 6500.0
                }
            ]
        }
        res = self.coordinator.sync_bidirectional(mock_remote_data=mock_remote)
        self.assertTrue(res["success"])
        self.assertEqual(res["pulled"], 1)
        self.assertEqual(res["direction"], "bidirectional")

if __name__ == "__main__":
    unittest.main()
