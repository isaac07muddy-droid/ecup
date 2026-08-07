# eKombe — eFootball Tournament Platform (real backend)

This is the **real, working full-stack version** of eKombe: a Node.js server with a
real database, real accounts (sign-up / log-in with encrypted passwords), server-side
bracket logic, and the **pass-through** money model (entry fees are held per-tournament
and paid to winners on completion — no stored user wallet balances).

Everything saves permanently and syncs across devices. This is the foundation to launch on.

## Launch mode: FREE-ONLY

The app ships in **free-only mode** (`FREE_ONLY = true` in `server.js`). No money changes
hands — all tournaments are free, and no fees are recorded. This means you can launch and
grow an audience **without registering a business or wiring any payments**, with zero legal
or financial risk.

The full **pass-through** payment system is already built and sits dormant underneath. When
you're ready (business registered, Selcom/gateway account live), set `FREE_ONLY = false`,
flip `PAYMENTS_LIVE = true`, and wire the collect/payout calls at the ledger points — the
structure is all there.

## What's inside

- `server.js` — the API (Express): auth, tournaments, brackets, pass-through payments
- `store.js` — the data store: a pure-JavaScript JSON-file database (zero native deps, so
  `npm install` never needs a compiler). Shapes map directly to SQL tables for a later move to Postgres.
- `bracket.js` — server-side bracket engine (single elim, double elim, league, groups + knockout)
- `public/index.html` — the connected front-end (talks to the API; the eKombe app)
- `ekombe-data.json` — the data file (created automatically on first run)

## Run it locally

You need Node.js 18+ installed. Then:

```bash
npm install
npm start
```

Open **http://localhost:3000** in your browser. Create an account and start a tournament —
refresh the page or reopen it later and your data is still there.

## How the money works (pass-through)

There is **no stored wallet**. This keeps you from holding customer balances on day one.
- Creating a tournament records a small **creation fee** (200 TSh / 25 KSh equivalent, by country).
- Joining a paid tournament **holds** the entry fee for that tournament only.
- When the tournament finishes, the held fees are **paid out to the winners** (60/30/10),
  and the platform keeps a **10% prize-pool cut**.
- Every movement is written to the `transactions` table (the ledger).

Real money is **switched off** (`PAYMENTS_LIVE = false` in `server.js`). Right now the
fees/payouts are recorded but no real mobile-money moves. When your Selcom (and/or a global
gateway) account is ready, wire the collect/payout calls where the ledger writes happen and
flip that flag — the whole structure is already in place.

## Going live (deploy)

This runs anywhere that runs Node.js. Easiest paths:
1. **Render.com / Railway / Fly.io** — connect the repo, set the start command to `npm start`.
   Set an env var `JWT_SECRET` to a long random string.
2. The default JSON-file store is perfect for launch and testing. For larger scale,
   swap `store.js` for **PostgreSQL** (the data shapes map over directly) — note that on
   hosts with an ephemeral filesystem, a JSON file resets on redeploy, so move to a managed
   database before you have real users and real money.
3. Point your domain at the host and you're live.

## Security notes before real launch

- Set a strong `JWT_SECRET` env var (do not ship the dev default).
- Before turning on real payments, register the business, complete Selcom/gateway KYC,
  and get a lawyer/accountant to confirm paid-competition rules in each market.
- Match results are self-reported with evidence; keep the admin dispute review in the loop.

## API quick reference

| Method | Path | What |
|---|---|---|
| POST | /api/register | create account |
| POST | /api/login | log in |
| GET | /api/me | current user |
| GET | /api/tournaments | list |
| POST | /api/tournaments | create (auth) |
| POST | /api/tournaments/:id/join | join (auth) |
| POST | /api/tournaments/:id/bots | add demo players (auth, testing) |
| POST | /api/tournaments/:id/start | start & generate bracket (owner) |
| POST | /api/tournaments/:id/report | report a score (auth) |
| GET | /api/leaderboard | rankings |
| GET | /api/transactions/me | your ledger (auth) |
