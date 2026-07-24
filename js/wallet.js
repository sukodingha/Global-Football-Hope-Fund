/**
 * GFHF Multi-Currency Wallet Module
 * Supports USD, NGN, EUR, GBP balances with Paystack (NGN) and Stripe (USD/EUR/GBP) gateways.
 * Firestore fields: walletBalanceUSD, walletBalanceNGN, walletBalanceEUR, walletBalanceGBP, preferredCurrency
 * wallet_transactions schema: { userId, amount, currency, gateway, type, description, reference, status, createdAt }
 */

import { auth, db } from "./firebase.js";
import {
  doc, getDoc, setDoc, updateDoc, addDoc, collection, query, where, orderBy, onSnapshot,
  serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ===== PAYSTACK & STRIPE CONFIG =====
export const PAYSTACK_PUBLIC_KEY = "YOUR_PAYSTACK_PUBLIC_KEY";
export const STRIPE_PUBLISHABLE_KEY = "YOUR_STRIPE_PUBLISHABLE_KEY";

// ===== SUPPORTED CURRENCIES =====
export const CURRENCIES = {
  USD: { symbol: "$", label: "US Dollar", flag: "🇺🇸", locale: "en-US", gateways: ["stripe"], decimals: 2, minAmount: 1 },
  NGN: { symbol: "₦", label: "Nigerian Naira", flag: "🇳🇬", locale: "en-NG", gateways: ["paystack"], decimals: 2, minAmount: 100 },
  EUR: { symbol: "€", label: "Euro", flag: "🇪🇺", locale: "de-DE", gateways: ["stripe"], decimals: 2, minAmount: 1 },
  GBP: { symbol: "£", label: "British Pound", flag: "🇬🇧", locale: "en-GB", gateways: ["stripe"], decimals: 2, minAmount: 1 }
};

export const CURRENCY_KEYS = Object.keys(CURRENCIES);

/** Map currency code to Firestore field name */
export function currencyField(currency) {
  return `walletBalance${currency}`;
}

/** Get the gateway for a currency: 'paystack' or 'stripe' */
export function getGatewayForCurrency(currency) {
  const info = CURRENCIES[currency];
  if (!info) return "stripe";
  return info.gateways[0] || "stripe";
}

// ===== DB GUARD =====
export function guardDb() {
  if (!db) {
    console.warn("Firestore (db) is not initialized.");
    return false;
  }
  return true;
}

// ===== CURRENCY FORMATTING =====
export function formatCurrency(amount, currency = "USD") {
  const num = typeof amount === 'number' ? amount : parseFloat(amount) || 0;
  const info = CURRENCIES[currency] || CURRENCIES.USD;
  try {
    return new Intl.NumberFormat(info.locale, {
      style: "currency",
      currency: currency,
      minimumFractionDigits: info.decimals,
      maximumFractionDigits: info.decimals
    }).format(num);
  } catch {
    return `${info.symbol}${num.toLocaleString("en-US", { minimumFractionDigits: info.decimals })}`;
  }
}

/** Return a masked balance string for privacy toggle, e.g. "$••••••" or "₦••••••" */
export function getMaskedBalance(currency = "USD") {
  const info = CURRENCIES[currency] || CURRENCIES.USD;
  return `${info.symbol}••••••`;
}

// ===== PREFERRED CURRENCY =====
const PREF_CURRENCY_KEY = "gfhf_preferred_currency";

export function getPreferredCurrency() {
  try {
    const val = localStorage.getItem(PREF_CURRENCY_KEY);
    if (val && CURRENCIES[val]) return val;
    // Auto-detect based on user locale
    try {
      const lang = navigator.language || "en-US";
      if (lang.startsWith("en-NG") || lang.startsWith("ha") || lang.startsWith("ig") || lang.startsWith("yo")) return "NGN";
      if (lang.startsWith("de") || lang.startsWith("fr") || lang.startsWith("it") || lang.startsWith("es")) return "EUR";
      if (lang.startsWith("en-GB")) return "GBP";
    } catch {}
    return "USD";
  } catch { return "USD"; }
}

export function setPreferredCurrency(currency) {
  if (!CURRENCIES[currency]) currency = "USD";
  try { localStorage.setItem(PREF_CURRENCY_KEY, currency); } catch {}
}

/** Save preferredCurrency to Firestore user doc */
export async function savePreferredCurrencyToFirestore(userId, currency) {
  if (!userId || !guardDb()) return;
  try {
    await setDoc(doc(db, "users", userId), { preferredCurrency: currency }, { merge: true });
  } catch (err) {
    console.warn("Could not save preferredCurrency:", err);
  }
}

// ===== BALANCE VISIBILITY TOGGLE (localStorage) =====
const BALANCE_VIS_KEY = 'hideWalletBalance';

export function getBalanceVisible() {
  try {
    const val = localStorage.getItem(BALANCE_VIS_KEY);
    // hideWalletBalance: 'true' means hidden, 'false' means visible; default visible
    return val === 'true' ? false : true;
  } catch { return true; }
}

export function toggleBalanceVisibility() {
  const current = getBalanceVisible();
  const newVal = !current;
  setBalanceVisible(newVal);
  return newVal;
}

export function setBalanceVisible(visible) {
  // Store inverted: hideWalletBalance = 'true' means hidden, 'false' means visible
  try { localStorage.setItem(BALANCE_VIS_KEY, visible ? 'false' : 'true'); } catch {}
}

// ===== LOAD WALLET BALANCE (single currency) =====
export async function loadWalletBalance(userId, currency = "USD") {
  if (!userId || !guardDb()) return 0;
  try {
    const snap = await getDoc(doc(db, 'users', userId));
    const data = snap.exists() ? snap.data() : {};
    return data[currencyField(currency)] || 0;
  } catch (err) {
    console.warn('Could not load wallet balance:', err);
    return 0;
  }
}

// ===== LOAD ALL BALANCES =====
export async function loadAllBalances(userId) {
  if (!userId || !guardDb()) {
    const empty = {};
    CURRENCY_KEYS.forEach(c => { empty[c] = 0; });
    return empty;
  }
  try {
    const snap = await getDoc(doc(db, 'users', userId));
    const data = snap.exists() ? snap.data() : {};
    const balances = {};
    CURRENCY_KEYS.forEach(c => {
      balances[c] = data[currencyField(c)] || 0;
    });
    return balances;
  } catch (err) {
    console.warn('Could not load all balances:', err);
    const empty = {};
    CURRENCY_KEYS.forEach(c => { empty[c] = 0; });
    return empty;
  }
}

// ===== CREDIT WALLET (Atomic increment per currency) =====
/**
 * Credit a user's wallet balance atomically in a specific currency.
 * @param {string} userId - Firestore user ID
 * @param {number} amount - Amount to credit
 * @param {string} currency - Currency code (USD|NGN|EUR|GBP)
 * @param {object} options - { description, reference, gateway }
 * @returns {Promise<{success: boolean, newBalance: number, error?: string}>}
 */
export async function creditWallet(userId, amount, currency = "USD", options = {}) {
  if (!userId || !amount || amount <= 0) {
    return { success: false, newBalance: 0, error: "Invalid userId or amount." };
  }
  if (!CURRENCIES[currency]) {
    return { success: false, newBalance: 0, error: `Unsupported currency: ${currency}` };
  }
  if (!guardDb()) {
    return { success: false, newBalance: 0, error: "Database unavailable." };
  }

  try {
    const field = currencyField(currency);
    const userRef = doc(db, "users", userId);

    // Atomic increment
    await updateDoc(userRef, {
      [field]: increment(amount)
    });

    // Log the credit transaction
    try {
      await addDoc(collection(db, "wallet_transactions"), {
        userId: userId,
        type: "credit",
        amount: amount,
        currency: currency,
        gateway: options.gateway || getGatewayForCurrency(currency),
        description: options.description || `Wallet credit (${currency})`,
        reference: options.reference || `WALLET-CREDIT-${currency}-${Date.now()}`,
        status: "Successful",
        createdAt: serverTimestamp()
      });
    } catch (txErr) {
      console.warn("Could not log credit transaction:", txErr);
    }

    // Read back the new balance
    const snap = await getDoc(userRef);
    const newBalance = snap.exists() ? (snap.data()[field] || 0) : amount;

    return { success: true, newBalance };
  } catch (err) {
    console.error("creditWallet error:", err);
    return { success: false, newBalance: 0, error: err.message || "Unknown error." };
  }
}

// ===== DEDUCT FROM WALLET (Atomic decrement per currency) =====
/**
 * Deduct an amount from the user's wallet balance atomically in a specific currency.
 * @param {string} userId - Firestore user ID
 * @param {number} amount - Amount to deduct
 * @param {string} currency - Currency code (USD|NGN|EUR|GBP)
 * @param {object} options - { description, reference, redirectUrl }
 * @returns {Promise<{success: boolean, newBalance: number, error?: string, currentBalance?: number}>}
 */
export async function deductFromWallet(userId, amount, currency = "USD", options = {}) {
  if (!userId || !amount || amount <= 0) {
    return { success: false, newBalance: 0, error: "Invalid userId or amount." };
  }
  if (!CURRENCIES[currency]) {
    return { success: false, newBalance: 0, error: `Unsupported currency: ${currency}` };
  }
  if (!guardDb()) {
    return { success: false, newBalance: 0, error: "Database unavailable." };
  }

  try {
    const field = currencyField(currency);
    const userRef = doc(db, "users", userId);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      return { success: false, newBalance: 0, error: "User profile not found." };
    }

    const currentBalance = snap.data()[field] || 0;

    if (currentBalance < amount) {
      return {
        success: false,
        newBalance: currentBalance,
        currentBalance: currentBalance,
        error: `Insufficient ${currency} balance. You have ${formatCurrency(currentBalance, currency)} but need ${formatCurrency(amount, currency)}.`
      };
    }

    // Atomic decrement
    await updateDoc(userRef, {
      [field]: increment(-amount)
    });

    // Log the debit transaction
    try {
      await addDoc(collection(db, "wallet_transactions"), {
        userId: userId,
        type: "debit",
        amount: amount,
        currency: currency,
        gateway: options.gateway || "wallet",
        description: options.description || `Wallet debit (${currency})`,
        reference: options.reference || `WALLET-DEBIT-${currency}-${Date.now()}`,
        status: "Successful",
        createdAt: serverTimestamp()
      });
    } catch (txErr) {
      console.warn("Could not log debit transaction:", txErr);
    }

    const newBalance = currentBalance - amount;

    // If redirect URL provided, navigate after short delay
    if (options.redirectUrl) {
      setTimeout(() => { window.location.href = options.redirectUrl; }, 1500);
    }

    return { success: true, newBalance };
  } catch (err) {
    console.error("deductFromWallet error:", err);
    return { success: false, newBalance: 0, error: err.message || "Unknown error." };
  }
}

