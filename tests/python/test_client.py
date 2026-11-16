import unittest
import os
import sys
from condo_booking_sdk import CondoBookingClient

class TestCondoBookingSDK(unittest.TestCase):
    def setUp(self):
        self.client = CondoBookingClient(target="local")

    def test_calculate_quote(self):
        res = self.client.calculate_quote(
            check_in="2026-12-20",
            check_out="2026-12-22",
            guests=4,
            covered_parking=True,
            channel="direct"
        )
        self.assertTrue(res.get("success"))
        self.assertEqual(res.get("status"), "OK")
        data = res.get("data", {})
        self.assertEqual(data.get("parkingNights"), 2)
        self.assertEqual(data.get("parkingTotal"), 700)
        self.assertEqual(data.get("securityDeposit"), 3000)

    def test_expense_logging_and_report(self):
        add_res = self.client.add_expense(
            category="laundry",
            amount=550.0,
            date="2026-11-14",
            notes="Linens and towels post-checkout"
        )
        self.assertTrue(add_res.get("success"))
        self.assertEqual(add_res.get("status"), "EXPENSE_ADDED")

        rep_res = self.client.get_expense_report(month="2026-11")
        self.assertTrue(rep_res.get("success"))
        self.assertGreaterEqual(rep_res.get("data", {}).get("totalAmount", 0), 550.0)

if __name__ == "__main__":
    unittest.main()
