import { db } from "./firebase.js";
import { collection, deleteDoc, doc, getDocs, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function sendTeammateRequest(currentUid, targetUid, senderName, senderAvatar, extra = {}) {
  if (!currentUid || !targetUid || currentUid === targetUid) return false;
  try {
    const notificationsRef = collection(db, "notifications", targetUid, "items");
    await setDoc(doc(notificationsRef), {
      type: "teammate_request",
      senderId: currentUid,
      recipientId: targetUid,
      senderName,
      senderAvatar,
      status: "pending",
      message: `${senderName} wants to connect as a teammate.`,
      read: false,
      createdAt: serverTimestamp(),
      ...extra
    });
    return true;
  } catch (err) {
    console.warn("Could not send teammate request", err);
    return false;
  }
}

export async function acceptTeammateRequest(currentUid, senderId) {
  if (!currentUid || !senderId) return false;
  try {
    await setDoc(doc(db, "users", currentUid, "teammates", senderId), { teammateId: senderId, addedAt: serverTimestamp() });
    await setDoc(doc(db, "users", senderId, "teammates", currentUid), { teammateId: currentUid, addedAt: serverTimestamp() });
    await deleteDoc(doc(db, "notifications", currentUid, "items", senderId));
    return true;
  } catch (err) {
    console.warn("Could not accept teammate request", err);
    return false;
  }
}

export async function getTeammates(uid) {
  if (!uid) return [];
  try {
    const snap = await getDocs(collection(db, "users", uid, "teammates"));
    return snap.docs.map((d) => d.id);
  } catch {
    return [];
  }
}
