/**
 * GFHF Admin Dashboard Module
 * - Admin role verification (Firestore role: "admin")
 * - Donation overview: total raised, recent transactions, donor list
 * - User management: view users, change roles, moderate posts
 * - Community post moderation
 */

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection,
  query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ===== DOM REFS =====
const adminContent = document.getElementById("adminContent");
const adminDenied = document.getElementById("adminDenied");
const adminAccessMsg = document.getElementById("adminAccessMsg");

// Stats
const adminTotalUsers = document.getElementById("adminTotalUsers");
const adminTotalDonations = document.getElementById("adminTotalDonations");
const adminTotalRaised = document.getElementById("adminTotalRaised");
const adminTotalPosts = document.getElementById("adminTotalPosts");
const adminTotalPredictions = document.getElementById("adminTotalPredictions");
const adminTotalAdmins = document.getElementById("adminTotalAdmins");

// Sections
const adminRecentTransactions = document.getElementById("adminRecentTransactions");
const adminUsersList = document.getElementById("adminUsersList");
const adminDonationsList = document.getElementById("adminDonationsList");
const adminPostsList = document.getElementById("adminPostsList");

// ===== STATE =====
let currentUser = null;
let isAdmin = false;

// ===== TAB SWITCHING =====
function initTabs() {
  const tabs = document.querySelectorAll(".admin-tab");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      // Update tab active state
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");

      // Show corresponding section
      const sectionId = tab.dataset.section;
      document.querySelectorAll(".admin-section").forEach(s => s.classList.remove("active"));
      const targetSection = document.getElementById(`admin${sectionId.charAt(0).toUpperCase() + sectionId.slice(1)}`);
      if (targetSection) targetSection.classList.add("active");
    });
  });
}

// ===== CHECK ADMIN ACCESS =====
async function checkAdminAccess(user) {
  if (!user) {
    if (adminAccessMsg) adminAccessMsg.textContent = "Please sign in as an administrator.";
    if (adminContent) adminContent.hidden = true;
    if (adminDenied) adminDenied.hidden = false;
    return false;
  }

  try {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      const data = userSnap.data();
      if (data.role === "admin") {
        isAdmin = true;
        if (adminAccessMsg) adminAccessMsg.textContent = `✅ Welcome, ${data.displayName || data.firstName || "Admin"}! You have full administrative access.`;
        if (adminContent) adminContent.hidden = false;
        if (adminDenied) adminDenied.hidden = true;
        return true;
      }
    }

    isAdmin = false;
    if (adminAccessMsg) adminAccessMsg.textContent = "Access Denied: You do not have admin privileges.";
    if (adminContent) adminContent.hidden = true;
    if (adminDenied) adminDenied.hidden = false;
    return false;
  } catch (err) {
    console.error("Admin check error:", err);
    if (adminAccessMsg) adminAccessMsg.textContent = "Error verifying admin status.";
    if (adminContent) adminContent.hidden = true;
    if (adminDenied) adminDenied.hidden = true;
    return false;
  }
}

