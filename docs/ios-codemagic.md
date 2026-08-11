# MeNotMe — iOS App via Codemagic (no Mac required)

This guide builds and uploads the **iOS** app to the App Store using
**Codemagic**, a cloud CI/CD service that runs the iOS build on **cloud macOS
machines**. You never need to own a Mac — everything you do locally works from
any OS plus a browser.

The plan: wrap the existing web app (`artifacts/menotme`) in a **Capacitor**
native shell (a web bundle shipped inside a native iOS app). The native app
keeps talking to the **live Replit deployment**, so that deployment must stay
**published** — the native app is a thin client of the live API, not a copy of
it.

> Capacitor (not Expo/React Native) is the right tool here because MeNotMe is
> a React + Vite web app, not a React Native project. Codemagic supports
> Capacitor directly.

---

## How this repo differs from a typical Capacitor project

### 1. pnpm monorepo layout

The web app lives in `artifacts/menotme` and builds with Vite to
`artifacts/menotme/dist/public`. All Capacitor commands must run **inside that
directory**. The `.xcworkspace` path passed to signing and build tools includes
the monorepo prefix:

```
artifacts/menotme/ios/App/App.xcworkspace
```

### 2. Multi-page Vite build

`vite.config.ts` uses `appType: 'mpa'` with five entry points:

| Key              | File                                              |
|------------------|---------------------------------------------------|
| `main`           | `index.html`                                      |
| `admin`          | `admin/index.html`                                |
| `adminProducts`  | `admin/products.html`                             |
| `shop`           | `shop/index.html`                                 |
| `shopSuccess`    | `shop/order-success/index.html`                   |

The iOS native shell only loads the main game entry at `index.html`. The other
pages are bundled into `dist/public` but unused in the native shell.
`webDir: "dist/public"` in `capacitor.config.json` is correct.

### 3. `BASE_PATH` and `PORT` env vars required for CI

`vite.config.ts` throws a hard error if either variable is missing. Pass both
to every `vite build` invocation:

```
BASE_PATH=./  PORT=3000
```

`BASE_PATH=./` makes assets use relative paths so they resolve from
`capacitor://localhost`. `PORT=3000` satisfies the config guard even though
the dev server never starts during a CI build.

### 4. Lockfile registry rewrite

Replit resolves packages through an internal npm proxy unreachable on Codemagic.
A `perl` one-liner rewrites those URLs at build time only (committed lockfile
is untouched):

```bash
perl -i -pe 's|https://[^/]*\.replit\.dev/[^/]*/|https://registry.npmjs.org/|g' pnpm-lock.yaml
```

### 5. `pnpm-workspace.yaml` platform-override strip

`pnpm-workspace.yaml` excludes non-Linux native binaries with `"-"` overrides.
The cloud Mac needs darwin variants, so CI strips those at build time only:

```bash
perl -i -pe 's/: "-"$/: "*"/g' pnpm-workspace.yaml
```

### 6. Workspace libs must be built first

`artifacts/menotme` imports `@workspace/api-client-react`. Build workspace libs
before the Vite build or TypeScript project references will fail:

```bash
pnpm run typecheck:libs
```

### 7. Native shell breaks `cloud.ts` — three variables must be fixed

> ⚠️ **The current `cloud.ts` has three variables that all break inside the
> Capacitor WebView.** Pages served from `capacitor://localhost` cannot use
> `window.location.origin` (returns the non-routable scheme
> `capacitor://localhost`) or relative URLs from `BASE_URL` (which is `./` after
> the Vite build).

The three broken lines (with line numbers from the current file):

```ts
// L12 — API base: BASE_URL is "./" in the native bundle, so BASE = "."
const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

// L15-18 — Clerk publishable key derived from window.location.hostname
//            which is "localhost" — publishableKeyFromHost will not find a key
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,            // ← "localhost" in native shell
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

// L19 — Clerk proxy URL built from window.location.origin
//         which is "capacitor://localhost" — an unreachable origin
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL
  || `${window.location.origin}/api/__clerk`;
```

#### Why the proxy cannot be used in the native shell

The Clerk proxy middleware in `artifacts/api-server/src/app.ts` is mounted
**before** the global CORS middleware:

```ts
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());  // line 38 — runs first
app.use(cors({ credentials: true, origin: true })); // line 40 — too late
```

