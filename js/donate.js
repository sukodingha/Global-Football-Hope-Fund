/**
 * GFHF Donation Module
 * Handles Paystack, PayPal, and Wallet payment processing with Firestore logging.
 */

import { auth, db } from "./firebase-config.js";
import {
  collection,
  addDoc,
  serverTimestamp,
  doc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Import shared wallet module
import {
  loadWalletBalance, deductFromWallet, formatCurrency, getFundWalletModalHTML, initFundWalletModal
} from "./wallet.js";

// ===== DOM Refs =====
const presetBtns = document.querySelectorAll(".donation-preset-btn");
const customAmount = document.getElementById("customAmount");
const donorName = document.getElementById("donorName");
const donorEmail = document.getElementById("donorEmail");
const donorMessage = document.getElementById("donorMessage");
const paymentTabs = document.querySelectorAll(".payment-tab");
const paystackBtn = document.getElementById("paystackBtn");
const paypalContainer = document.getElementById("paypal-button-container");
const walletPayBtn = document.getElementById("walletPayBtn");
const walletPaySection = document.getElementById("walletPaySection");
const donationMessage = document.getElementById("donationMessage");

// ===== State =====
let selectedAmount = 10;
let currentMethod = "paystack"; // "paystack", "paypal", or "wallet"
let paypalInitialized = false;

// ===== Helpers =====
function showDonationMessage(text, type = "success") {
  if (!donationMessage) return;
  donationMessage.textContent = text;
  donationMessage.className = `message ${type}`;
}

function getDonationAmount() {
  const customVal = parseFloat(customAmount?.value);
  if (customVal && customVal > 0) return customVal;
  return selectedAmount;
}

function getFormData() {
  return {
    name: donorName?.value?.trim() || "Anonymous",
    email: donorEmail?.value?.trim() || "",
    message: donorMessage?.value?.trim() || "",
    amount: getDonationAmount()
  };
}

function validateForm() {
  const data = getFormData();
  if (!data.email) {
    showDonationMessage("Please enter your email address.", "error");
    return false;
  }
  if (!data.email.includes("@")) {
    showDonationMessage("Please enter a valid email address.", "error");
    return false;
  }
  if (!data.amount || data.amount < 1) {
    showDonationMessage("Please select or enter a donation amount of at least $1.", "error");
    return false;
  }
  return true;
}

async function saveDonationRecord(donationData) {
  try {
    const docRef = await addDoc(collection(db, "donations"), {
      donorName: donationData.name,
      donorEmail: donationData.email,
      donorMessage: donationData.message || "",
      amount: donationData.amount,
      currency: "USD",
      paymentRef: donationData.paymentRef || "",
      method: donationData.method || currentMethod,
      status: "completed",
      createdAt: serverTimestamp()
    });
    console.log("Donation saved with ID:", docRef.id);
    return docRef;
  } catch (error) {
    console.error("Error saving donation record:", error);
    // Don't block the user flow if Firestore save fails
  }
}

// ===== Preset Amount Selection =====
presetBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    presetBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    selectedAmount = parseFloat(btn.dataset.amount);
    if (customAmount) customAmount.value = "";
  });
});

if (customAmount) {
  customAmount.addEventListener("input", () => {
    presetBtns.forEach((b) => b.classList.remove("active"));
  });
}

// ===== Payment Method Tabs =====
paymentTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    paymentTabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    currentMethod = tab.dataset.method;

    if (currentMethod === "paystack") {
      paystackBtn.style.display = "block";
      paypalContainer.style.display = "none";
      if (walletPaySection) walletPaySection.style.display = "none";
    } else if (currentMethod === "paypal") {
      paystackBtn.style.display = "none";
      paypalContainer.style.display = "block";
      if (walletPaySection) walletPaySection.style.display = "none";
      if (!paypalInitialized) {
        initPayPalButton();
        paypalInitialized = true;
      }
    } else if (currentMethod === "wallet") {
      paystackBtn.style.display = "none";
      paypalContainer.style.display = "none";
      if (walletPaySection) {
        walletPaySection.style.display = "block";
        updateWalletPayUI();
      }
    }
  });
});

