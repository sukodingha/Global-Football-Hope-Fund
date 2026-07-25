/**
 * GFHF Hope Points (HP) Reward System (SCALED V2)
 * Manages daily login bonuses, action-based HP earning, and HP-to-wallet redemption.
 * Firestore fields on users/{uid}: rewardPoints, currentStreak, lastLoginDate
 * Firestore subcollection: users/{uid}/point_history/{docId}
 *
 * SCALED CONVERSION: 5.0 HP = ₦500 / $5.00 Wallet Credit
 * 1 HP = ₦100 / $1.00 value
 */

import { auth, db } from "./firebase.js";
import {
  doc, getDoc, setDoc, updateDoc, addDoc, collection, query, where,
  orderBy, onSnapshot, serverTimestamp, increment, getDocs, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ===== CONSTANTS (Scaled V2) =====
export const DAILY_LOGIN_BONUS = 0.1;       // +0.1 HP for daily login
export const POST_CREATION_BONUS = 0.05;    // +0.05 HP for creating a post
export const COMMENT_MESSAGE_BONUS = 0.02;  // +0.02 HP for comment/message
export const WALLET_TOPUP_RATE = 0.01;      // +0.01 HP per ₦100 or $1
export const DONATION_RATE = 0.02;          // +0.02 HP per ₦100 or $1
export const ACCOUNT_CREATION_BONUS = 0.5;  // +0.5 HP on account creation
export const HP_PER_DOLLAR = 1;             // 1 HP = $1 for conversion context
export const REDEMPTION_RATE = 5.0;         // 5.0 HP = 1 unit
export const CURRENCY_PER_REDEMPTION = 1;   // ₦500 or $5.00 per 5 HP
export const HP_TO_WALLET_MULTIPLIER = 100; // Each HP redeemed = 100 currency units (₦100/$1)

// ===== DB GUARD =====
function guardDb() {
  if (!db) {
    console.warn("Firestore (db) is not initialized.");
    return false;
  }
  return true;
}

// ===== GET TODAY'S DATE STRING (YYYY-MM-DD) =====
function getTodayDateStr() {
  return new Date().toISOString().split('T')[0];
}

// ===== LOAD REWARD DATA =====
/**
 * Fetch reward points and streak for a user.
 * @param {string} userId
 * @returns {Promise<{rewardPoints: number, currentStreak: number, lastLoginDate: string|null}>}
 */
export async function loadRewardData(userId) {
  if (!userId || !guardDb()) return { rewardPoints: 0, currentStreak: 0, lastLoginDate: null };
  try {
    const snap = await getDoc(doc(db, 'users', userId));
    const data = snap.exists() ? snap.data() : {};
    return {
      rewardPoints: data.rewardPoints || 0,
      currentStreak: data.currentStreak || 0,
      lastLoginDate: data.lastLoginDate || null
    };
  } catch (err) {
    console.warn('Could not load reward data:', err);
    return { rewardPoints: 0, currentStreak: 0, lastLoginDate: null };
  }
}

// ===== DAILY LOGIN BONUS =====
/**
 * Check if the user has logged in today. If not, award daily login bonus HP
 * and update streak. Call this on app startup / auth state change.
 * @param {string} userId
 * @returns {Promise<{awarded: boolean, points: number, streak: number, message: string}>}
 */
export async function checkDailyLoginBonus(userId) {
  if (!userId || !guardDb()) {
    return { awarded: false, points: 0, streak: 0, message: "Database unavailable." };
  }

  try {
    const userRef = doc(db, "users", userId);
    const snap = await getDoc(userRef);
    const data = snap.exists() ? snap.data() : {};
    const lastLoginDate = data.lastLoginDate || null;
    const today = getTodayDateStr();
    const currentStreak = data.currentStreak || 0;

    // If already logged in today, no bonus
    if (lastLoginDate === today) {
      return {
        awarded: false,
        points: 0,
        streak: currentStreak,
        message: "Already claimed today's login bonus!"
      };
    }

    // Calculate streak
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    let newStreak = 1;
    if (lastLoginDate === yesterdayStr) {
      newStreak = currentStreak + 1;
    }

    // Update Firestore: increment rewardPoints, set lastLoginDate, set currentStreak
    await updateDoc(userRef, {
      rewardPoints: increment(DAILY_LOGIN_BONUS),
      currentStreak: newStreak,
      lastLoginDate: today
    });

    // Log in point_history
    try {
      await addDoc(collection(db, "point_history"), {
        userId: userId,
        points: DAILY_LOGIN_BONUS,
        type: "earned",
        reason: `Daily Login Bonus (Day ${newStreak})`,
        streak: newStreak,
        timestamp: serverTimestamp()
      });
    } catch (txErr) {
      console.warn("Could not log point history:", txErr);
    }

    return {
      awarded: true,
      points: DAILY_LOGIN_BONUS,
      streak: newStreak,
      message: `🎉 Daily login bonus: +${DAILY_LOGIN_BONUS} HP! 🔥 ${newStreak}-day streak!`
    };
  } catch (err) {
    console.error("Daily login bonus error:", err);
    return { awarded: false, points: 0, streak: 0, message: "Error checking login bonus." };
  }
}

// ===== ACTION BONUS (Fund wallet or Donate) =====
/**
 * Award HP based on an action (funding wallet or donating).
 * Formula: points = floor(amount * HP_PER_DOLLAR / 100)  (1 HP per 1 cent equivalent)
 * @param {string} userId
 * @param {number} amount - Amount in currency units
 * @param {string} currency - Currency code (USD, NGN, etc.)
 * @param {string} action - 'fund' | 'donate'
 * @param {string} reference - Optional payment reference
 * @returns {Promise<{awarded: boolean, points: number, message: string}>}
 */
export async function awardActionBonus(userId, amount, currency = "USD", action = "fund", reference = "") {
  if (!userId || !amount || amount <= 0 || !guardDb()) {
    return { awarded: false, points: 0, message: "Invalid parameters." };
  }

  // Calculate HP: 100 HP per $1 or equivalent in NGN
  // For NGN, 100 HP per ₦500 (roughly $1 equivalent)
  let normalizedAmount = amount;
  if (currency === "NGN") {
    normalizedAmount = amount / 500; // ₦500 ≈ $1
  } else if (currency === "EUR") {
    normalizedAmount = amount * 1.05; // Approx EUR to USD
  } else if (currency === "GBP") {
    normalizedAmount = amount * 1.25; // Approx GBP to USD
  }
  
  const points = Math.max(1, Math.floor(normalizedAmount * HP_PER_DOLLAR));
  const actionLabel = action === "fund" ? "Wallet Funding" : "Donation";

  try {
    const userRef = doc(db, "users", userId);
    await updateDoc(userRef, {
      rewardPoints: increment(points)
    });

    // Log in point_history
    try {
      await addDoc(collection(db, "point_history"), {
        userId: userId,
        points: points,
        type: "earned",
        reason: `${actionLabel} Bonus (${currency} ${amount.toFixed(2)})`,
        action: action,
        amount: amount,
        currency: currency,
        reference: reference || "",
        timestamp: serverTimestamp()
      });
    } catch (txErr) {
      console.warn("Could not log point history:", txErr);
    }

    return {
      awarded: true,
      points: points,
      message: `✨ +${points} HP earned for ${actionLabel}!`
    };
  } catch (err) {
    console.error("Action bonus error:", err);
    return { awarded: false, points: 0, message: "Error awarding HP." };
  }
}

// ===== REDEEM HP FOR WALLET CREDIT =====
/**
 * Redeem HP for wallet credit. Deducts rewardPoints and increments walletBalance.
 * Uses Firestore increment() for atomicity.
 * @param {string} userId
 * @param {number} hpToRedeem - Amount of HP to redeem (must be multiple of REDEMPTION_RATE)
 * @param {string} currency - Target currency (USD or NGN)
 * @returns {Promise<{success: boolean, hpDeducted: number, walletCredited: number, error?: string}>}
 */
export async function redeemHPForWallet(userId, hpToRedeem, currency = "USD") {
  if (!userId || !hpToRedeem || hpToRedeem < REDEMPTION_RATE || !guardDb()) {
    return { success: false, hpDeducted: 0, walletCredited: 0, error: "Invalid parameters." };
  }

  // Must be a multiple of REDEMPTION_RATE
  if (hpToRedeem % REDEMPTION_RATE !== 0) {
    return {
      success: false, hpDeducted: 0, walletCredited: 0,
      error: `HP must be redeemed in multiples of ${REDEMPTION_RATE}.`
    };
  }

  try {
    const userRef = doc(db, "users", userId);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      return { success: false, hpDeducted: 0, walletCredited: 0, error: "User not found." };
    }

    const currentHP = snap.data().rewardPoints || 0;
    if (currentHP < hpToRedeem) {
      return {
        success: false, hpDeducted: 0, walletCredited: 0,
        error: `Insufficient HP. You have ${currentHP} HP but need ${hpToRedeem} HP.`
      };
    }

    const creditAmount = (hpToRedeem / REDEMPTION_RATE) * CURRENCY_PER_REDEMPTION;
    const walletField = `walletBalance${currency}`;

    // Atomic operations: deduct HP, credit wallet
    await updateDoc(userRef, {
      rewardPoints: increment(-hpToRedeem),
      [walletField]: increment(creditAmount)
    });

    // Log point_history (spent)
    try {
      await addDoc(collection(db, "point_history"), {
        userId: userId,
        points: hpToRedeem,
        type: "spent",
        reason: `Redeemed ${hpToRedeem} HP for ${currency} ${creditAmount.toFixed(2)} wallet credit`,
        action: "redemption",
        amount: creditAmount,
        currency: currency,
        timestamp: serverTimestamp()
      });
    } catch (txErr) {
      console.warn("Could not log point history:", txErr);
    }

    // Log wallet_transactions (credit)
    try {
      await addDoc(collection(db, "wallet_transactions"), {
        userId: userId,
        type: "credit",
        amount: creditAmount,
        currency: currency,
        gateway: "hp_redemption",
        description: `HP Redemption: ${hpToRedeem} HP → ${currency} ${creditAmount.toFixed(2)}`,
        reference: `HP-REDEEM-${currency}-${Date.now()}`,
        status: "Successful",
        createdAt: serverTimestamp()
      });
    } catch (txErr) {
      console.warn("Could not log wallet transaction:", txErr);
    }

    return {
      success: true,
      hpDeducted: hpToRedeem,
      walletCredited: creditAmount,
      message: `✅ Redeemed ${hpToRedeem} HP for ${currency} ${creditAmount.toFixed(2)}!`
    };
  } catch (err) {
    console.error("HP redemption error:", err);
    return { success: false, hpDeducted: 0, walletCredited: 0, error: err.message || "Redemption failed." };
  }
}