// ===== RENDER TRANSACTION HISTORY (Real-time) =====
/**
 * Set up a real-time listener on wallet_transactions for a given userId.
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
            <th style="padding:8px 10px;text-align:left;font-weight:700;color:#475569;">Currency</th>
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
            const isCredit = tx.type === 'credit' || tx.type === 'topup';
            const currency = tx.currency || 'USD';
            const absAmount = Math.abs(tx.amount || 0);
            const formattedAmt = formatCurrency(absAmount, currency);
            const amountDisplay = isCredit
              ? `<span style="color:#22c55e;font-weight:700;">+${formattedAmt}</span>`
              : `<span style="color:#ef4444;font-weight:700;">-${formattedAmt}</span>`;
            const status = tx.status || 'Successful';
            const statusColor = status === 'Successful' || status === 'Completed' ? '#22c55e' : '#f59e0b';
            const currencyFlag = CURRENCIES[currency]?.flag || '💱';
            return `<tr style="border-bottom:1px solid #f1f5f9;">
              <td style="padding:8px 10px;white-space:nowrap;color:#475569;">${dateStr}<br><span style="font-size:11px;color:#94a3b8;">${timeStr}</span></td>
              <td style="padding:8px 10px;color:#14213d;">${tx.description || 'Transaction'}</td>
              <td style="padding:8px 10px;white-space:nowrap;">${currencyFlag} ${currency}</td>
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

// ===== FUND WALLET MODAL HTML (Multi-Currency) =====
/**
 * Returns the HTML string for a reusable multi-currency Fund Wallet modal.
 * Supports currency selection and dynamic gateway (Paystack/Stripe).
 */