// ===== LOAD OVERVIEW STATS =====
async function loadOverviewStats() {
  try {
    // Count users
    const usersSnap = await getDocs(collection(db, "users"));
    const totalUsers = usersSnap.size;
    let adminCount = 0;
    usersSnap.docs.forEach(d => {
      if (d.data().role === "admin") adminCount++;
    });

    // Count donations
    let totalDonationsCount = 0;
    let totalRaised = 0;
    try {
      const donationsSnap = await getDocs(collection(db, "donations"));
      totalDonationsCount = donationsSnap.size;
      donationsSnap.docs.forEach(d => {
        const data = d.data();
        const amount = parseFloat(data.amountUsd || data.amount || data.usd || 0);
        if (!isNaN(amount)) totalRaised += amount;
      });
    } catch (e) {
      // Donations collection may not exist yet
    }

    // Count posts
    let totalPostsCount = 0;
    try {
      const postsSnap = await getDocs(collection(db, "posts"));
      totalPostsCount = postsSnap.size;
    } catch (e) {}

    // Count predictions
    let totalPredictionsCount = 0;
    try {
      const predictionsSnap = await getDocs(collection(db, "predictions"));
      totalPredictionsCount = predictionsSnap.size;
    } catch (e) {}

    // Update DOM
    if (adminTotalUsers) adminTotalUsers.textContent = totalUsers.toString();
    if (adminTotalDonations) adminTotalDonations.textContent = totalDonationsCount.toString();
    if (adminTotalRaised) adminTotalRaised.textContent = `$${totalRaised.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (adminTotalPosts) adminTotalPosts.textContent = totalPostsCount.toString();
    if (adminTotalPredictions) adminTotalPredictions.textContent = totalPredictionsCount.toString();
    if (adminTotalAdmins) adminTotalAdmins.textContent = adminCount.toString();

    return { totalUsers, totalDonationsCount, totalRaised, totalPostsCount, totalPredictionsCount, adminCount };
  } catch (err) {
    console.error("Overview stats error:", err);
  }
}

// ===== LOAD RECENT TRANSACTIONS =====
async function loadRecentTransactions() {
  if (!adminRecentTransactions) return;

  try {
    let transactions = [];

    // Try donations collection
    try {
      const donationsRef = collection(db, "donations");
      const q = query(donationsRef, orderBy("createdAt", "desc"), limit(10));
      const snap = await getDocs(q);
      snap.docs.forEach(d => {
        const data = d.data();
        transactions.push({
          id: d.id,
          type: "donation",
          donor: data.donorName || data.name || "Anonymous",
          email: data.donorEmail || data.email || "",
          amount: parseFloat(data.amountUsd || data.amount || 0) || 0,
          method: data.method || data.paymentMethod || "unknown",
          date: data.createdAt?.toMillis ? new Date(data.createdAt.toMillis()) : (data.createdAt || new Date()),
          status: data.status || "completed"
        });
      });
    } catch (e) {}

    // If no transactions, show sample data
    if (transactions.length === 0) {
      adminRecentTransactions.innerHTML = `
        <div class="admin-empty">No donation transactions recorded yet. Sample data shown below.</div>
        <table class="admin-table">
          <thead><tr><th>Donor</th><th>Amount</th><th>Method</th><th>Status</th><th>Date</th></tr></thead>
          <tbody>
            <tr><td>Alex M.</td><td>$50.00</td><td>Paystack</td><td><span class="admin-badge" style="background:#d1fae5;color:#059669;">Completed</span></td><td>${new Date().toLocaleDateString()}</td></tr>
            <tr><td>Sarah K.</td><td>$25.00</td><td>PayPal</td><td><span class="admin-badge" style="background:#d1fae5;color:#059669;">Completed</span></td><td>${new Date(Date.now() - 86400000).toLocaleDateString()}</td></tr>
            <tr><td>Marco R.</td><td>$100.00</td><td>Crypto</td><td><span class="admin-badge" style="background:#d1fae5;color:#059669;">Completed</span></td><td>${new Date(Date.now() - 86400000 * 2).toLocaleDateString()}</td></tr>
          </tbody>
        </table>
      `;
      return;
    }

    adminRecentTransactions.innerHTML = `
      <table class="admin-table">
        <thead><tr><th>Donor</th><th>Amount</th><th>Method</th><th>Status</th><th>Date</th></tr></thead>
        <tbody>
          ${transactions.map(tx => `
            <tr>
              <td><strong>${tx.donor}</strong>${tx.email ? `<br><span style="font-size:12px;color:#94a3b8;">${tx.email}</span>` : ''}</td>
              <td>$${(tx.amount || 0).toFixed(2)}</td>
              <td>${tx.method}</td>
              <td><span class="admin-badge" style="background:${tx.status === 'completed' ? '#d1fae5' : '#fef3c7'};color:${tx.status === 'completed' ? '#059669' : '#d97706'};">${tx.status}</span></td>
              <td style="font-size:12px;color:#64748b;">${tx.date instanceof Date ? tx.date.toLocaleDateString() : tx.date}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  } catch (err) {
    console.error("Transactions load error:", err);
    if (adminRecentTransactions) {
      adminRecentTransactions.innerHTML = '<div class="admin-error">Failed to load transactions.</div>';
    }
  }
}

// ===== LOAD USERS =====
async function loadUsers() {
  if (!adminUsersList) return;

  try {
    const usersSnap = await getDocs(collection(db, "users"));
    const users = [];

    usersSnap.docs.forEach(d => {
      const data = d.data();
      users.push({
        uid: d.id,
        email: data.email || "No email",
        displayName: data.displayName || data.firstName || "Unknown",
        uniqueId: data.uniqueId || "",
        role: data.role || "user",
        country: data.country || "",
        createdAt: data.createdAt || "",
        photoURL: data.photoURL || ""
      });
    });

    if (users.length === 0) {
      adminUsersList.innerHTML = '<div class="admin-empty">No registered users yet.</div>';
      return;
    }

    adminUsersList.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Email</th>
            <th>Unique ID</th>
            <th>Role</th>
            <th>Country</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${users.map(user => `
            <tr>
              <td>
                <strong>${user.displayName}</strong>
                ${user.photoURL ? `<br><span style="font-size:12px;color:#94a3b8;">📷 Has photo</span>` : ''}
              </td>
              <td style="font-size:13px;color:#475569;">${user.email}</td>
              <td><code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:12px;">${user.uniqueId || "—"}</code></td>
              <td><span class="admin-badge ${user.role}">${user.role}</span></td>
              <td style="font-size:13px;color:#475569;">${user.country || "—"}</td>
              <td>
                <button class="admin-btn-sm ${user.role === 'admin' ? 'danger' : 'success'} toggle-role-btn" data-uid="${user.uid}" data-current="${user.role}">
                  ${user.role === 'admin' ? '🔽 Demote' : '🔼 Make Admin'}
                </button>
                <button class="admin-btn-sm danger delete-user-btn" data-uid="${user.uid}" data-name="${user.displayName}" style="margin-left:4px;">
                  🗑️ Delete
                </button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    // Attach role toggle handlers
    adminUsersList.querySelectorAll(".toggle-role-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const uid = btn.dataset.uid;
        const currentRole = btn.dataset.current;
        const newRole = currentRole === "admin" ? "user" : "admin";
        try {
          await updateDoc(doc(db, "users", uid), { role: newRole });
          loadUsers();
        } catch (err) {
          console.error("Role change error:", err);
          alert("Failed to change role.");
        }
      });
    });

    // Attach delete handlers
    adminUsersList.querySelectorAll(".delete-user-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const uid = btn.dataset.uid;
        const name = btn.dataset.name;
        if (!confirm(`Are you sure you want to delete user "${name}"? This action cannot be undone.`)) return;
        try {
          await deleteDoc(doc(db, "users", uid));
          loadUsers();
        } catch (err) {
          console.error("Delete user error:", err);
          alert("Failed to delete user.");
        }
      });
    });
  } catch (err) {
    console.error("Users load error:", err);
    if (adminUsersList) {
      adminUsersList.innerHTML = '<div class="admin-error">Failed to load users.</div>';
    }
  }
}

