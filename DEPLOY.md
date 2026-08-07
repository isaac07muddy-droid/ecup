# Getting eKombe online (Phase 1 — free, ~15 minutes)

This puts eKombe on a real web address so you and others can open it in a browser.
Note: in this first version, accounts reset when the app sleeps. That's fine for
testing. Phase 2 (a free permanent database) makes accounts stick forever — we do
that next.

You'll use two free things: **GitHub** (stores the code) and **Render** (runs it).

---

## Step 1 — Put the code on GitHub

1. Go to https://github.com and sign in.
2. Click the **+** (top right) → **New repository**.
3. Name it `ekombe`. Leave it **Public**. Click **Create repository**.
4. On the new page, click the link **"uploading an existing file"**.
5. Open the unzipped `ekombe-app` folder on your computer, select ALL the files
   and folders inside it (including the `public` folder), and **drag them into
   the browser**. Do NOT include the `node_modules` folder if you see one.
6. Wait for the upload to finish, then click **Commit changes**.

Your code is now on GitHub. 🎉

---

## Step 2 — Deploy on Render

1. Go to https://render.com and click **Get Started** — sign in **with GitHub**
   (easiest, links them automatically).
2. Click **New +** → **Blueprint**.
3. Pick your `ekombe` repository from the list. Render reads the included
   `render.yaml` and fills everything in for you.
4. Click **Apply** (or **Create**).
5. Wait a few minutes while it builds. When it's done, Render shows a link like
   `https://ekombe.onrender.com` — that's your live app. Open it!

If Blueprint doesn't appear, use **New + → Web Service** instead, pick the repo,
and set Build Command to `npm install` and Start Command to `npm start`.

---

## After it's live

- Open the link, register a test account, create a tournament, play it through.
- The first load after it's been idle can take ~30 seconds (free tier waking up).
  That's normal.
- When you're ready for real players, tell me and we'll do **Phase 2**: a free
  permanent database so no one's account ever disappears.