export function getFundWalletModalHTML() {
  const presetOptions = CURRENCY_KEYS.map(c => {
    const info = CURRENCIES[c];
    return `<option value="${c}">${info.flag} ${c} (${info.symbol})</option>`;
  }).join('');

  return `
  <div id="fundWalletModal" class="fb-modal" hidden>
    <div class="fb-modal-overlay" id="fundWalletModalOverlay"></div>
    <div class="fb-modal-card" style="max-width:480px;">
      <div class="fb-modal-header">
        <h3>💰 Fund Wallet</h3>
        <button class="fb-modal-close" id="fundWalletModalClose">&times;</button>
      </div>
      <div class="create-post-modal-body">
        <p style="font-size:14px;color:#475569;margin:0 0 12px;">Select currency and enter amount to add. Payment is processed securely.</p>
        
        <!-- Currency Selector -->
        <div style="margin-bottom:12px;">
          <label for="fundCurrencySelect" style="font-weight:700;font-size:13px;color:#0b2d4d;display:block;margin-bottom:6px;">Currency</label>
          <select id="fundCurrencySelect" class="currency-select" style="width:100%;">
            ${presetOptions}
          </select>
        </div>

        <!-- Preset Amounts -->
        <div id="fundPresetContainer" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          <button type="button" class="donation-preset-btn fund-preset active" data-amount="10">$10</button>
          <button type="button" class="donation-preset-btn fund-preset" data-amount="25">$25</button>
          <button type="button" class="donation-preset-btn fund-preset" data-amount="50">$50</button>
          <button type="button" class="donation-preset-btn fund-preset" data-amount="100">$100</button>
        </div>

        <div class="donation-custom-wrap" style="margin-bottom:12px;">
          <input type="number" id="fundCustomAmount" class="donation-custom-input" placeholder="Custom amount" min="1" step="0.01">
        </div>

        <!-- Gateway Badge -->
        <div id="fundGatewayBadge" style="text-align:center;padding:8px;background:#f1f5f9;border-radius:10px;font-size:13px;color:#64748b;margin-bottom:12px;">
          💳 Pay via <strong id="fundGatewayName">Stripe</strong>
        </div>

        <div id="fundWalletStatus" class="message"></div>
        <button type="button" id="fundWalletPayBtn" class="btn" style="width:100%;margin:0;">💳 Pay Now</button>
      </div>
    </div>
  </div>`;
}