The proxy uses `selfHandleResponse: true` and writes its response directly,
bypassing all downstream middleware including CORS. Preflight (`OPTIONS`)
requests from `capacitor://localhost` to `/api/__clerk/…` therefore return no
`Access-Control-Allow-Origin` header and the browser rejects them. Sign-in,
OAuth, and session restore all fail silently.

#### Recommended fix: bypass the proxy in the native shell

In the native shell, configure Clerk without a proxy URL. The Capacitor
WebView can make direct HTTPS requests to Clerk's servers
(`https://frontend-api.clerk.dev`) — the proxy is only needed for web
deployments to avoid DNS CNAME setup. Skipping the proxy in native shell
requires no server changes.

**Required patch** — add native-shell detection to the top of
`artifacts/menotme/src/cloud.ts`, replacing the three broken declarations:

```ts
// ── Native-shell detection ────────────────────────────────────────────────────
// Pages served from capacitor://localhost cannot use window.location.origin
// (non-routable scheme) or relative BASE_URL paths.
// VITE_PROD_API_ORIGIN is injected at build time by codemagic.yaml (or .env.local
// for a local native build). It must match the live Replit deployment URL.
const PROD_API_ORIGIN: string = import.meta.env.VITE_PROD_API_ORIGIN || '';
const isNativeShell =
  typeof window !== 'undefined' && window.location.protocol === 'capacitor:';

if (isNativeShell && !PROD_API_ORIGIN) {
  console.error('[MNM] VITE_PROD_API_ORIGIN is not set — API calls will fail in the native shell.');
}

// API base: live origin in native shell; Vite BASE_URL on web.
const BASE = isNativeShell
  ? PROD_API_ORIGIN
  : (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

// Clerk publishable key: use the explicit env var in native shell
// (hostname is "localhost" so publishableKeyFromHost cannot derive it).
const clerkPubKey = isNativeShell
  ? import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
  : publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

// Clerk proxy: skip in native shell (direct connection to Clerk avoids the
// CORS ordering issue with the server proxy). Use proxy on web as before.
const clerkProxyUrl = isNativeShell
  ? undefined
  : (import.meta.env.VITE_CLERK_PROXY_URL || `${window.location.origin}/api/__clerk`);
```

The `clerk` instance creation already handles `undefined` gracefully:

```ts
const clerk = new Clerk(clerkPubKey, clerkProxyUrl ? { proxyUrl: clerkProxyUrl } : undefined);
```

No change is needed there.

#### Alternative: fix CORS ordering on the server (if proxy must be used)

