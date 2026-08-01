import { getDownloadURL, ref, uploadBytesResumable, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { storage } from "./firebase-config.js";

export function createStorageRef(path) {
  return ref(storage, path);
}

export function uploadFileWithProgress(path, file, onProgress, onError) {
  const storageRef = createStorageRef(path);
  const uploadTask = uploadBytesResumable(storageRef, file);

  uploadTask.on(
    "state_changed",
    (snapshot) => {
      const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
      if (onProgress) onProgress(progress, snapshot);
    },
    (error) => {
      if (onError) onError(error);
    },
    async () => {
      try {
        const url = await getDownloadURL(uploadTask.snapshot.ref);
        if (onProgress) onProgress(100, uploadTask.snapshot, url);
      } catch (error) {
        if (onError) onError(error);
      }
    }
  );

  return uploadTask;
}

export async function deleteFile(path) {
  try {
    await deleteObject(ref(storage, path));
    return true;
  } catch (err) {
    console.warn("Could not delete storage file", err);
    return false;
  }
}