// ===== STRIPE CHECKOUT HELPER =====
/**
 * Open Stripe Checkout for wallet funding.
 * Falls back to a redirect-based checkout.
 */
function openStripeCheckout(amount, currency, email, userId, onSuccess) {
  if (typeof Stripe === "undefined") {
    // Fallback: redirect to a Stripe Checkout session URL
    // In production, create a Checkout Session via your backend and redirect
    console.warn("Stripe.js not loaded. Cannot process Stripe payment.");
    return false;
  }

  // In production, you would create a Checkout Session via your server:
  // 1. POST to your server to create a Checkout Session with { amount, currency, userId }
  // 2. Get the session ID
  // 3. stripe.redirectToCheckout({ sessionId })
  // Since we're client-side only, we simulate with a message

  alert(`Stripe Checkout for ${formatCurrency(amount, currency)} (${currency}).\n\nIn production, this would redirect to Stripe's secure checkout page.\n\nFor now, using demo mode.`);

  // Simulate success for demo
  if (onSuccess) {
    setTimeout(() => {
      onSuccess({
        reference: `STRIPE-DEMO-${currency}-${Date.now()}`,
        amount: amount,
        currency: currency
      });
    }, 1000);
  }
  return true;
}

// ===== INIT FUND WALLET MODAL (Multi-Currency with Gateway Switching) =====
/**
 * Initialize the multi-currency Fund Wallet modal event handlers.
 * @param {Function} onSuccess - Callback after successful funding: ({amount, currency, reference})
 */