If you later need to use the Clerk proxy from the native shell (e.g. for
Clerk's bot-protection features), add a per-path CORS handler in
`artifacts/api-server/src/app.ts` **before** the proxy middleware:

```ts
// Add this before app.use(CLERK_PROXY_PATH, clerkProxyMiddleware())
app.use(CLERK_PROXY_PATH, cors({ credentials: true, origin: true }));
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
```

Then republish the Replit deployment before testing on device.

### 8. `VITE_CLERK_PUBLISHABLE_KEY` must be a Codemagic build variable

`VITE_CLERK_PUBLISHABLE_KEY` is consumed at build time by Vite
(`import.meta.env.VITE_CLERK_PUBLISHABLE_KEY` in `cloud.ts`). It must be
present in the Codemagic environment at build time. Store it as an encrypted
variable in Codemagic and reference it in `codemagic.yaml` (see §6).

### 9. `VITE_PROD_API_ORIGIN` must be a Codemagic build variable

`VITE_PROD_API_ORIGIN` is likewise consumed at build time. Only `VITE_*`
variables are exposed to Vite client code — a plain `PROD_API_ORIGIN` would
be invisible to `import.meta.env`. Set it in `codemagic.yaml` as shown in §6.

### 10. CORS for native shell API requests

The API server (`app.ts`) currently uses `cors({ origin: true })` which
accepts all origins. Cross-origin API calls from `capacitor://localhost` are
already allowed by this setting. If you ever tighten CORS, ensure these
origins remain explicitly whitelisted:

- `capacitor://localhost`
- `ionic://localhost`
- `http://localhost`

Update `app.ts` and **republish** before testing on device.

---

## One-time repo setup checklist

Commit all of the following before the first Codemagic build.

- [ ] Install Capacitor in `artifacts/menotme`:

  ```bash
  cd artifacts/menotme
  pnpm add -D @capacitor/core @capacitor/ios @capacitor/cli @capacitor/assets
  ```

- [ ] Create `artifacts/menotme/capacitor.config.json`:

  ```json
  {
    "appId": "com.menotme.app",
    "appName": "MeNotMe",
    "webDir": "dist/public"
  }
  ```

- [ ] Apply the native-shell detection patch to `artifacts/menotme/src/cloud.ts`
      (see §7 above).

- [ ] Set `VITE_PROD_API_ORIGIN` in `codemagic.yaml` to your live Replit
      deployment URL. Also create a `.env.local` (gitignored) with the same
      value for any local native builds.

- [ ] Prepare icon and splash source images:
  - `artifacts/menotme/assets/icon-only.png` — 1024×1024 px, the MeNotMe mark
  - `artifacts/menotme/assets/splash.png` — 2732×2732 px, light variant
  - `artifacts/menotme/assets/splash-dark.png` — 2732×2732 px, dark variant

- [ ] Commit `codemagic.yaml` at the **repo root** (see §6).

---

## Prerequisites

- **Apple Developer Program membership** — US$99/year at
  <https://developer.apple.com/programs/>. Enrollment can take 24–48 hours.
- **App Store Connect app record** with bundle id **`com.menotme.app`**.
- **Code hosted on GitHub** (or GitLab/Bitbucket).
- **A free Codemagic account** — <https://codemagic.io>.
- **No Mac required.**

---

## About the `ios/` native project

Two options:

- **Option A — let Codemagic generate it during each build (recommended).**
  The cloud Mac runs `npx cap add ios` fresh every build. Nothing iOS-native
  lives in the repo. This guide uses Option A.
- **Option B — commit a pre-generated `ios/` folder.** Only needed if you
  require custom native changes (entitlements, extra plugins, custom Swift).

---

## Step-by-step

### Step 1 — Push the project to GitHub

```bash
git remote -v
# git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Ensure the one-time repo setup checklist is fully committed first.

### Step 2 — Enroll in the Apple Developer Program

Complete enrollment at <https://developer.apple.com/programs/>.

### Step 3 — Create the App Store Connect app record

At <https://appstoreconnect.apple.com> → **Apps → +**:

- Platform: **iOS**, App name: **MeNotMe**
- Bundle ID: **`com.menotme.app`** (register a new Explicit App ID in the
  Apple Developer portal first if it doesn't exist:
  <https://developer.apple.com/account/resources/identifiers/list>)
- SKU: **`menotme-ios`**

Note the numeric **Apple ID** from App Information — paste it into
`codemagic.yaml` as `APP_STORE_APPLE_ID`.

### Step 4 — Create an App Store Connect API key

**App Store Connect → Users and Access → Integrations → App Store Connect
API → +**, role **App Manager**. Download the `.p8` file (one-time — save it).
Note the **Key ID** and **Issuer ID**.

### Step 5 — Connect the API key in Codemagic

**Codemagic → Teams / Settings → Integrations → Apple Developer Portal**:

1. Upload the `.p8`, enter Key ID and Issuer ID
2. Name the integration exactly: **`menotme_app_store`**

That exact name is referenced in `codemagic.yaml`.

### Step 6 — Add the app in Codemagic

**Add application** → Git provider → this repo → project type **Other /
Capacitor**. Codemagic detects the `codemagic.yaml` at the repo root.

### Step 7 — Run the `ios-capacitor` workflow

Start the workflow. See the full build sequence in §6.

### Step 8 — Test via TestFlight

Install from **TestFlight** on a real iPhone and verify:

- Game loads and plays correctly (assets load from `capacitor://localhost`)
- Clerk sign-up (email + verification code) works
- Clerk sign-in (email/password) works
- Google OAuth sign-in works
- Game state saves and syncs to the cloud after sign-in
- Notification bell and account panel open correctly

All calls reach `VITE_PROD_API_ORIGIN` — confirm the deployment is published
and the constant matches the actual domain.

### Step 9 — Submit for review

1. Attach the TestFlight build to your app version in App Store Connect
2. Complete the listing (see App Review checklist below)
3. Click **Submit for Review**

---

## The complete `codemagic.yaml`

Commit this file verbatim at the **repo root**. Fill in the three values
marked `# ← EDIT`.

```yaml
workflows:
  ios-capacitor:
    name: MeNotMe iOS
    max_build_duration: 60
    instance_type: mac_mini_m1

    # The Codemagic integration named in Step 5.
    # Used for automatic code signing AND TestFlight publishing.
    integrations:
      app_store_connect: menotme_app_store

    environment:
      # Node 24 bundles npm 11 and satisfies Capacitor's Node ≥ 22 requirement.
      node: "24"

      # Automatic code signing: Codemagic fetches a distribution certificate
      # and provisioning profile from Apple and injects them into Xcode.
      ios_signing:
        distribution_type: app_store
        bundle_identifier: com.menotme.app

      vars:
        # ← EDIT: numeric Apple app ID from App Store Connect → App Information
        APP_STORE_APPLE_ID: "XXXXXXXXXX"

        # ← EDIT: your live Replit deployment URL (no trailing slash).
        # Must be a VITE_ prefix so Vite exposes it as import.meta.env.VITE_PROD_API_ORIGIN.
        # Must also match the PROD_API_ORIGIN guard in artifacts/menotme/src/cloud.ts.
        VITE_PROD_API_ORIGIN: "https://YOUR-REPLIT-DOMAIN.replit.app"

        # ← EDIT: your Clerk publishable key (pk_live_… or pk_test_…).
        # Must be a VITE_ prefix so Vite bakes it into the bundle.
        # Store it as an encrypted variable in Codemagic so it is not in
        # plain text: App Settings → Environment variables → Add → Secure: on.
        VITE_CLERK_PUBLISHABLE_KEY: Encrypted(YOUR_ENCRYPTED_VALUE_HERE)

    scripts:
      # ── Tooling ──────────────────────────────────────────────────────────────
      - name: Install pnpm
        script: npm install -g pnpm

      # ── Fix Replit-specific pnpm config (CI machine only) ────────────────────
      # Replit resolves packages through an internal proxy unreachable on
      # Codemagic. Rewrite to the public npm registry.
      # The committed lockfile is not modified — changes are CI-local.
      - name: Rewrite lockfile registry
        script: |
          perl -i -pe \
            's|https://[^/]*\.replit\.dev/[^/]*/|https://registry.npmjs.org/|g' \
            pnpm-lock.yaml

      # pnpm-workspace.yaml excludes non-Linux native binaries.
      # The Mac build needs darwin variants; strip the exclusions.
      # CI-local only.
      - name: Strip Linux-only platform overrides
        script: |
          perl -i -pe 's/: "-"$/: "*"/g' pnpm-workspace.yaml

      # ── Install ───────────────────────────────────────────────────────────────
      - name: Install dependencies
        script: pnpm install

      # ── Build ─────────────────────────────────────────────────────────────────
      # Build shared workspace libs (@workspace/api-client-react, etc.) BEFORE
      # the Vite build. TypeScript project references fail if lib outputs are
      # missing.
      - name: Build workspace libs
        script: pnpm run typecheck:libs

      # Build the MeNotMe web app.
      #   BASE_PATH=./  → relative asset paths for capacitor://localhost
      #   PORT=3000     → satisfies the vite.config.ts PORT guard
      #   VITE_* vars   → injected from the environment block above
      - name: Vite build
        working_directory: artifacts/menotme
        script: BASE_PATH=./ PORT=3000 pnpm run build

      # ── Capacitor native project ──────────────────────────────────────────────
      # Option A: generate the Xcode project on the cloud Mac each build.
      - name: Add iOS platform
        working_directory: artifacts/menotme
        script: npx cap add ios

      # Sync the web assets from dist/public into ios/.
      - name: Capacitor copy
        working_directory: artifacts/menotme
        script: npx cap copy ios

      # Generate all required icon and splash sizes from source PNGs in
      # artifacts/menotme/assets/ (icon-only.png, splash.png, splash-dark.png).
      - name: Generate icons and splash
        working_directory: artifacts/menotme
        script: npx @capacitor/assets generate

      # ── Code signing ──────────────────────────────────────────────────────────
      # Create a fresh macOS keychain for the signing certificate.
      - name: Initialize keychain
        script: keychain initialize

      # Download the App Store distribution certificate and provisioning profile
      # via the App Store Connect API key. --create mints them if absent.
      - name: Fetch signing files
        script: |
          app-store-connect fetch-signing-files com.menotme.app \
            --type IOS_APP_STORE \
            --create

      # Import the downloaded certificate into the keychain.
      - name: Add certificates to keychain
        script: keychain add-certificates

      # Inject the provisioning profile into the Xcode project so Xcode uses it
      # automatically during the build.
      - name: Apply provisioning profiles
        script: xcode-project use-profiles

      # ── Build IPA ─────────────────────────────────────────────────────────────
      # Archive and export a signed IPA in one step.
      # The --workspace path includes the monorepo artifacts/menotme/ prefix.
      - name: Build IPA
        script: |
          xcode-project build-ipa \
            --workspace artifacts/menotme/ios/App/App.xcworkspace \
            --scheme App

    # Collect build artifacts for download even if publishing fails.
    artifacts:
      - build/ios/ipa/*.ipa
      - /tmp/xcodebuild_logs/*.log
      - $HOME/Library/Logs/gym/*.log

    # Publish to TestFlight using the app_store_connect integration.
    # Change submit_to_app_store: true when ready to submit for App Store review.
    publishing:
      app_store_connect:
        auth: integration
        submit_to_testflight: true
        submit_to_app_store: false
```

### Values that need editing after first commit

| Variable | Where to find it |
|----------|-----------------|
| `APP_STORE_APPLE_ID` | App Store Connect → App Information (numeric ID) |
| `VITE_PROD_API_ORIGIN` | Your published Replit deployment URL (Deployments tab) |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk dashboard → API Keys (`pk_live_…` or `pk_test_…`) |
| `menotme_app_store` | The integration name from Step 5 — update both `integrations` and `publishing` if you chose a different name |

---

## Backend note

The native app is a thin client of the **live Replit deployment**. Keep it
**published** at all times.

If the published domain ever changes:

1. Update `VITE_PROD_API_ORIGIN` in `codemagic.yaml`
2. Trigger a new Codemagic build (the constant is baked into the JS bundle at
   build time)

---

## App Review checklist

### App Privacy

Declare the data MeNotMe collects in App Store Connect → App Privacy:

| Data type        | How it is used                             |
|------------------|--------------------------------------------|
| Name             | Clerk account (user-provided at sign-up)   |
| Email address    | Clerk account + auth verification emails   |
| Gameplay history | Stored in `localStorage` on-device         |
| Payment info     | Not collected unless the shop is surfaced in the native app |

### Screenshots

Take screenshots in TestFlight on a real iPhone or in Xcode Simulator:

- **6.7" display** (iPhone 16 Pro Max / 15 Plus) — required
- **6.5" display** (iPhone 14 Plus / 13 Pro Max) — required

### Required listing fields

- **Support URL** — a reachable page or `mailto:` link (Apple blocks without one)
- **Privacy Policy URL** — a reachable privacy policy page (Apple blocks without
  one — add a `/privacy` page to the MeNotMe deployment if one doesn't exist)
- **Age rating** — complete the questionnaire (should rate 4+)

### App Review notes (demo credentials)

Create a demo account before submitting:

```
Demo email:    demo@menotme.com
Demo password: <the password you set>
```

Note for reviewer: "MeNotMe is a daily mindset game. Sign in with the demo
account to see the full experience including cloud save and weekly streaks."

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `PORT environment variable is required` | `PORT` not passed to build | Add `PORT=3000` |
| `BASE_PATH environment variable is required` | `BASE_PATH` not passed | Add `BASE_PATH=./` |
| `Cannot find module '@workspace/api-client-react'` | Libs not built first | Run `pnpm run typecheck:libs` before Vite |
| pnpm install 404s or hangs | Lockfile still points to Replit proxy | Confirm the `perl` registry rewrite ran before `pnpm install` |
| esbuild native binary not found | Darwin overrides not stripped | Confirm the `perl -pe 's/: "-"$/: "*"/'` step ran before `pnpm install` |
| `No bundle ID found` during signing | App ID not registered | Register `com.menotme.app` at developer.apple.com/account/resources/identifiers |
| API calls fail silently in TestFlight | `BASE` resolves to `capacitor://localhost` | Confirm `isNativeShell` / `VITE_PROD_API_ORIGIN` patch applied in `cloud.ts` |
| Clerk sign-in fails in TestFlight | Proxy URL resolves to `capacitor://localhost` | Confirm `clerkProxyUrl = undefined` in native shell (same patch) |
| CORS errors from API calls | API not accepting native origins | Check `app.ts` CORS config and republish |
| White screen on launch | `webDir` wrong or Vite build missing | Confirm `"webDir": "dist/public"` in `capacitor.config.json` |
| IPA not in artifacts | `build-ipa` step failed | Check `$HOME/Library/Logs/gym/*.log` in Codemagic artifacts |