// ===== LOAD DONATIONS =====
async function loadDonationsList() {
  if (!adminDonationsList) return;

  try {
    let donations = [];

    try {
      const donationsRef = collection(db, "donations");
      const q = query(donationsRef, orderBy("createdAt", "desc"), limit(50));
      const snap = await getDocs(q);
      snap.docs.forEach(d => {
        const data = d.data();
        donations.push({
          id: d.id,
          donorName: data.donorName || data.name || "Anonymous",
          donorEmail: data.donorEmail || data.email || "",
          amount: parseFloat(data.amountUsd || data.amount || 0) || 0,
          currency: data.currency || "USD",
          method: data.method || data.paymentMethod || "Unknown",
          message: data.message || "",
          status: data.status || "completed",
          createdAt: data.createdAt?.toMillis ? new Date(data.createdAt.toMillis()) : (data.createdAt || new Date())
        });
      });
    } catch (e) {}

    if (donations.length === 0) {
      adminDonationsList.innerHTML = '<div class="admin-empty">No donation records found.</div>';
      return;
    }

    const totalDisplay = donations.reduce((sum, d) => sum + d.amount, 0);

    adminDonationsList.innerHTML = `
      <p style="margin-bottom:16px;font-size:14px;color:#64748b;">Showing ${donations.length} donations · Total: <strong style="color:#0b2d4d;">$${totalDisplay.toFixed(2)}</strong></p>
      <table class="admin-table">
        <thead>
          <tr><th>Donor</th><th>Email</th><th>Amount</th><th>Method</th><th>Status</th><th>Date</th></tr>
        </thead>
        <tbody>
          ${donations.map(d => `
            <tr>
              <td><strong>${d.donorName}</strong>${d.message ? `<br><span style="font-size:12px;color:#94a3b8;">💬 ${d.message.substring(0, 50)}</span>` : ''}</td>
              <td style="font-size:13px;color:#475569;">${d.donorEmail || "—"}</td>
              <td><strong>$${(d.amount || 0).toFixed(2)}</strong></td>
              <td style="font-size:13px;color:#475569;">${d.method}</td>
              <td><span class="admin-badge" style="background:${d.status === 'completed' ? '#d1fae5' : '#fef3c7'};color:${d.status === 'completed' ? '#059669' : '#d97766'};">${d.status}</span></td>
              <td style="font-size:12px;color:#64748b;">${d.createdAt instanceof Date ? d.createdAt.toLocaleDateString() : new Date(d.createdAt).toLocaleDateString()}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  } catch (err) {
    console.error("Donations list error:", err);
    if (adminDonationsList) {
      adminDonationsList.innerHTML = '<div class="admin-error">Failed to load donations.</div>';
    }
  }
}

