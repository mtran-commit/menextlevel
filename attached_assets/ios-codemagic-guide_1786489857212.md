# Wowlette — iOS App via Codemagic (no Mac required)

This guide builds and uploads the **iOS** app to the App Store using
**Codemagic**, a cloud CI/CD service that runs the iOS build on **cloud macOS
machines**. You never need to own a Mac — everything you do locally works from
any OS plus a browser.

The plan: wrap the existing web app (`artifacts/wowlette`) in a **Capacitor**
native shell (a web bundle shipped inside a native iOS app). The app keeps
talking to the live Wowlette backend, so the Replit deployment must stay
**published** — the native app is a client of the live API, not a copy of it.

> Capacitor (not Expo/React Native) is the right tool here because Wowlette is
> a React + Vite web app, not a React Native project. Codemagic supports
> Capacitor directly.

## How this repo differs from a typical Capacitor project

This is a **pnpm monorepo**; the web app lives in `artifacts/wowlette` and
builds with Vite to `artifacts/wowlette/dist/public`. Things that matter for
mobile:

1. **API URLs.** The frontend calls the API through the generated client's
   `customFetch`, which supports a configurable absolute base URL. Inside the
   native shell the page is served from `capacitor://localhost`, so relative
   `/api/...` calls would fail. `src/lib/store.tsx` now detects the native
   shell and points the client at the live server:

   ```ts
   const PROD_API_ORIGIN = 'https://wowlette.com';
   if (typeof window !== 'undefined' && window.location.protocol === 'capacitor:') {
     setBaseUrl(PROD_API_ORIGIN);
   }
   ```

   > The live domain is `https://wowlette.com`. If the published domain ever
   > changes, update the constant in `artifacts/wowlette/src/lib/store.tsx`
   > and rebuild.

2. **Asset base path.** The Vite config requires a `BASE_PATH` env var. For
   the native bundle it must be relative so assets load from the local shell:
   build with `BASE_PATH=./` (see the yaml).

3. **Server CORS.** Unlike a fully open API, Wowlette's server only opens CORS
   on the public partner endpoint. The API server now also allows the native
   shell origins (`capacitor://localhost`, `ionic://localhost`,
   `http://localhost`) on all `/api` routes — required for login, wallet,
   and business calls from the app. **Republish the Replit deployment** so the
   live server has this change before testing on a device.

4. **Auth.** JWTs live in `localStorage` and are attached as a Bearer header
   by the API client — this works unchanged inside the Capacitor WebView (no
   cookies involved).

5. **Shared libs.** The web app imports workspace libs (`@workspace/api-client-react`),
   so CI builds the libs first (`pnpm run typecheck:libs`) before the Vite build.

## One-time repo setup (DONE)

All of the following is already committed in this repo:

- [x] Capacitor installed in `artifacts/wowlette`
      (`@capacitor/core`, `@capacitor/ios`, `@capacitor/cli`, `@capacitor/assets`).
- [x] `artifacts/wowlette/capacitor.config.json`:

  ```json
  {
    "appId": "com.wowlette.app",
    "appName": "Wowlette",
    "webDir": "dist/public"
  }
  ```

- [x] Native API-base detection added to `src/lib/store.tsx` (see above).
- [x] Native-shell CORS origins allowed on the API server (`artifacts/api-server/src/app.ts`).
- [x] Icon/splash source art in the strict black-and-white brand, matching the
      navbar logo mark (`src/assets/logo.png`, a rounded-diamond wallet/card
      icon): `artifacts/wowlette/assets/icon-only.png` (1024×1024, black
      diamond mark on white) and `assets/splash.png` + `splash-dark.png`
      (2732×2732, light/dark variants) — the layout `@capacitor/assets`
      expects.
- [x] `codemagic.yaml` committed at the repo root.

## Prerequisites (one-time, outside the repo)

- **Apple Developer Program membership** — US$99/year at
  <https://developer.apple.com/programs/>. Required for App Store distribution;
  enrollment can take a day or two.
- **App Store Connect app record** with bundle id **`com.wowlette.app`**
  (step 3 below).
- **Code hosted on GitHub** (or GitLab/Bitbucket) — Codemagic builds from Git.
- **A free Codemagic account** — <https://codemagic.io>, sign up with your Git
  provider.
- **No Mac required.**

## About the `ios/` native project

Capacitor's `ios/` Xcode project is normally created with `npx cap add ios`,
which needs macOS. Two options:

- **Option A — let Codemagic generate it during each build (recommended).**
  The cloud Mac runs `npx cap add ios` fresh every build. Nothing iOS-native
  lives in the repo. This guide uses Option A.
- **Option B — commit a pre-generated `ios/` folder.** Only needed if you later
  require custom native changes (entitlements, extra plugins).

## Step-by-step

### 1. Push the project to GitHub

