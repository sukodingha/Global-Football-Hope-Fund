import { db } from "./firebase.js";
import { addDoc, collection, serverTimestamp, updateDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function startLiveStream(hostId, metadata = {}) {
  if (!hostId) return null;
  try {
    const ref = await addDoc(collection(db, "liveStreams"), {
      hostId,
      status: "live",
      viewers: 0,
      startedAt: serverTimestamp(),
      ...metadata
    });
    return ref.id;
  } catch (err) {
    console.warn("Could not start live stream", err);
    return null;
  }
}

export async function endLiveStream(streamId) {
  if (!streamId) return false;
  try {
    await updateDoc(doc(db, "liveStreams", streamId), {
      status: "ended",
      endedAt: serverTimestamp()
    });
    return true;
  } catch (err) {
    console.warn("Could not end live stream", err);
    return false;
  }
}
