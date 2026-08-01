import { db } from "./firebase.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const RATE_LIMIT_WINDOW_MS = 60 * 1000;

function getRateLimitKey(action, uid) {
  return `gfhf_rate_limit_${action}_${uid}`;
}

export async function checkRateLimit(action, uid, windowMs = RATE_LIMIT_WINDOW_MS, maxCalls = 5) {
  if (!uid) return true;
  const key = getRateLimitKey(action, uid);
  const now = Date.now();
  const raw = localStorage.getItem(key);
  if (!raw) {
    localStorage.setItem(key, JSON.stringify({ count: 1, resetAt: now + windowMs }));
    return true;
  }

  try {
    const entry = JSON.parse(raw);
    if (!entry || now > entry.resetAt) {
      localStorage.setItem(key, JSON.stringify({ count: 1, resetAt: now + windowMs }));
      return true;
    }
    if (entry.count >= maxCalls) {
      return false;
    }
    entry.count += 1;
    localStorage.setItem(key, JSON.stringify(entry));
    return true;
  } catch {
    localStorage.setItem(key, JSON.stringify({ count: 1, resetAt: now + windowMs }));
    return true;
  }
}

export async function createReport({ reporterId, targetType, targetId, reason, details = {}, targetUserId = null }) {
  if (!reporterId || !targetType || !targetId) return null;
  try {
    const reportRef = await addDoc(collection(db, "reports"), {
      reporterId,
      targetType,
      targetId,
      targetUserId,
      reason,
      details,
      status: "open",
      createdAt: serverTimestamp()
    });
    return reportRef.id;
  } catch (err) {
    console.warn("Could not create report", err);
    return null;
  }
}

export async function blockUser(currentUid, targetUid, reason = "") {
  if (!currentUid || !targetUid || currentUid === targetUid) return false;
  try {
    await setDoc(doc(db, "users", currentUid, "blockedUsers", targetUid), {
      targetUid,
      reason,
      createdAt: serverTimestamp()
    });
    await setDoc(doc(db, "users", targetUid, "blockedBy", currentUid), {
      blockerUid: currentUid,
      reason,
      createdAt: serverTimestamp()
    });
    return true;
  } catch (err) {
    console.warn("Could not block user", err);
    return false;
  }
}

export async function unblockUser(currentUid, targetUid) {
  if (!currentUid || !targetUid) return false;
  try {
    await deleteDoc(doc(db, "users", currentUid, "blockedUsers", targetUid));
    await deleteDoc(doc(db, "users", targetUid, "blockedBy", currentUid));
    return true;
  } catch (err) {
    console.warn("Could not unblock user", err);
    return false;
  }
}

export async function isBlocked(currentUid, targetUid) {
  if (!currentUid || !targetUid) return false;
  try {
    const [a, b] = await Promise.all([
      getDoc(doc(db, "users", currentUid, "blockedUsers", targetUid)),
      getDoc(doc(db, "users", targetUid, "blockedBy", currentUid))
    ]);
    return a.exists() || b.exists();
  } catch {
    return false;
  }
}

export async function setUserModerationStatus(uid, status, reason = "") {
  if (!uid) return false;
  try {
    await updateDoc(doc(db, "users", uid), {
      moderationStatus: status,
      moderationReason: reason,
      moderationUpdatedAt: serverTimestamp()
    });
    return true;
  } catch (err) {
    console.warn("Could not update moderation status", err);
    return false;
  }
}

export async function softDeleteContent(collectionName, docId, reason = "") {
  if (!collectionName || !docId) return false;
  try {
    await updateDoc(doc(db, collectionName, docId), {
      deleted: true,
      deletionReason: reason,
      deletedAt: serverTimestamp()
    });
    return true;
  } catch (err) {
    console.warn("Could not delete content", err);
    return false;
  }
}

export async function restoreContent(collectionName, docId) {
  if (!collectionName || !docId) return false;
  try {
    await updateDoc(doc(db, collectionName, docId), {
      deleted: false,
      deletionReason: "",
      deletedAt: null
    });
    return true;
  } catch (err) {
    console.warn("Could not restore content", err);
    return false;
  }
}

export async function getModerationState(uid) {
  if (!uid) return { status: "active", reason: "" };
  try {
    const snap = await getDoc(doc(db, "users", uid));
    const data = snap.exists() ? snap.data() : {};
    return {
      status: data.moderationStatus || "active",
      reason: data.moderationReason || ""
    };
  } catch {
    return { status: "active", reason: "" };
  }
}
