import { db } from "./firebase.js";
import { collection, doc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const memberCount = document.getElementById("memberCount");
const donationCount = document.getElementById("donationCount");
const countryCount = document.getElementById("countryCount");
const prizePool = document.getElementById("prizePool");

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value || 0);
}

function toNumber(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

async function loadHomeStats() {
  if (!memberCount && !donationCount && !countryCount && !prizePool) return;
  if (!db) { console.warn("Firestore db not available"); return; }

  try {
    const usersSnap = await getDocs(collection(db, "users"));
    const users = usersSnap.docs.map((docSnap) => docSnap.data());
    const countries = new Set(users.map((user) => user.country).filter(Boolean));

    let totalDonations = 0;
    let donationDocs = 0;

    const donationsSnap = await getDocs(collection(db, "donations"));
    donationDocs = donationsSnap.size;
    donationsSnap.docs.forEach((docSnap) => {
      const data = docSnap.data();
      const amount = toNumber(data.amountUsd ?? data.amount ?? data.usd ?? data.value ?? 0);
      totalDonations += amount;
    });

    if (donationDocs === 0) {
      const statsDoc = await getDoc(doc(db, "siteStats", "global"));
      if (statsDoc.exists()) {
        const statsData = statsDoc.data();
        totalDonations = toNumber(statsData.totalDonations ?? statsData.donationTotal ?? totalDonations);
      }
    }

    if (memberCount) memberCount.textContent = users.length.toString();
    if (countryCount) countryCount.textContent = countries.size.toString();
    if (donationCount) donationCount.textContent = formatCurrency(totalDonations);
    if (prizePool) prizePool.textContent = formatCurrency(totalDonations * 0.2);
  } catch (error) {
    console.error("Could not load home stats", error);
    if (memberCount) memberCount.textContent = "0";
    if (countryCount) countryCount.textContent = "0";
    if (donationCount) donationCount.textContent = "$0";
    if (prizePool) prizePool.textContent = "$0";
  }
}

loadHomeStats();
