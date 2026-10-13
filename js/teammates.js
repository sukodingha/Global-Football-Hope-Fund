import { auth, db } from "./firebase.js";
import { collection, deleteDoc, doc, getDocs, setDoc, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function sendTeammateRequest(currentUid, targetUid, senderName, senderAvatar, extra = {}) {
  const senderId = auth.currentUser?.uid;
  if (!senderId || senderId !== currentUid || !targetUid || senderId === targetUid) return false;
  try {
    const requestRef = doc(collection(db, "teammateRequests"));
    const notificationRef = doc(collection(db, "notifications", targetUid, "items"));
    const batch = writeBatch(db);
    batch.set(requestRef, {
      senderId,
      receiverId: targetUid,
      senderName,
      senderAvatar,
      status: "pending",
      createdAt: serverTimestamp()
    });
    batch.set(notificationRef, {
      ...extra,
      type: "teammate_request",
      senderId,
      receiverId: targetUid,
      recipientId: targetUid,
      senderName,
      senderAvatar,
      status: "pending",
      message: `${senderName} wants to connect as a teammate.`,
      read: false,
      createdAt: serverTimestamp(),
      requestId: requestRef.id
    });
    await batch.commit();
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
