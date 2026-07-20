/**
 * GFHF Firebase Configuration — Centralized
 * Re-exports from firebase.js for convenience.
 * All Firebase services are initialized once in firebase.js.
 */

import { app, analytics, auth, db } from "./firebase.js";

export { app, analytics, auth, db };