// ===== Paystack Payment =====
window.payWithPaystack = function () {
  if (!validateForm()) return;

  const data = getFormData();
  const amountInKobo = Math.round(data.amount * 100); // Paystack uses kobo (cents)

  if (typeof PaystackPop === "undefined") {
    showDonationMessage("Paystack is not loaded. Please check your internet connection.", "error");
    return;
  }

  const handler = PaystackPop.setup({
    key: "YOUR_PAYSTACK_PUBLIC_KEY", // Replace with your live Paystack public key
    email: data.email,
    amount: amountInKobo,
    currency: "USD",
    ref: "GFHF-" + Math.floor(Math.random() * 1000000000) + "-" + Date.now(),
    metadata: {
      custom_fields: [
        {
          display_name: "Donor Name",
          variable_name: "donor_name",
          value: data.name
        },
        {
          display_name: "Message",
          variable_name: "donor_message",
          value: data.message
        }
      ]
    },
    callback: function (response) {
      // Payment successful
      showDonationMessage(
        `✅ Thank you, ${data.name}! Your donation of $${data.amount.toFixed(2)} was successful. Reference: ${response.reference}`,
        "success"
      );

      // Save to Firestore
      saveDonationRecord({
        ...data,
        paymentRef: response.reference,
        method: "paystack"
      });

      // Reset form
      donorName.value = "";
      donorEmail.value = "";
      donorMessage.value = "";
      customAmount.value = "";
      presetBtns.forEach((b) => b.classList.remove("active"));
      if (presetBtns[0]) presetBtns[0].classList.add("active");
      selectedAmount = 10;
    },
    onClose: function () {
      showDonationMessage("Payment window was closed.", "error");
    }
  });

  handler.openIframe();
};

// Paystack button click
if (paystackBtn) {
  paystackBtn.addEventListener("click", (e) => {
    e.preventDefault();
    window.payWithPaystack();
  });
}

// ===== PayPal Payment =====
function initPayPalButton() {
  if (typeof paypal === "undefined") {
    console.warn("PayPal SDK not loaded yet. Will retry on tab switch.");
    return;
  }

  try {
    paypal.Buttons({
      createOrder: function (data, actions) {
        // Validate form before creating PayPal order
        const formData = getFormData();
        if (!formData.email || !formData.email.includes("@")) {
          showDonationMessage("Please enter a valid email address before paying with PayPal.", "error");
          return actions.reject();
        }
        if (formData.amount < 1) {
          showDonationMessage("Please select a donation amount of at least $1.", "error");
          return actions.reject();
        }
        return actions.order.create({
          purchase_units: [{
            description: "Donation to Global Football Hope Fund",
            amount: {
              currency_code: "USD",
              value: formData.amount.toFixed(2)
            }
          }]
        });
      },
      onApprove: function (paypalData, actions) {
        return actions.order.capture().then(function (details) {
          const formData = getFormData();
          const payerName = details.payer?.name?.given_name || formData.name;
          const payerEmail = details.payer?.email_address || formData.email;

          showDonationMessage(
            `✅ Thank you, ${payerName}! Your donation of $${formData.amount.toFixed(2)} via PayPal was successful. Transaction ID: ${details.id}`,
            "success"
          );

          // Save to Firestore
          saveDonationRecord({
            name: payerName,
            email: payerEmail,
            message: formData.message,
            amount: formData.amount,
            paymentRef: details.id,
            method: "paypal"
          });

          // Reset form
          donorName.value = "";
          donorEmail.value = "";
          donorMessage.value = "";
          customAmount.value = "";
          presetBtns.forEach((b) => b.classList.remove("active"));
          if (presetBtns[0]) presetBtns[0].classList.add("active");
          selectedAmount = 10;
        });
      },
      onError: function (err) {
        console.error("PayPal Error:", err);
        showDonationMessage("PayPal payment failed. Please try again.", "error");
      }
    }).render("#paypal-button-container");
  } catch (error) {
    console.error("PayPal initialization error:", error);
  }
}

// Auto-init PayPal if it's the default active tab
document.addEventListener("DOMContentLoaded", () => {
  if (currentMethod === "paypal" && !paypalInitialized) {
    initPayPalButton();
    paypalInitialized = true;
  }
});

