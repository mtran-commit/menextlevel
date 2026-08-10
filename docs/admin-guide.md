# Me Next Level — Admin Guide

## Overview

The app has **two completely separate authentication systems** that never interfere with each other.

| System | Used by | How it works |
|--------|---------|--------------|
| **JWT cookie** | Admin panel (`/admin/`) | Email + password → signed cookie |
| **Clerk** | Game (`/`) | Sign up / sign in via Clerk |

Signing into the admin panel does **not** create a game account session, and vice versa.

---

## Accessing the Admin Panel

**URL:** `https://your-domain.com/admin/`

### Credentials

| Field | Value |
|-------|-------|
| Email | set via `ADMIN_EMAIL` secret |
| Password | set via `ADMIN_PASSWORD` secret |

> These are environment secrets, not a real email inbox. The account exists only for admin login — it has no game profile.

### Sign-in flow

1. Go to `/admin/`
2. Enter the admin email and password
3. The server checks credentials against `ADMIN_EMAIL` / `ADMIN_PASSWORD`
4. On success, a signed JWT is stored as an `admin_token` cookie (HTTP-only)
5. The dashboard loads

### Sign-out

Click **SIGN OUT** in the top bar. The `admin_token` cookie is cleared and you return to the sign-in form.

---

## Admin Panel Sections

### Dashboard
7 live stat cards: total users, active users, total games played, revenue, open reports, low-stock products, and pending orders.

### Users
Search and manage all registered players. Suspend, reactivate, or delete accounts. Admin accounts cannot be suspended or deleted from here.

### Reports
Review user-submitted reports. Mark as resolved or dismissed.

### Statistics
Game-wide analytics: daily active users, games played over time, top players.

### Announcements
Publish in-app announcements visible to all users.

### Achievement Rules
Configure milestone thresholds (e.g. "score 10 points → earn badge").

### Audit Logs
Read-only log of all admin actions with timestamps.

### Shop / Products
Manage the product catalogue (see below).

---

## Shop Management (`/admin/products.html`)

### Products tab
- **Add product** — name, description, price, image (uploads to cloud storage), stock quantity, sold-out toggle
- **Edit** — click any product row to edit inline
- **Duplicate** — clone a product as a draft
- **Delete** — permanent, requires confirmation
- **Sold Out toggle** — marks product as sold out on the public shop without deleting it

### Orders tab
- View all orders with search by name, email, order #, status, or date range
- Click any order to open the detail modal:
  - Update status: `pending → processing → shipped → delivered`
  - Add tracking number and courier name
  - Add private admin notes
  - Issue refund (with confirmation prompt)

### Dashboard tab
Revenue, order counts, best-selling products, recent activity.

---

## Public Shop

**URL:** `https://your-domain.com/shop/`

- Lists all active products pulled live from the API
- Sold-out products show a **SOLD OUT** badge with the buy button disabled
- Accessible to all visitors (no login required to browse)

---

## How the Two Auth Systems Co-exist

```
/admin/  →  POST /api/admin/login  →  admin_token cookie (JWT)
             ↑ checked by requireAdmin middleware on all /admin/* routes

/        →  Clerk session cookie
             ↑ checked by requireAuth middleware on all player routes
```

- Admin panel checks only the `admin_token` cookie — it ignores Clerk entirely
- The game checks only the Clerk session — it ignores `admin_token` entirely
- The two systems are fully isolated — neither one bleeds into the other

### Behaviour by scenario

| Logged in via | Visit `/admin/` | Visit `/` |
|---|---|---|
| Admin panel (JWT) only | ✅ Full access | 👤 Guest |
| Game Clerk account (any role) | 🔒 Sign-in form required | ✅ Logged-in player |
| Both independently | ✅ Full access | ✅ Logged-in player |

**Key rules:**

1. **Admin panel → Game:** Signing into `/admin/` sets only the JWT cookie. The game does not know about it, so you appear as a guest at `/`.

2. **Game → Admin panel:** Even if your Clerk game account has `role: admin`, the admin panel still shows the sign-in form. The Clerk session grants no access to `/admin/` — the JWT credentials (`ADMIN_EMAIL` / `ADMIN_PASSWORD`) are always required.

3. **Admin-role Clerk accounts:** If you sign into the *game* with a Clerk account that has `role: admin` in the database, the game shows an **"Open Admin Dashboard"** shortcut link in your profile panel. Clicking it takes you to `/admin/` — which still requires its own separate JWT login. This shortcut is a convenience link only, not an access bypass.

---

## Environment Secrets Reference

| Secret | Purpose |
|--------|---------|
| `ADMIN_EMAIL` | Admin panel login email |
| `ADMIN_PASSWORD` | Admin panel login password |
| `ADMIN_JWT_SECRET` | Signs the `admin_token` JWT (rotate to invalidate all sessions) |
| `CLERK_SECRET_KEY` | Clerk backend key (game auth) |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk frontend key (game auth) |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | GCS bucket for product image uploads |

---

## Rotating the Admin Password

1. Update the `ADMIN_PASSWORD` secret in Replit
2. Restart the API server workflow
3. Sign out of the admin panel and sign back in with the new password

## Rotating the JWT Secret

1. Update the `ADMIN_JWT_SECRET` secret in Replit
2. Restart the API server workflow
3. All existing `admin_token` cookies are immediately invalidated — anyone logged into the admin panel will be redirected to the sign-in form
