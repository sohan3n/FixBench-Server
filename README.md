# FixBench API Server (`fix-bench-server`)

Backend REST API and Stripe webhook processor for **FixBench**, a verified repair and home-appliance service marketplace. Built with Node.js, Express 5, TypeScript, native MongoDB driver, BetterAuth JWKS JWT verification, and Stripe Checkout.

---

## Live Links & Repositories

- **Live Client Application:** `https://<your-client-domain>.vercel.app`
- **Live API Server:** `https://<your-server-domain>.vercel.app`
- **Client Repository:** `https://github.com/sohan3n/fix-bench`
- **Server Repository:** `https://github.com/sohan3n/fix-bench-server`

---

## Test & Examiner Credentials

Run `npm run seed` to populate all stakeholder accounts, 15 services, 8 multi-stage bookings, and 4 Stripe payment records:

| Role | Email | Password | Notes |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin@fixbench.com` | `Admin@1234` | Full access to `/dashboard/admin`, user role management, service moderation, and Stripe revenue ledger |
| **Technician (Verified Pro)** | `tech.pro@fixbench.com` | `Tech@1234` | Verified Pro badge, unlimited listings, active job pipeline |
| **Technician (Free Tier)** | `tech.free@fixbench.com` | `Tech@1234` | Free plan (2-listing cap) |
| **Customer** | `customer@fixbench.com` | `Customer@1234` | Pre-loaded with `Requested`, `Accepted`, `In Progress`, `Completed (Unpaid)`, and `Completed (Paid)` bookings |

---

## Key Backend Features

- **Asymmetric JWKS JWT Verification (`jose`):** Verifies short-lived EdDSA/RS256 BetterAuth tokens issued by the Next.js client and hydrates authoritative user `role` and `plan` directly from MongoDB on every protected request.
- **Role-Based Access Control (`verifyToken`, `verifyCustomer`, `verifyTechnician`, `verifyAdmin`):** Enforces strict separation across customer bookings, technician listings/job pipelines, and admin moderation controls.
- **Admin Service Moderation Queue:** Newly created or edited technician listings default to `approvalStatus: "pending"` and require admin approval before appearing in public search/browse queries.
- **Server-Side Filtering, Sorting & Pagination:** `GET /api/services` supports case-insensitive keyword search, category/mode filters, `minPrice`/`maxPrice` range filtering, sorting (`newest`, `price_asc`, `price_desc`), and paginated metadata.
- **4-Stage Job Lifecycle & Post-Completion Payment Gate:** Enforces `requested -> accepted -> in-progress -> completed` state transitions and blocks Stripe Checkout until the technician marks a booking `completed` with a final bill amount.
- **Idempotent Stripe Checkout & Webhook Fulfillment:** Handles both repair bill settlements and Verified Pro technician upgrades (`$19.99`) via `POST /api/payments/webhook` (`express.raw`) and `GET /api/payments/verify` with unique `stripeSessionId` deduplication.
- **Verified Post-Payment Ratings:** Allows 1–5 star customer reviews only on completed and paid bookings, dynamically computing service average ratings and review counts.

---

## Environment Variables (`fix-bench-server/.env`)

```env
PORT=5000
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?appName=FixBench
DB_NAME=fixbench
CLIENT_URL=http://localhost:3000,https://<your-client-domain>.vercel.app
BETTER_AUTH_URL=https://<your-client-domain>.vercel.app
JWKS_URL=https://<your-client-domain>.vercel.app/api/auth/jwks
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
