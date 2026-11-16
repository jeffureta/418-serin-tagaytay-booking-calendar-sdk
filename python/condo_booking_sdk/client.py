import json
import subprocess
import os

class CondoBookingClient:
    """Zero-dependency Python client executing condo-book CLI with JSON envelopes."""

    def __init__(self, target="local", cli_path=None):
        self.target = target
        if cli_path is None:
            # Look relative to repository root or use global binary
            base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
            local_bin = os.path.join(base_dir, "bin", "condo-book.js")
            self.cli_path = local_bin if os.path.exists(local_bin) else "condo-book"
        else:
            self.cli_path = cli_path

    def _run_cli(self, args):
        cmd = ["node", self.cli_path] + args + ["--json"]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        try:
            return json.loads(proc.stdout)
        except json.JSONDecodeError:
            return {
                "success": False,
                "status": "CLI_ERROR",
                "error": {
                    "code": proc.returncode,
                    "stderr": proc.stderr,
                    "stdout": proc.stdout
                }
            }

    def get_availability(self, from_date=None, to_date=None):
        args = ["availability"]
        if from_date:
            args.extend(["--from", from_date])
        if to_date:
            args.extend(["--to", to_date])
        return self._run_cli(args)

    def calculate_quote(self, check_in, check_out, guests=2, covered_parking=False, channel="direct"):
        args = [
            "quote",
            "--checkin", check_in,
            "--checkout", check_out,
            "--guests", str(guests),
            "--channel", channel
        ]
        if covered_parking:
            args.append("--parking")
        return self._run_cli(args)

    def create_reservation(self, name, check_in, check_out, guests=2, channel="direct", covered_parking=False, plate=None, email=None, phone=None):
        args = [
            "reserve",
            "--name", name,
            "--checkin", check_in,
            "--checkout", check_out,
            "--guests", str(guests),
            "--channel", channel
        ]
        if covered_parking:
            args.append("--parking")
        if plate:
            args.extend(["--plate", plate])
        if email:
            args.extend(["--email", email])
        if phone:
            args.extend(["--phone", phone])
        return self._run_cli(args)

    def update_endorsement(self, ref_id, status="CLEARED", plate=None):
        args = ["endorse", "--ref", ref_id, "--status", status]
        if plate:
            args.extend(["--plate", plate])
        return self._run_cli(args)

    def manage_deposit(self, ref_id, action="collect", amount=3000, notes=None):
        args = ["deposit", "--ref", ref_id, "--action", action, "--amount", str(amount)]
        if notes:
            args.extend(["--notes", notes])
        return self._run_cli(args)

    def release_lock_pin(self, ref_id, set_pin=None):
        args = ["lock-code", "--ref", ref_id]
        if set_pin:
            args.extend(["--set-pin", set_pin])
        return self._run_cli(args)

    def add_expense(self, category, amount, date, notes=None):
        args = ["expense", "add", "--category", category, "--amount", str(amount), "--date", date]
        if notes:
            args.extend(["--notes", notes])
        return self._run_cli(args)

    def get_expense_report(self, month):
        args = ["expense", "report", "--month", month]
        return self._run_cli(args)
