# 418 Serin Tagaytay Booking Calendar SDK & CLI

A **100% Cost-Free, Zero-Cloud-Dependency** Booking Calendar Dual-Language SDK (ESM JavaScript / TypeScript + Python 3) and `condo-book` CLI built specifically for **Unit 418 Serin East Tagaytay**.

Directly connected to the live Google Calendar:
`https://calendar.google.com/calendar/embed?src=5e250418f97d2008bff93cc10a638b2aabe981af2d5e271b058eb8835dde2ae2%40group.calendar.google.com&ctz=Europe%2FLondon`

---

## Features
- **Live Google Calendar Availability**: Zero-cost public iCal (`basic.ics`) parsing for real-time calendar synchronization.
- **Turnover & Schedule Alignment**: Standard 2:00 PM Check-In / 12:00 NN Check-Out (aligned with Serin East caretaker turnover and covered parking slot schedule).
- **Dynamic Pricing Engine**: Undercut Tagaytay benchmark pricing (-₱500/night), ₱350/night covered parking add-on, and channel deposit policies (₱3,000 refundable cash deposit for Direct/Agoda vs AirCover for Airbnb).
- **Endorsement & PIN Release Gate**: Conditional digital lock PIN release based on pre-arrival [Serin Endorsement Carrd](https://serineasttagaytayendorsement.carrd.co/) submission and caretaker inspection readiness.
- **Operational Persistence**: Powered by Node.js native `node:sqlite` (`condo_ops.db`).
- **Standard Protocol Envelope**: Every command and SDK method returns `{ success, status, data, error, meta }` compatible with autonomous sub-agents and `gas-cli`.

---

## Installation & Setup

```bash
# Clone and install dependencies
git clone https://github.com/jeffureta/418-serin-tagaytay-booking-calendar-sdk.git
cd 418-serin-tagaytay-booking-calendar-sdk
npm install
npm link # gives you global 'condo-book' CLI command
```

---

## CLI Usage (`condo-book`)

### 1. Live Calendar Availability
```bash
# Query live Google Calendar availability
condo-book availability --from 2026-11-01 --to 2026-11-30 --json
```

### 2. Stay Quote Calculation
```bash
# Calculate quote with ₱350/night covered parking
condo-book quote --checkin 2026-12-20 --checkout 2026-12-22 --guests 4 --parking
```

### 3. Create Reservation
```bash
condo-book reserve --name "Juan Dela Cruz" --checkin 2026-12-20 --checkout 2026-12-22 \
  --guests 4 --channel direct --parking --plate "ABC-1234" --json
```

### 4. Endorsement Clearance & Smart Lock Gate
```bash
# 1. Update endorsement clearance
condo-book endorse --ref CND-4821 --status CLEARED --plate "ABC-1234"

# 2. Update caretaker turnover
condo-book turnover --ref CND-4821 --ready --status COMPLETED

# 3. Collect refundable deposit
condo-book deposit --ref CND-4821 --action collect --amount 3000

# 4. Release smart lock PIN
condo-book lock-code --ref CND-4821 --set-pin 849201 --json
```

### 5. Utility & Expense Tracking
```bash
# Add monthly Meralco electricity bill
condo-book expense add --category meralco --amount 2450.50 --date 2026-11-14 --notes "November bill"

# View monthly report
condo-book expense report --month 2026-11 --json
```

---

## Dual-Language SDK Usage

### ESM JavaScript SDK
```javascript
import { CondoBookingClient } from '418-serin-tagaytay-booking-calendar-sdk';

const client = new CondoBookingClient();

const quote = await client.calculateQuote({
  checkIn: '2026-12-20',
  checkOut: '2026-12-22',
  guests: 4,
  coveredParking: true,
  channel: 'direct'
});
console.log(quote.data.totalDueAtBooking);
```

### Zero-Dependency Python 3 SDK
```python
from condo_booking_sdk import CondoBookingClient

client = CondoBookingClient(target="local")

quote = client.calculate_quote(
    check_in="2026-12-20",
    check_out="2026-12-22",
    guests=4,
    covered_parking=True,
    channel="direct"
)
print("Total Price PHP:", quote["data"]["totalDueAtBooking"])
```

---

## Verification & TDD Safety Gates

```bash
# Run 100% in-memory Node.js unit tests (<200ms)
npm test

# Run Python SDK unittest suite (<150ms)
npm run test:python
```