// ===== POINT HISTORY LISTENER (Real-time) =====
/**
 * Set up a real-time listener on point_history for a given userId.
 * @param {string} userId
 * @param {function} renderFn - Callback receiving (points[])
 * @returns {function} Unsubscribe function
 */
export function listenToPointHistory(userId, renderFn) {
  if (!userId || !guardDb()) {
    if (renderFn) renderFn([]);
    return () => {};
  }

  try {
    const q = query(
      collection(db, 'point_history'),
      where('userId', '==', userId),
      orderBy('timestamp', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const points = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      }));
      if (renderFn) renderFn(points);
    }, (err) => {
      console.error('Point history error:', err);
      if (renderFn) renderFn([]);
    });

    return unsubscribe;
  } catch (err) {
    console.warn('Point history query error:', err);
    if (renderFn) renderFn([]);
    return () => {};
  }
}

// ===== LOAD POINT HISTORY (one-time) =====
export async function loadPointHistory(userId, maxResults = 50) {
  if (!userId || !guardDb()) return [];
  try {
    const q = query(
      collection(db, 'point_history'),
      where('userId', '==', userId),
      orderBy('timestamp', 'desc'),
      limit(maxResults)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn('Could not load point history:', err);
    return [];
  }
}

// ===== GENERATE HP BADGE HTML =====
/**
 * Generate the HP badge HTML string for display under a username.
 * @param {number} rewardPoints - The user's reward points
 * @returns {string} HTML string
 */
export function getHPBadgeHTML(rewardPoints = 0) {
  const pts = typeof rewardPoints === 'number' ? rewardPoints : 0;
  return `<div class="user-hp-badge">
    <span class="hp-symbol">HP</span>◇◇ ${pts}
  </div>`;
}

// ===== FETCH USER HP (cached) =====
const userHPCache = {}; // uid -> { rewardPoints, lastFetch }

/**
 * Fetch a user's reward points from Firestore (with caching).
 * @param {string} uid
 * @returns {Promise<number>}
 */
export async function getUserHP(uid) {
  if (!uid) return 0;
  
  // Cache for 30 seconds
  const cached = userHPCache[uid];
  if (cached && (Date.now() - cached.lastFetch) < 30000) {
    return cached.rewardPoints;
  }
  
  try {
    const snap = await getDoc(doc(db, "users", uid));
    const data = snap.exists() ? snap.data() : {};
    const rp = data.rewardPoints || 0;
    userHPCache[uid] = { rewardPoints: rp, lastFetch: Date.now() };
    return rp;
  } catch {
    return 0;
  }
}

/**
 * Invalidate HP cache for a user.
 */
export function invalidateHPCache(uid) {
  delete userHPCache[uid];
}