export function initFundWalletModal(onSuccess) {
  let fundSelectedAmount = 10;
  let selectedCurrency = getPreferredCurrency();

  const fundWalletModal = document.getElementById("fundWalletModal");
  const fundWalletModalOverlay = document.getElementById("fundWalletModalOverlay");
  const fundWalletModalClose = document.getElementById("fundWalletModalClose");
  const fundWalletBtns = document.querySelectorAll(".fund-wallet-trigger-btn");
  const fundCurrencySelect = document.getElementById("fundCurrencySelect");
  const fundPresetContainer = document.getElementById("fundPresetContainer");
  const fundCustomAmount = document.getElementById("fundCustomAmount");
  const fundPresetBtns = document.querySelectorAll(".fund-preset");
  const fundWalletPayBtn = document.getElementById("fundWalletPayBtn");
  const fundWalletStatus = document.getElementById("fundWalletStatus");
  const fundGatewayName = document.getElementById("fundGatewayName");

  if (!fundWalletModal) return { openModal: () => {}, closeModal: () => {} };

  // ===== PRESET AMOUNTS PER CURRENCY =====
  const CURRENCY_PRESETS = {
    USD: [10, 25, 50, 100],
    NGN: [1000, 2500, 5000, 10000],
    EUR: [10, 25, 50, 100],
    GBP: [10, 25, 50, 100]
  };

  function showStatus(msg, type) {
    if (!fundWalletStatus) return;
    fundWalletStatus.textContent = msg;
    fundWalletStatus.className = `message ${type}`;
  }

  function updatePresets(currency) {
    if (!fundPresetContainer || !fundPresetBtns.length) return;
    const presets = CURRENCY_PRESETS[currency] || CURRENCY_PRESETS.USD;
    fundPresetBtns.forEach((btn, i) => {
      if (i < presets.length) {
        btn.dataset.amount = presets[i];
        btn.textContent = formatCurrency(presets[i], currency).replace(/^(\D+)/, (m) => m);
        btn.style.display = "";
      } else {
        btn.style.display = "none";
      }
    });
    // Select first preset
    fundPresetBtns.forEach((b) => b.classList.remove("active"));
    if (fundPresetBtns[0]) {
      fundPresetBtns[0].classList.add("active");
      fundSelectedAmount = presets[0];
    }
  }

  function updateGateway(currency) {
    const gateway = getGatewayForCurrency(currency);
    if (fundGatewayName) {
      fundGatewayName.textContent = gateway === "paystack" ? "Paystack" : "Stripe";
    }
  }

  function openModal() {
    selectedCurrency = getPreferredCurrency();
    if (fundCurrencySelect) fundCurrencySelect.value = selectedCurrency;
    fundSelectedAmount = (CURRENCY_PRESETS[selectedCurrency] || CURRENCY_PRESETS.USD)[0];
    if (fundCustomAmount) fundCustomAmount.value = "";
    updatePresets(selectedCurrency);
    updateGateway(selectedCurrency);
    showStatus("", "success");
    fundWalletModal.hidden = false;
  }

  function closeModal() {
    if (fundWalletModal) fundWalletModal.hidden = true;
  }

  // Wire up all trigger buttons
  fundWalletBtns.forEach((btn) => btn.addEventListener("click", openModal));

  if (fundWalletModalOverlay) fundWalletModalOverlay.addEventListener("click", closeModal);
  if (fundWalletModalClose) fundWalletModalClose.addEventListener("click", closeModal);

  // Currency selector change
  if (fundCurrencySelect) {
    fundCurrencySelect.addEventListener("change", () => {
      selectedCurrency = fundCurrencySelect.value;
      if (fundCustomAmount) fundCustomAmount.value = "";
      updatePresets(selectedCurrency);
      updateGateway(selectedCurrency);
      showStatus("", "success");
    });
  }

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

  // Process payment
  if (fundWalletPayBtn) {
    fundWalletPayBtn.addEventListener("click", () => {
      const user = auth.currentUser;
      if (!user) {
        showStatus("Please sign in first.", "error");
        return;
      }

      const amount = getFundAmount();
      const currency = selectedCurrency;
      const minAmount = (CURRENCIES[currency] || CURRENCIES.USD).minAmount;

      if (amount < minAmount) {
        showStatus(`Minimum amount is ${formatCurrency(minAmount, currency)}.`, "error");
        return;
      }

      const gateway = getGatewayForCurrency(currency);
      const email = user.email || "user@gfhf.com";

      if (gateway === "paystack") {
        // ===== PAYSTACK =====
        if (typeof PaystackPop === "undefined") {
          showStatus("Paystack is not loaded. Please refresh.", "error");
          return;
        }

        const amountInKobo = Math.round(amount * 100);

        const handler = PaystackPop.setup({
          key: PAYSTACK_PUBLIC_KEY,
          email: email,
          amount: amountInKobo,
          currency: "NGN",
          ref: `GFHF-FUND-${currency}-${Math.floor(Math.random() * 1000000000)}-${Date.now()}`,
          metadata: {
            custom_fields: [
              { display_name: "User ID", variable_name: "user_id", value: user.uid },
              { display_name: "Currency", variable_name: "currency", value: currency }
            ]
          },
          callback: async function (response) {
            if (!guardDb()) {
              showStatus("Database unavailable. Please contact support.", "error");
              return;
            }
            try {
              const result = await creditWallet(user.uid, amount, currency, {
                description: `Wallet funding via Paystack (${currency})`,
                reference: response.reference,
                gateway: "paystack"
              });

              if (result.success) {
                showStatus(`✅ Funded! ${formatCurrency(amount, currency)} added.`, "success");
                // Save preferred currency
                setPreferredCurrency(currency);
                await savePreferredCurrencyToFirestore(user.uid, currency);
                if (onSuccess) onSuccess({ amount, currency, reference: response.reference });
                setTimeout(closeModal, 2000);
              } else {
                showStatus("Payment succeeded but wallet credit failed.", "error");
              }
            } catch (err) {
              console.error("Fund wallet credit error:", err);
              showStatus("Payment succeeded but wallet credit failed.", "error");
            }
          },
          onClose: function () {
            showStatus("Payment window was closed.", "error");
          }
        });

        handler.openIframe();

      } else {
        // ===== STRIPE =====
        openStripeCheckout(amount, currency, email, user.uid, async (stripeResult) => {
          if (!guardDb()) {
            showStatus("Database unavailable.", "error");
            return;
          }
          try {
            const result = await creditWallet(user.uid, stripeResult.amount, stripeResult.currency, {
              description: `Wallet funding via Stripe (${stripeResult.currency})`,
              reference: stripeResult.reference,
              gateway: "stripe"
            });

            if (result.success) {
              showStatus(`✅ Funded! ${formatCurrency(stripeResult.amount, stripeResult.currency)} added.`, "success");
              setPreferredCurrency(stripeResult.currency);
              await savePreferredCurrencyToFirestore(user.uid, stripeResult.currency);
              if (onSuccess) onSuccess(stripeResult);
              setTimeout(closeModal, 2000);
            } else {
              showStatus("Payment succeeded but wallet credit failed.", "error");
            }
          } catch (err) {
            console.error("Stripe wallet credit error:", err);
            showStatus("Payment succeeded but wallet credit failed.", "error");
          }
        });
      }
    });
  }

  return { openModal, closeModal };
}