// ===== WALLET PAYMENT =====

/**
 * Update the wallet payment section UI with current balance
 */
async function updateWalletPayUI() {
  if (!walletPaySection) return;
  const user = auth.currentUser;
  if (!user) {
    walletPaySection.innerHTML = `
      <div style="text-align:center;padding:16px;color:#64748b;">
        <p>Please sign in to use your wallet.</p>
      </div>`;
    return;
  }

  const balance = await loadWalletBalance(user.uid);
  walletPaySection.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:linear-gradient(135deg,#0b2d4d,#123f63);color:white;border-radius:14px;">
        <span style="font-weight:600;">💰 Wallet Balance</span>
        <span style="font-size:22px;font-weight:900;">${formatCurrency(balance)}</span>
      </div>
      <p style="font-size:14px;color:#475569;margin:0;">Pay with your GFHF wallet balance. Your donation will be deducted immediately.</p>
      <button type="button" id="walletPayBtn" class="btn" style="width:100%;margin:0;">
        💰 Pay with Wallet
      </button>
      <button type="button" class="fund-wallet-trigger-btn btn btn-secondary" style="width:100%;margin:0;padding:12px 20px;font-size:14px;background:linear-gradient(90deg, #00c853 0%, #00b34a 100%);">
        💳 Fund Wallet via Paystack
      </button>
    </div>
  `;

  // Wire up the wallet pay button
  const walletPayBtn = document.getElementById("walletPayBtn");
  if (walletPayBtn) {
    walletPayBtn.addEventListener("click", processWalletPayment);
  }
}

/**
 * Process a donation using wallet balance
 */
async function processWalletPayment() {
  const user = auth.currentUser;
  if (!user) {
    showDonationMessage("Please sign in to pay with your wallet.", "error");
    return;
  }

  const data = getFormData();
  if (!data.amount || data.amount < 1) {
    showDonationMessage("Please select or enter a donation amount of at least $1.", "error");
    return;
  }

  showDonationMessage("Processing wallet payment...", "success");

  const result = await deductFromWallet(user.uid, data.amount, "USD", {
    description: "Donation to GFHF",
    reference: "GFHF-DON-" + Math.floor(Math.random() * 1000000000) + "-" + Date.now()
  });

  if (result.success) {
    showDonationMessage(
      `✅ Thank you, ${data.name || "Anonymous"}! Your donation of ${formatCurrency(data.amount)} was successful via wallet.`,
      "success"
    );

    // Save donation record
    saveDonationRecord({
      name: data.name,
      email: data.email,
      message: data.message,
      amount: data.amount,
      paymentRef: result.reference || "wallet-donation",
      method: "wallet"
    });

    // Reset form
    donorName.value = "";
    donorEmail.value = "";
    donorMessage.value = "";
    customAmount.value = "";
    presetBtns.forEach((b) => b.classList.remove("active"));
    if (presetBtns[0]) presetBtns[0].classList.add("active");
    selectedAmount = 10;

    // Update wallet UI
    setTimeout(updateWalletPayUI, 500);
  } else {
    // Insufficient funds
    showDonationMessage(
      `❌ ${result.error || "Payment failed."} <button class="fund-wallet-trigger-btn btn" style="margin-top:8px;padding:8px 16px;font-size:13px;">💰 Top Up Wallet</button>`,
      "error"
    );
  }
}

// Update the payment tab switching to include wallet
document.addEventListener('DOMContentLoaded', () => {
  // Ensure walletPaySection exists and update wallet tab switching logic
  const walletTab = document.querySelector('.payment-tab[data-method="wallet"]');
  if (walletTab && walletPaySection) {
    walletTab.addEventListener('click', async () => {
      await updateWalletPayUI();
    });
  }

  // Inject Fund Wallet modal if not present
  if (!document.getElementById('fundWalletModal')) {
    const modalHTML = getFundWalletModalHTML();
    document.body.insertAdjacentHTML('beforeend', modalHTML);
  }
  initFundWalletModal(() => {
    // Refresh wallet pay UI after successful funding
    if (currentMethod === 'wallet') {
      updateWalletPayUI();
    }
  });
});

