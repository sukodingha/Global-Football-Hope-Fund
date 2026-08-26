/**
 * Wallet Module - Secure Hope Points to Currency Conversion
 * All wallet operations are backend-authoritative via Firebase Functions
 */

import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { isUserAuthenticated, getCurrentUser } from "./auth-module.js";

const functions = getFunctions();

/**
 * Convert Hope Points (HP) to wallet currency
 * 1 HP = 0.01 USD equivalent
 * Backend verifies user balance and logs transaction
 *
 * @param {number} hpAmount - HP to convert (must be positive integer)
 * @param {string} currency - Target currency code (default: 'USD')
 * @returns {Promise<{success: boolean, usdAmount: number, transactionId: string}>}
 */
export async function convertHopePointsToWallet(hpAmount, currency = "USD") {
  if (!isUserAuthenticated()) {
    throw new Error("Must be signed in to convert Hope Points.");
  }

  if (!Number.isInteger(hpAmount) || hpAmount <= 0) {
    throw new Error("HP amount must be a positive integer.");
  }

  if (hpAmount > 10000) {
    throw new Error("Conversion limit is 10,000 HP per request.");
  }

  try {
    const convertHP = httpsCallable(functions, "convertHopePointsToWallet");
    const result = await convertHP({
      hpAmount,
      currency,
    });

    console.log("Conversion successful:", result.data);
    return result.data;
  } catch (err) {
    console.error("Conversion error:", err);
    
    if (err.code === "invalid-argument") {
      throw new Error("Invalid conversion request. Please check the amount.");
    }
    if (err.code === "failed-precondition") {
      throw new Error("Insufficient Hope Points. Please check your balance.");
    }
    if (err.code === "unauthenticated") {
      throw new Error("Authentication required. Please sign in again.");
    }
    
    throw new Error(err.message || "Conversion failed. Please try again.");
  }
}

/**
 * Get user's transaction history
 * Users can only view their own transactions
 *
 * @returns {Promise<Array>} Array of transaction objects
 */
export async function getUserTransactions() {
  if (!isUserAuthenticated()) {
    throw new Error("Must be signed in to view transactions.");
  }

  try {
    const getTransactions = httpsCallable(functions, "getUserTransactions");
    const result = await getTransactions();

    console.log("Transactions retrieved:", result.data);
    return result.data.transactions || [];
  } catch (err) {
    console.error("Transaction retrieval error:", err);
    throw new Error(err.message || "Failed to retrieve transactions.");
  }
}

/**
 * Display user-friendly error for wallet operations
 */
export function getWalletErrorMessage(code, fallback = "Wallet operation failed") {
  const messages = {
    "invalid-argument": "Invalid operation. Please check your input.",
    "failed-precondition": "Operation cannot be completed at this time.",
    "resource-exhausted": "You've reached a limit. Please try again later.",
    "unauthenticated": "Please sign in to use wallet features.",
    "permission-denied": "You don't have permission for this operation.",
    "internal": "Server error. Please try again later.",
  };
  
  return messages[code] || fallback;
}

/**
 * Format currency for display
 */
export function formatCurrency(amount, currency = "USD") {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  });
  return formatter.format(amount);
}

/**
 * Format HP for display with icon
 */
export function formatHP(amount) {
  return `${amount} 🎯 HP`;
}

/**
 * Calculate conversion preview
 * 1 HP = 0.01 USD
 */
export function calculateConversionPreview(hpAmount) {
  const rate = 0.01;
  const usdAmount = hpAmount * rate;
  return {
    hpAmount,
    usdAmount,
    formatted: `${formatHP(hpAmount)} → ${formatCurrency(usdAmount)}`,
  };
}

/**
 * Example usage in a web form:
 *
 * HTML:
 * <input type="number" id="hpInput" min="1" max="10000" placeholder="Enter HP amount">
 * <button id="convertBtn">Convert to Wallet</button>
 * <div id="result"></div>
 *
 * JavaScript:
 * document.getElementById('convertBtn').onclick = async () => {
 *   const hpAmount = parseInt(document.getElementById('hpInput').value);
 *   try {
 *     const result = await convertHopePointsToWallet(hpAmount, 'USD');
 *     document.getElementById('result').innerHTML = `
 *       <p>✓ Conversion successful!</p>
 *       <p>Converted: ${result.hpAmount} HP to ${result.usdAmount} USD</p>
 *       <p>Transaction ID: ${result.transactionId}</p>
 *     `;
 *   } catch (err) {
 *     document.getElementById('result').innerHTML = `<p style="color:red;">Error: ${err.message}</p>`;
 *   }
 * };
 */