```bash
git remote -v          # confirm your GitHub remote, or add one:
# git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

### 2. Enroll in the Apple Developer Program

Complete enrollment at <https://developer.apple.com/programs/>.

### 3. Create the App Store Connect app record

At <https://appstoreconnect.apple.com> → **Apps → +**:

- Platform **iOS**, name **Wowlette**, bundle id **`com.wowlette.app`**,
  SKU any unique string (e.g. `wowlette-ios`).
- Note the app's numeric **Apple ID** and put it in `codemagic.yaml`
  (`APP_STORE_APPLE_ID`).
- The listing (description, screenshots, privacy, rating) is completed before
  submitting for review — see the App Review checklist at the end.

### 3a. Register the Safari extension App ID

The build includes a Safari Web Extension target (`com.wowlette.app.extension`).
Apple requires a separate **App ID** for every extension bundle before the
provisioning step can succeed. Without it, `app-store-connect fetch-signing-files`
will exit with a "No bundle ID found" error and the archive step will never run.

**One-time setup in Apple Developer portal:**

1. Go to <https://developer.apple.com/account/resources/identifiers/list>
   (**Certificates, Identifiers & Profiles → Identifiers**).
2. Click **+**, select **App IDs**, then **App**.
3. Fill in:
   - **Description:** `Wowlette Safari Extension`
   - **Bundle ID (Explicit):** `com.wowlette.app.extension`
   - No special capabilities are required (the extension uses no entitlements
     beyond the implicit App Extension entitlement Xcode adds automatically).
4. Click **Continue → Register**.

Once the identifier exists the Codemagic signing step will automatically create
a matching distribution provisioning profile via the App Store Connect API key
(`--create` flag) — no further manual portal work is needed.

### 4. Create an App Store Connect API key

Lets Codemagic upload builds without your Apple password.
**Users and Access → Integrations → App Store Connect API → +**, role
**App Manager**. Download the `.p8` file (one-time download) and note the
**Key ID** and **Issuer ID**.

### 5. Connect the API key in Codemagic

Codemagic → **Teams / Settings → Integrations → Apple Developer Portal /
App Store Connect**: upload the `.p8`, enter Key ID + Issuer ID, and name the
integration **`wowlette_app_store`** (that exact name is referenced in
`codemagic.yaml`). Codemagic uses it for both automatic code signing and
publishing.

### 6. Add the app in Codemagic

**Add application** → pick your Git provider → select this repo → project type
**Other / Capacitor**. Configure via the committed `codemagic.yaml`
(reproducible and version-controlled).

### 7. Run the build

Start the `ios-capacitor` workflow in Codemagic. On a cloud Mac it will:
install pnpm dependencies, build the workspace libs and web app, generate the
`ios/` project, generate icons/splash, sign with your API key, archive an
`.ipa`, and publish it to App Store Connect / TestFlight.

### 8. Test via TestFlight

Install from **TestFlight** on a real iPhone and verify the full flow against
the live backend: **customer sign up/login, browse offers, Add to Wallet
(code minted), the one-card wallet, business login, create offer, staff
redeem (code + PIN), Wallet Leads.**

Demo accounts (password `password123`): `demo@wowlette.app` (customer),
`atlas@wowlette.app` (business).

### 9. Submit for review

Attach the processed build to your app version in App Store Connect, finish
the listing, and **Submit for Review**.

## The committed `codemagic.yaml`

Lives at the repo root. Only two values ever need editing:

- `APP_STORE_APPLE_ID` — the numeric Apple app ID from step 3.
- `app_store_connect: wowlette_app_store` — only if you named the Codemagic
  integration differently in step 5.

Notes on the workflow:

- **`node: 24`** — bundles npm 11 (avoids the old npm "Exit handler never
  called!" crash) and satisfies Capacitor's Node ≥ 22 requirement.
- **Lockfile registry rewrite** — Replit's dev environment resolves packages
  through an internal proxy that is unreachable on Codemagic; a `perl`
  one-liner rewrites those URLs at build time only. The committed lockfile is
  left untouched for Replit.
- **`pnpm-workspace.yaml` platform-override strip** — the Replit template
  excludes non-Linux native binaries; the Mac build needs the darwin ones, so
  CI strips the `"-"` exclusions (build-time only).
- **`pnpm run typecheck:libs` before the Vite build** — builds the composite
  workspace libs (`api-client-react`, `api-zod`, `db`) that the web app
  imports.
- **`BASE_PATH=./`** — the monorepo's Vite config requires `BASE_PATH`; a
  relative base makes assets load correctly from `capacitor://localhost`.
- **Monorepo paths** — every Capacitor command runs inside
  `artifacts/wowlette`, and the `.xcworkspace` path in the build step includes
  that prefix.
- **Signing (`fetch-signing-files --create`)** — mints a fresh certificate and
  App Store provisioning profile every build via the App Store Connect API
  key; no manual certificate juggling, no Mac Keychain.

## Backend note (important)

The native app is a thin client of the **live** site. Keep the Replit
deployment **published**, and republish it once so the CORS change for the
native shell is live. If the published domain ever changes, update
`PROD_API_ORIGIN` in `artifacts/wowlette/src/lib/store.tsx` and rebuild.

## App Review checklist

- Complete **App Privacy** in App Store Connect (data collected: name, email,
  phone for accounts/leads; no payment data — the app has no purchases).
- Screenshots for 6.7" and 6.5" iPhones (take them in TestFlight).
- A support URL and a privacy policy URL are required for the listing — if the
  site doesn't have a privacy page yet, add one before submitting.
- Reviewers need a working demo login — supply
  `demo@wowlette.app` / `password123` in the **App Review notes**.

For the full end-to-end submission walkthrough — listing completion, App Privacy
questionnaire, screenshots, age rating, review notes, enabling
`submit_to_app_store`, post-approval release, and update workflow — see
**[`docs/apple-review-submission.md`](apple-review-submission.md)**.
