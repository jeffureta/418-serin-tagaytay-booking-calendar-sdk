# Ubiquitous Language: Unit 418 Serin East Tagaytay Booking & Operations

This document establishes the official Domain-Driven Design (DDD) ubiquitous language for the **418-serin-tagaytay-booking-calendar-cli** application suite. All code, CLI commands, database schemas, test cases, and documentation must adhere to these terms.

---

## 1. Core Domain Entities & Concepts

### Reservation
A scheduled booking for Unit 418 Serin East Tagaytay.
- **Reference ID (`refId`)**: Canonical alphanumeric identifier format `CND-XXXX` (e.g. `CND-4821`).
- **Channel**: Booking source platform: `direct`, `airbnb`, `agoda`, `booking_com`, or `facebook`.
- **Primary Guest**: The individual who booked the stay, responsible for submitting government ID.
- **Accompanying Guests**: Additional guests staying in the unit (up to 4 pax standard).

### Stay Window & Turnover
- **Check-In**: Standard check-in time is **2:00 PM (14:00 PHT)**.
- **Check-Out**: Standard check-out time is **12:00 NN (12:00 PHT)**.
- **Turnover Window**: The 2-hour period between **12:00 NN and 2:00 PM** reserved for caretaker unit cleaning, sanitization, linen replenishment, and pre-arrival inventory inspection. Same-day checkout and checkin are permitted because their turnover windows do not overlap.

### Covered Parking Slot
- Dedicated covered tower parking slot at Serin East Tagaytay.
- Standard daily surcharge: **₱350 / night**.
- Aligned to the 12:00 NN – 2:00 PM turnover window.
- Requires guest vehicle make/model and license plate number for administrative clearance.
- Alternative: Free street parking in front of Serin East Tower (subject to availability).

### Endorsement Clearance Gate
- Administrative entry clearance managed via [Serin Endorsement Carrd Link](https://serineasttagaytayendorsement.carrd.co/).
- Building Admin Requirements:
  1. 1 Valid Government-issued ID of primary guest.
  2. Full names of all accompanying guests.
  3. 1 Active mobile contact number.
  4. Vehicle license plate (if covered parking is availed).
- State: `PENDING_SUBMISSION` ➔ `SUBMITTED` ➔ `CLEARED`.

### Security Deposit Hold
- Platform-governed protection against unit damage, rule violations, or smoking/smelly cooking infractions:
  - **Agoda & Direct Bookings**: **₱3,000.00 refundable cash deposit** collected prior to/at check-in and returned post-inspection.
  - **Airbnb**: Covered under AirCover policy (₱0 cash deposit upfront).
  - **Booking.com**: Platform damage policy (14-day claims window).
- State: `NOT_APPLICABLE` | `PENDING_COLLECTION` | `HELD` | `REFUNDED` | `DEDUCTED`.

### Smart Lock PIN Release Gate
- Digital smart door lock installed at Unit 418.
- PIN is released **strictly on check-in day** and only when all gates pass:
  1. `endorsement_cleared == true`
  2. `caretaker_turnover_ready == true`
  3. `security_deposit_cleared == true` (for direct/Agoda)
- State: `LOCKED` ➔ `RELEASED` ➔ `EXPIRED`.

### Unit Expense & Utility Ledger
- Expense tracking category for monthly condo dues, utilities, and turnover costs:
  - `cleaning`: Caretaker turnover and sanitization fee.
  - `laundry`: Bedding and linen cleaning fee.
  - `meralco`: Monthly electricity billing.
  - `water`: Monthly water utility billing.
  - `condo_dues`: Monthly Ayala / Serin East association dues.
  - `repair`: Maintenance, hardware replacement, and repairs.
