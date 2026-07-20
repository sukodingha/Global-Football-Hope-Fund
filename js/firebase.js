/**
 * GFHF Firebase Re-export Module
 * Re-exports from firebase-config.js for backward compatibility.
 * New imports should go directly to ./firebase-config.js
 */

import { app, analytics, auth, db } from "./firebase-config.js";

export { app, analytics, auth, db };

