/**
 * GFHF Shared Wallet Module
 * Core wallet functions: balance management, Paystack funding, transaction logging.
 * Import this module from dashboard.js, community.js, donate.js, etc.
 */

import { auth, db } from "./firebase.js";
import {
  doc, getDoc, setDoc, updateDoc, addDoc, collection, query, where, orderBy, onSnapshot,
  serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ===== PAYSTACK CONFIG =====
// Replace with your actual Paystack public key
export const PAYSTACK_PUBLIC_KEY = "YOUR_PAYSTACK_PUBLIC_KEY";

// ===== DB GUARD =====
export function guardDb() {
  if (!db) {
    console.warn("Firestore (db) is not initialized.");
    return false;
  }
  return true;
}

// ===== CURRENCY FORMATTING =====
export function formatCurrency(amount) {
  const num = typeof amount === 'number' ? amount : parseFloat(amount) || 0;
  return `₦${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ===== BALANCE VISIBILITY TOGGLE (localStorage) =====
const BALANCE_VIS_KEY = 'gfhf_balance_visible';

export function getBalanceVisible() {
  try {
    const val = localStorage.getItem(BALANCE_VIS_KEY);
    return val === null ? true : val === 'true';
  } catch { return true; }
}

export function setBalanceVisible(visible) {
  try { localStorage.setItem(BALANCE_VIS_KEY, visible ? 'true' : 'false'); } catch {}
}

// ===== LOAD WALLET BALANCE =====
export async function loadWalletBalance(userId) {
  if (!userId || !guardDb()) return 0;
  try {
    const snap = await getDoc(doc(db, 'users', userId));
    const data = snap.exists() ? snap.data() : {};
    return data.walletBalance || 0;
  } catch (err) {
    console.warn('Could not load wallet balance:', err);
    return 0;
  }
}

// ===== CREDIT WALLET (Atomic increment) =====
/**
 * Credit a user's wallet balance atomically and log a credit transaction.
 * @param {string} userId - Firestore user ID
 * @param {number} amount - Amount to credit (in NGN)
 * @param {object} options - { description, reference }
 * @returns {Promise<{success: boolean, newBalance: number, error?: string}>}
 */
export async function creditWallet(userId, amount, options = {}) {
  if (!userId || !amount || amount <= 0) {
    return { success: false, newBalance: 0, error: "Invalid userId or amount." };
  }
  if (!guardDb()) {
    return { success: false, newBalance: 0, error: "Database unavailable." };
  }

  try {
    // ATOMIC: increment balance using FieldValue.increment()
    const userRef = doc(db, "users", userId);
    await updateDoc(userRef, {
      walletBalance: increment(amount)
    });

    // Log the credit transaction
    try {
      await addDoc(collection(db, "wallet_transactions"), {
        userId: userId,
        type: "credit",
        amount: amount,
        description: options.description || "Wallet credit",
        reference: options.reference || "WALLET-CREDIT-" + Date.now(),
        status: "Successful",
        createdAt: serverTimestamp()
      });
    } catch (txErr) {
      console.warn("Could not log credit transaction:", txErr);
    }

    // Read back the new balance
    const snap = await getDoc(userRef);
    const newBalance = snap.exists() ? (snap.data().walletBalance || 0) : amount;

    return { success: true, newBalance };
  } catch (err) {
    console.error("creditWallet error:", err);
    return { success: false, newBalance: 0, error: err.message || "Unknown error." };
  }
}

// ===== DEDUCT FROM WALLET (Atomic decrement) =====
/**
 * Deduct an amount from the user's wallet balance atomically.
 * Checks sufficient balance before deducting.
 * @param {string} userId - Firestore user ID
 * @param {number} amount - Amount to deduct (in NGN)
 * @param {object} options - { description, reference, redirectUrl }
 * @returns {Promise<{success: boolean, newBalance: number, error?: string}>}
 */
export async function deductFromWallet(userId, amount, options = {}) {
  if (!userId || !amount || amount <= 0) {
    return { success: false, newBalance: 0, error: "Invalid userId or amount." };
  }
  if (!guardDb()) {
    return { success: false, newBalance: 0, error: "Database unavailable." };
  }

  try {
    const userRef = doc(db, "users", userId);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      return { success: false, newBalance: 0, error: "User profile not found." };
    }

    const currentBalance = snap.data().walletBalance || 0;

    if (currentBalance < amount) {
      return {
        success: false,
        newBalance: currentBalance,
        error: `Insufficient balance. You have ${formatCurrency(currentBalance)} but need ${formatCurrency(amount)}.`
      };
    }

    // ATOMIC: decrement balance using FieldValue.increment(-amount)
    await updateDoc(userRef, {
      walletBalance: increment(-amount)
    });

    // Log the debit transaction
    try {
      await addDoc(collection(db, "wallet_transactions"), {
        userId: userId,
        type: "debit",
        amount: amount,
        description: options.description || "Wallet debit",
        reference: options.reference || "WALLET-DEBIT-" + Date.now(),
        status: "Successful",
        createdAt: serverTimestamp()
      });
    } catch (txErr) {
      console.warn("Could not log debit transaction:", txErr);
    }

    const newBalance = currentBalance - amount;
    return { success: true, newBalance };
  } catch (err) {
    console.error("deductFromWallet error:", err);
    return { success: false, newBalance: 0, error: err.message || "Unknown error." };
  }
}

// ===== RENDER TRANSACTION HISTORY (Real-time) =====
/**
 * Set up a real-time listener on wallet_transactions for a given userId.
 * Calls renderFn with the sorted transactions array.
 * @param {string} userId - Firestore user ID
 * @param {function} renderFn - Callback receiving (transactions[])
 * @returns {function} Unsubscribe function
 */
export function listenToTransactions(userId, renderFn) {
  if (!userId || !guardDb()) {
    if (renderFn) renderFn([]);
    return () => {};
  }

  try {
    const q = query(
      collection(db, 'wallet_transactions'),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const transactions = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      }));
      if (renderFn) renderFn(transactions);
    }, (err) => {
      console.error('Transaction history error:', err);
      // Fallback: query without orderBy
      try {
        const fallbackQ = query(
          collection(db, 'wallet_transactions'),
          where('userId', '==', userId)
        );
        const fallbackUnsub = onSnapshot(fallbackQ, (snapshot) => {
          const transactions = snapshot.docs.map(docSnap => ({
            id: docSnap.id,
            ...docSnap.data()
          }));
          if (renderFn) renderFn(transactions);
        }, () => {});
        return fallbackUnsub;
      } catch (err2) {
        console.error('Fallback transaction query also failed:', err2);
        if (renderFn) renderFn([]);
      }
    });

    return unsubscribe;
  } catch (err) {
    console.warn('Transactions query error (may need composite index):', err);
    if (renderFn) renderFn([]);
    return () => {};
  }
}

// ===== TRANSACTION HISTORY HTML RENDERER =====
/**
 * Render transactions array into a container element with a table.
 * @param {HTMLElement} container - The container element
 * @param {Array} transactions - Array of transaction objects
 */
export function renderTransactionHistoryTable(container, transactions) {
  if (!container) return;

  if (!transactions || transactions.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:24px 8px;color:#94a3b8;">
        <div style="font-size:48px;margin-bottom:10px;">📭</div>
        <p style="font-size:15px;font-weight:600;color:#64748b;margin:0 0 4px;">No transactions yet</p>
        <p style="font-size:13px;margin:0;">Your donation and top-up activity will appear here.</p>
      </div>`;
    return;
  }

  const sorted = [...transactions].sort((a, b) => {
    const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.createdAt || 0).getTime();
    const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.createdAt || 0).getTime();
    return tb - ta;
  });

  container.innerHTML = `
    <div style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0;">
            <th style="padding:8px 10px;text-align:left;font-weight:700;color:#475569;">Date &amp; Time</th>
            <th style="padding:8px 10px;text-align:left;font-weight:700;color:#475569;">Description</th>
            <th style="padding:8px 10px;text-align:left;font-weight:700;color:#475569;">Reference</th>
            <th style="padding:8px 10px;text-align:right;font-weight:700;color:#475569;">Amount</th>
            <th style="padding:8px 10px;text-align:center;font-weight:700;color:#475569;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map(tx => {
            const timestamp = tx.createdAt?.toMillis ? tx.createdAt.toMillis() : (typeof tx.createdAt === 'string' ? new Date(tx.createdAt).getTime() : Date.now());
            const dateStr = new Date(timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            const timeStr = new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            const isCredit = tx.type === 'credit' || tx.type === 'topup' || tx.amount > 0;
            const absAmount = Math.abs(tx.amount || 0);
            const amountDisplay = isCredit
              ? `<span style="color:#22c55e;font-weight:700;">+${formatCurrency(absAmount)}</span>`
              : `<span style="color:#ef4444;font-weight:700;">-${formatCurrency(absAmount)}</span>`;
            const status = tx.status || 'Successful';
            const statusColor = status === 'Successful' || status === 'Completed' ? '#22c55e' : '#f59e0b';
            return `<tr style="border-bottom:1px solid #f1f5f9;">
              <td style="padding:8px 10px;white-space:nowrap;color:#475569;">${dateStr}<br><span style="font-size:11px;color:#94a3b8;">${timeStr}</span></td>
              <td style="padding:8px 10px;color:#14213d;">${tx.description || 'Transaction'}</td>
              <td style="padding:8px 10px;color:#64748b;font-family:monospace;font-size:11px;">${tx.reference || tx.ref || '—'}</td>
              <td style="padding:8px 10px;text-align:right;white-space:nowrap;">${amountDisplay}</td>
              <td style="padding:8px 10px;text-align:center;">
                <span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:11px;font-weight:700;background:${statusColor}16;color:${statusColor};">${status}</span>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <p style="font-size:12px;color:#94a3b8;text-align:center;margin:10px 0 0;">Showing ${sorted.length} transaction(s)</p>
  `;
}

// ===== FUND WALLET MODAL HTML =====
/**
 * Returns the HTML string for a reusable Fund Wallet modal (Paystack).
 * Include this in any page that needs wallet funding.
 */
export function getFundWalletModalHTML() {
  return `
  <div id="fundWalletModal" class="fb-modal" hidden>
    <div class="fb-modal-overlay" id="fundWalletModalOverlay"></div>
    <div class="fb-modal-card" style="max-width:440px;">
      <div class="fb-modal-header">
        <h3>💰 Fund Wallet</h3>
        <button class="fb-modal-close" id="fundWalletModalClose">&times;</button>
      </div>
      <div class="create-post-modal-body">
        <p style="font-size:14px;color:#475569;margin:0 0 12px;">Enter the amount you want to add to your wallet. Payment is processed securely via Paystack.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          <button type="button" class="donation-preset-btn fund-preset active" data-amount="10">₦1,000</button>
          <button type="button" class="donation-preset-btn fund-preset" data-amount="25">₦2,500</button>
          <button type="button" class="donation-preset-btn fund-preset" data-amount="50">₦5,000</button>
          <button type="button" class="donation-preset-btn fund-preset" data-amount="100">₦10,000</button>
        </div>
        <div class="donation-custom-wrap" style="margin-bottom:12px;">
          <input type="number" id="fundCustomAmount" class="donation-custom-input" placeholder="Custom amount (₦)" min="100">
        </div>
        <div id="fundWalletStatus" class="message"></div>
        <button type="button" id="fundWalletPayBtn" class="btn" style="width:100%;margin:0;">💳 Pay with Paystack</button>
      </div>
    </div>
  </div>`;
}

// ===== INIT FUND WALLET MODAL =====
/**
 * Initialize the Fund Wallet modal event handlers.
 * Call this after the modal HTML is in the DOM.
 * @param {Function} onSuccess - Optional callback after successful funding (receives {amount, reference})
 */
export function initFundWalletModal(onSuccess) {
  let fundSelectedAmount = 10;

  const fundWalletModal = document.getElementById("fundWalletModal");
  const fundWalletModalOverlay = document.getElementById("fundWalletModalOverlay");
  const fundWalletModalClose = document.getElementById("fundWalletModalClose");
  const fundWalletBtns = document.querySelectorAll(".fund-wallet-trigger-btn");
  const fundCustomAmount = document.getElementById("fundCustomAmount");
  const fundPresetBtns = document.querySelectorAll(".fund-preset");
  const fundWalletPayBtn = document.getElementById("fundWalletPayBtn");
  const fundWalletStatus = document.getElementById("fundWalletStatus");

  if (!fundWalletModal) return;

  function showStatus(msg, type) {
    if (!fundWalletStatus) return;
    fundWalletStatus.textContent = msg;
    fundWalletStatus.className = `message ${type}`;
  }

  function openModal() {
    fundSelectedAmount = 10;
    fundWalletModal.hidden = false;
    if (fundCustomAmount) fundCustomAmount.value = "";
    fundPresetBtns.forEach((b) => b.classList.remove("active"));
    if (fundPresetBtns[0]) fundPresetBtns[0].classList.add("active");
    showStatus("", "success");
  }

  function closeModal() {
    if (fundWalletModal) fundWalletModal.hidden = true;
  }

  // Wire up all trigger buttons with class "fund-wallet-trigger-btn"
  fundWalletBtns.forEach((btn) => btn.addEventListener("click", openModal));

  if (fundWalletModalOverlay) fundWalletModalOverlay.addEventListener("click", closeModal);
  if (fundWalletModalClose) fundWalletModalClose.addEventListener("click", closeModal);

  // Fund preset buttons
  fundPresetBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      fundPresetBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      fundSelectedAmount = parseFloat(btn.dataset.amount);
      if (fundCustomAmount) fundCustomAmount.value = "";
    });
  });

  if (fundCustomAmount) {
    fundCustomAmount.addEventListener("input", () => {
      fundPresetBtns.forEach((b) => b.classList.remove("active"));
    });
  }

  function getFundAmount() {
    const customVal = fundCustomAmount ? parseFloat(fundCustomAmount.value) : NaN;
    if (customVal && customVal > 0) return customVal;
    return fundSelectedAmount;
  }

  // Process Paystack payment
  if (fundWalletPayBtn) {
    fundWalletPayBtn.addEventListener("click", () => {
      const user = auth.currentUser;
      if (!user) {
        showStatus("Please sign in first.", "error");
        return;
      }

      const amount = getFundAmount();
      if (amount < 1) {
        showStatus("Amount must be at least ₦100.", "error");
        return;
      }

      if (typeof PaystackPop === "undefined") {
        showStatus("Paystack is not loaded. Please refresh.", "error");
        return;
      }

      const email = user.email || "user@gfhf.com";
      const amountInKobo = Math.round(amount * 100);

      const handler = PaystackPop.setup({
        key: PAYSTACK_PUBLIC_KEY,
        email: email,
        amount: amountInKobo,
        currency: "NGN",
        ref: "GFHF-FUND-" + Math.floor(Math.random() * 1000000000) + "-" + Date.now(),
        metadata: {
          custom_fields: [
            {
              display_name: "User ID",
              variable_name: "user_id",
              value: user.uid
            }
          ]
        },
        callback: async function (response) {
          if (!guardDb()) {
            showStatus("Database unavailable. Please contact support.", "error");
            return;
          }
          try {
            const result = await creditWallet(user.uid, amount, {
              description: "Wallet funding via Paystack",
              reference: response.reference
            });

            if (result.success) {
              showStatus(
                `✅ Wallet funded successfully! ${formatCurrency(amount)} added. Reference: ${response.reference}`,
                "success"
              );

              // Call success callback
              if (onSuccess) {
                onSuccess({ amount, reference: response.reference });
              }

              // Close modal after 2 seconds
              setTimeout(closeModal, 2000);
            } else {
              showStatus("Payment succeeded but wallet credit failed. Contact support.", "error");
            }
          } catch (err) {
            console.error("Fund wallet credit error:", err);
            showStatus("Payment succeeded but wallet credit failed. Contact support.", "error");
          }
        },
        onClose: function () {
          showStatus("Payment window was closed.", "error");
        }
      });

      handler.openIframe();
    });
  }

  return { openModal, closeModal };
}

