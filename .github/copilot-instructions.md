# Copilot instructions for Global Football Hope Fund

## Project overview
This repository is a static front-end web app backed by Firebase, not a framework app. The main entry points are top-level HTML pages like `index.html` and the page files in `pages/`, with shared behavior in `js/` and Firebase access in `js/firebase-config.js`.

Use the existing vanilla JavaScript + ES module architecture. Do not introduce a React/Vue/Next.js structure or a build pipeline unless the repo explicitly adds one.

## Build, test, and validation commands
There is no package.json, no npm scripts, and no automated JS test/lint runner in this repository.

Use one of these local validation commands:
- `pwsh ./serve.ps1` to serve the app on http://localhost:8000
- `python -m http.server 8000`

Open the relevant page in a browser, then check the feature manually. For example:
- `http://localhost:8000/` for the home page
- `http://localhost:8000/pages/community.html` for the community page
- `http://localhost:8000/pages/predictions.html` for the prediction flow

There is no single-test command in this repo because there is no automated test framework configured.

## Key architecture
- `index.html` is the main landing page and loads shared scripts such as `js/auth.js`, `js/notifications.js`, and `js/home.js`.
- `pages/*.html` are page-specific screens, each with a matching JavaScript module in `js/`.
- `js/firebase-config.js` initializes Firebase and exports `auth` and `db`.
- `js/` contains the page logic for authentication, notifications, moderation, rewards, community features, home widgets, and predictions.
- `services/fixturesService.js` is the shared source of truth for match/fixture data. It caches API-Football responses, normalizes statuses (`scheduled`, `live`, `half_time`, `finished`, `postponed`), and exposes `getFixturesByDate`, `getFixturesByIds`, and `subscribeToFixtureUpdates`.
- The app is heavily driven by Firestore document reads/writes and DOM rendering instead of a component framework or state store.

## Conventions specific to this repo
- Keep changes in the existing vanilla JS + ES module style. Use `import`/`export` with relative paths, matching the current files.
- Preserve the project’s DOM-first patterns: render UI directly from Firestore data and shared service responses instead of introducing a separate app state layer.
- Keep Firebase/Firestore usage consistent with existing modules: `onAuthStateChanged`, `getDoc`, `getDocs`, `setDoc`, `updateDoc`, `query`, `where`, `collection`, and `serverTimestamp` are already used throughout the codebase.
- For fixture and prediction logic, keep match status normalization aligned with `services/fixturesService.js`; do not invent alternate status values.
- Maintain page-specific scripts and CSS selectors that already exist. Favor small, surgical edits over large refactors.
- This project uses a shared global stylesheet in `css/style.css`; prefer matching the existing style tokens and layout patterns when editing UI.
- Check the current page and scripts before adding new helper modules; the repo already splits concerns by page and shared service rather than by a framework feature folder pattern.

## Working from repo docs
- `README.md` describes the project as a Firebase-powered football community + prediction platform.
- `CONTRIBUTING.md` is the main contributor workflow guide and reinforces small, clear changes and preserving the existing project style.
- When changing user-facing behavior, prefer the same patterns already used in pages like `pages/community.html`, `pages/predictions.html`, and `index.html`.

## Practical guidance for future Copilot sessions
- If asked to add a feature, locate the specific page HTML plus the matching JS file before editing, then check shared modules used by that page.
- If the work touches football fixtures or prediction status, update the shared service and any consumers together so data stays consistent.
- Keep Firebase credentials and API keys in their existing config files; do not create new env/config systems unless the repo already uses them.
- Prefer preserving the current app architecture and not introducing backend tooling or package-based build steps.
