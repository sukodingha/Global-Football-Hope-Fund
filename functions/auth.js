// Authentication helper functions for Firebase Functions
const admin = require("firebase-admin");
const { HttpsError } = require("firebase-functions/v2/https");

const db = admin.firestore();

/**
 * Ensure user profile exists with default values on first sign-in.
 * Called from web/mobile auth handlers or from onCreate auth trigger.
 */
async function initializeUserProfile(uid, email, displayName) {
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  
  if (userSnap.exists) return { exists: true };
  
  const newProfile = {
    uid,
    email,
    displayName: displayName || email?.split("@")[0] || "Member",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    rewardPoints: 0,
    totalRewardsEarned: 0,
    walletBalance: 0.0,
    walletCurrency: "USD",
    moderationStatus: "active",
    profileComplete: false,
  };
  
  await userRef.set(newProfile);
  return { exists: false, created: true };
}

/**
 * Safely convert Hope Points to wallet currency.
 * 1 HP = 0.01 USD equivalent (or local currency)
 * Only callable by the user for their own profile, with transaction logging.
 */
async function convertHopePointsToWallet(uid, hpAmount, currency = "USD") {
  if (!uid || Number(hpAmount || 0) <= 0) {
    throw new HttpsError("invalid-argument", "Invalid HP conversion request.");
  }
  
  const conversionRate = 0.01; // 1 HP = 0.01 USD
  const usdAmount = hpAmount * conversionRate;
  
  try {
    const result = await db.runTransaction(async (transaction) => {
      const userRef = db.collection("users").doc(uid);
      const userSnap = await transaction.get(userRef);
      
      if (!userSnap.exists) throw new HttpsError("not-found", "User profile not found.");
      
      const currentHP = Number(userSnap.data().rewardPoints || 0);
      if (currentHP < hpAmount) {
        throw new HttpsError("failed-precondition", "Insufficient Hope Points for conversion.");
      }
      
      // Deduct HP and increment wallet
      transaction.update(userRef, {
        rewardPoints: admin.firestore.FieldValue.increment(-hpAmount),
        walletBalance: admin.firestore.FieldValue.increment(usdAmount),
        walletCurrency: currency,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      
      // Log transaction
      const transactionRef = db.collection("transactions").doc();
      transaction.set(transactionRef, {
        userId: uid,
        type: "hp_conversion",
        hpAmount,
        currencyAmount: usdAmount,
        currency,
        status: "completed",
        description: `Converted ${hpAmount} HP to wallet`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      
      return { success: true, usdAmount, transactionId: transactionRef.id };
    });
    return result;
  } catch (err) {
    console.error("HP conversion error:", err);
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("internal", "Conversion failed. Please try again.");
  }
}

/**
 * Check if a user is an admin (strict check).
 */
async function isAdminUser(uid) {
  const userSnap = await db.collection("users").doc(uid).get();
  return userSnap.exists && userSnap.data().adminRole === true;
}

module.exports = { initializeUserProfile, convertHopePointsToWallet, isAdminUser };
