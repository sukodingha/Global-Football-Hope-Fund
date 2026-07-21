/**
 * GFHF Donation Module
 * Handles Paystack and PayPal payment processing with Firestore logging.
 */

import { db } from "./firebase-config.js";
import {
  collection,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ===== DOM Refs =====
const presetBtns = document.querySelectorAll(".donation-preset-btn");
const customAmount = document.getElementById("customAmount");
const donorName = document.getElementById("donorName");
const donorEmail = document.getElementById("donorEmail");
const donorMessage = document.getElementById("donorMessage");
const paymentTabs = document.querySelectorAll(".payment-tab");
const paystackBtn = document.getElementById("paystackBtn");
const paypalContainer = document.getElementById("paypal-button-container");
const donationMessage = document.getElementById("donationMessage");

// ===== State =====
let selectedAmount = 10;
let currentMethod = "paystack"; // "paystack" or "paypal"
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
    } else {
      paystackBtn.style.display = "none";
      paypalContainer.style.display = "block";
      if (!paypalInitialized) {
        initPayPalButton();
        paypalInitialized = true;
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
    key: "pk_live_xxxxxxxxxxxxxxxxxxxx", // Replace with your live Paystack public key
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