// ===== LOAD POSTS (Moderation) =====
async function loadPosts() {
  if (!adminPostsList) return;

  try {
    let posts = [];

    try {
      const postsRef = collection(db, "posts");
      const q = query(postsRef, orderBy("createdAt", "desc"), limit(50));
      const snap = await getDocs(q);
      snap.docs.forEach(d => {
        const data = d.data();
        posts.push({
          id: d.id,
          authorName: data.authorName || "Anonymous",
          text: data.text || data.rawText || "",
          interest: data.interest || "General",
          likesCount: data.likes?.length || 0,
          commentsCount: data.comments?.length || 0,
          hasImage: !!data.imageUrl,
          createdAt: data.createdAt?.toMillis ? new Date(data.createdAt.toMillis()) : (data.createdAt || new Date())
        });
      });
    } catch (e) {}

    if (posts.length === 0) {
      adminPostsList.innerHTML = '<div class="admin-empty">No community posts yet.</div>';
      return;
    }

    adminPostsList.innerHTML = `
      <p style="margin-bottom:16px;font-size:14px;color:#64748b;">Showing ${posts.length} posts · Moderate content as needed.</p>
      <table class="admin-table">
        <thead>
          <tr><th>Author</th><th>Content</th><th>Category</th><th>Likes</th><th>Comments</th><th>Actions</th></tr>
        </thead>
        <tbody>
          ${posts.map(p => `
            <tr>
              <td><strong>${p.authorName}</strong></td>
              <td><div class="admin-post-preview">${p.text?.substring(0, 80) || ''}${(p.text?.length || 0) > 80 ? '...' : ''} ${p.hasImage ? '📷' : ''}</div></td>
              <td><span class="admin-badge" style="background:#e0f2fe;color:#0284c7;">${p.interest}</span></td>
              <td style="text-align:center;">${p.likesCount}</td>
              <td style="text-align:center;">${p.commentsCount}</td>
              <td>
                <button class="admin-btn-sm danger delete-post-btn" data-post-id="${p.id}" data-author="${p.authorName}">
                  🗑️ Delete
                </button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    // Attach delete handlers
    adminPostsList.querySelectorAll(".delete-post-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const postId = btn.dataset.postId;
        const author = btn.dataset.author;
        if (!confirm(`Delete post by "${author}"? This cannot be undone.`)) return;
        try {
          await deleteDoc(doc(db, "posts", postId));
          loadPosts();
        } catch (err) {
          console.error("Delete post error:", err);
          alert("Failed to delete post.");
        }
      });
    });
  } catch (err) {
    console.error("Posts load error:", err);
    if (adminPostsList) {
      adminPostsList.innerHTML = '<div class="admin-error">Failed to load posts.</div>';
    }
  }
}

// ===== REFRESH ALL DATA =====
async function refreshAllData() {
  if (!isAdmin) return;
  await loadOverviewStats();
  await loadRecentTransactions();
  await loadUsers();
  await loadDonationsList();
  await loadPosts();
}

// ===== AUTH STATE =====
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  const hasAccess = await checkAdminAccess(user);

  if (hasAccess) {
    initTabs();
    await refreshAllData();
  }
});

// ===== EXPOSE REFRESH =====
window.adminRefresh = refreshAllData;

