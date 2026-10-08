const CLOUDINARY_URL = "https://api.cloudinary.com/v1_1/d8obkydb";
const CLOUDINARY_UPLOAD_PRESET = "community_uploads";
const MAX_IMAGE_SIZE = 15 * 1024 * 1024;
const MAX_VIDEO_SIZE = 300 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 30;
const ALLOWED_MEDIA_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif", "image/avif",
  "video/mp4", "video/webm", "video/quicktime"
]);

let modal;
let activeOptions = null;
let resolveSelection = null;
let cameraStream = null;
let cameraRequestId = 0;
let mediaRecorder = null;
let recordingChunks = [];
let recordingTimer = null;
let facingMode = "user";
let recordingStartedAt = 0;
let discardingRecording = false;

function makeModal() {
  if (modal) return;

  modal = document.createElement("div");
  modal.id = "mediaShareModal";
  modal.className = "fb-modal media-share-modal";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="fb-modal-overlay" data-media-close></div>
    <section class="fb-modal-card media-share-card" role="dialog" aria-modal="true" aria-labelledby="mediaShareTitle">
      <div class="fb-modal-header">
        <div>
          <p class="media-share-eyebrow">Create and share</p>
          <h2 id="mediaShareTitle">Add media</h2>
        </div>
        <button class="fb-modal-close" type="button" data-media-close aria-label="Close media picker">&times;</button>
      </div>
      <div class="media-share-body">
        <div class="media-share-options">
          <button class="media-share-option" id="mediaStartCamera" type="button">
            <span class="media-share-option-icon" aria-hidden="true">◎</span>
            <span><strong>Live Camera Capture</strong><small>Take a photo or record up to 30 seconds</small></span>
          </button>
          <button class="media-share-option" id="mediaSwitchCamera" type="button" aria-label="Switch to rear camera">
            <span class="media-share-option-icon" aria-hidden="true">↻</span>
            <span><strong>Camera Switcher</strong><small id="mediaCameraModeLabel">Front camera</small></span>
          </button>
          <label class="media-share-option" for="mediaGalleryInput">
            <span class="media-share-option-icon" aria-hidden="true">▧</span>
            <span><strong>Phone Gallery Picker</strong><small>Select a photo or video from this device</small></span>
            <input id="mediaGalleryInput" type="file" accept="image/*,video/*" hidden>
          </label>
        </div>
        <div class="media-camera-stage" id="mediaCameraStage" hidden>
          <div class="media-camera-view">
            <video id="cameraPreview" autoplay playsinline muted></video>
            <span class="media-recording-indicator" id="mediaRecordingIndicator" hidden><i></i> REC</span>
            <span class="media-countdown" id="mediaCountdown" hidden>00:30</span>
          </div>
          <div class="media-camera-actions">
            <button class="btn btn-secondary" id="mediaTakePhoto" type="button">Take Photo</button>
            <button class="btn" id="mediaRecordVideo" type="button">Record Video</button>
            <button class="btn btn-secondary" id="mediaStopRecording" type="button" hidden>Stop</button>
          </div>
        </div>
        <p class="media-share-status" id="mediaShareStatus" role="status" aria-live="polite"></p>
        <div class="media-upload-progress" id="mediaUploadProgress" hidden>
          <progress id="mediaUploadProgressBar" max="100" value="0"></progress>
          <span id="mediaUploadProgressLabel">Preparing upload...</span>
        </div>
      </div>
    </section>
  `;
  document.body.appendChild(modal);

  modal.querySelectorAll("[data-media-close]").forEach((button) => button.addEventListener("click", closeMediaShareModal));
  modal.querySelector("#mediaStartCamera").addEventListener("click", startCamera);
  modal.querySelector("#mediaSwitchCamera").addEventListener("click", switchCamera);
  modal.querySelector("#mediaTakePhoto").addEventListener("click", takePhoto);
  modal.querySelector("#mediaRecordVideo").addEventListener("click", startRecording);
  modal.querySelector("#mediaStopRecording").addEventListener("click", stopRecording);
  modal.querySelector("#mediaGalleryInput").addEventListener("change", handleGallerySelection);
  modal.querySelector("#mediaGalleryInput").addEventListener("cancel", () => setStatus("Selection cancelled."));
  document.addEventListener("keydown", handleModalKeydown);
}

function handleModalKeydown(event) {
  if (event.key === "Escape" && modal && !modal.hidden) closeMediaShareModal();
}

function setStatus(message, type = "") {
  const status = modal?.querySelector("#mediaShareStatus");
  if (!status) return;
  status.textContent = message;
  status.className = `media-share-status${type ? ` ${type}` : ""}`;
}

function setUploadProgress(percent, message = "Uploading...") {
  const wrapper = modal?.querySelector("#mediaUploadProgress");
  const progress = modal?.querySelector("#mediaUploadProgressBar");
  const label = modal?.querySelector("#mediaUploadProgressLabel");
  if (!wrapper || !progress || !label) return;
  wrapper.hidden = false;
  progress.value = Math.max(0, Math.min(100, Number(percent) || 0));
  label.textContent = message;
}

function resetUploadProgress() {
  const wrapper = modal?.querySelector("#mediaUploadProgress");
  if (wrapper) wrapper.hidden = true;
}

function acceptsType(type, accept) {
  const patterns = String(accept || "image/*,video/*").split(",").map((item) => item.trim().toLowerCase());
  return patterns.some((pattern) => pattern.endsWith("/*")
    ? type.startsWith(pattern.slice(0, -1))
    : type.toLowerCase() === pattern);
}

function getVideoDuration(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = video.duration;
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute("src");
      resolve(duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read video metadata."));
    };
    video.src = objectUrl;
  });
}

async function validateFiles(fileList, options) {
  const files = Array.from(fileList || []);
  if (!files.length) throw new Error("Choose a photo or video to continue.");
  if (!options.multiple && files.length > 1) files.splice(1);

  for (const file of files) {
    const mediaType = String(file.type || "").toLowerCase().split(";")[0];
    if (!ALLOWED_MEDIA_TYPES.has(mediaType) || !acceptsType(mediaType, options.accept)) {
      throw new Error("Choose a supported photo or video file.");
    }
    const isVideo = mediaType.startsWith("video/");
    const maxBytes = isVideo ? options.maxVideoSize : options.maxImageSize;
    if (file.size > maxBytes) {
      throw new Error(isVideo ? "Videos must be 300 MB or smaller." : "Photos must be 15 MB or smaller.");
    }
    if (isVideo) {
      const duration = await getVideoDuration(file);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("Could not determine the video duration.");
      if (duration > options.maxVideoSeconds + 0.25) {
        throw new Error(`Videos must be ${options.maxVideoSeconds} seconds or shorter.`);
      }
    }
  }
  return files;
}

async function deliverFiles(fileList) {
  setStatus("Checking media...");
  resetUploadProgress();
  const options = activeOptions;
  if (!options) return;
  try {
    const files = await validateFiles(fileList, options);
    if (options !== activeOptions) return;
    await stopCameraStream();
    modal.querySelector("#mediaCameraStage").hidden = true;
    if (typeof options.onSelect === "function") {
      const shouldClose = await options.onSelect(files, {
        setStatus,
        setUploadProgress
      });
      if (shouldClose === false || options !== activeOptions) return;
    }
    const selection = options.multiple ? files : files[0];
    const resolve = resolveSelection;
    resolveSelection = null;
    activeOptions = null;
    modal.hidden = true;
    resolve?.(selection);
  } catch (error) {
    setStatus(error.message || "Could not use this media file.", "error");
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Camera access requires a supported browser and a secure connection.", "error");
    return;
  }

  await stopCameraStream();
  const requestId = ++cameraRequestId;
  const preview = modal.querySelector("#cameraPreview");
  const stage = modal.querySelector("#mediaCameraStage");
  const switchButton = modal.querySelector("#mediaSwitchCamera");
  const takePhotoButton = modal.querySelector("#mediaTakePhoto");
  const recordButton = modal.querySelector("#mediaRecordVideo");
  stage.hidden = false;
  takePhotoButton.disabled = true;
  recordButton.disabled = true;
  setStatus("Requesting camera permission...");

  try {
    let stream;
    let hasAudio = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode } },
        audio: true
      });
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode } },
        audio: false
      });
      hasAudio = false;
    }
    if (requestId !== cameraRequestId || modal.hidden) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    cameraStream = stream;
    preview.srcObject = cameraStream;
    await preview.play();
    takePhotoButton.disabled = false;
    recordButton.disabled = !window.MediaRecorder || !activeOptions?.allowsVideo;
    switchButton.disabled = false;
    if (!activeOptions?.allowsVideo) recordButton.hidden = true;
    setStatus(hasAudio ? "Camera ready." : "Camera ready. Video will be recorded without audio.");
  } catch (error) {
    if (requestId !== cameraRequestId) return;
    stage.hidden = true;
    const message = error?.name === "NotAllowedError"
      ? "Camera permission was denied. Allow camera access and try again."
      : "Camera unavailable. Check permissions and try again.";
    setStatus(message, "error");
  }
}

async function stopCameraStream() {
  cameraRequestId += 1;
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  const preview = modal?.querySelector("#cameraPreview");
  if (preview) preview.srcObject = null;
}

async function switchCamera() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") return;
  facingMode = facingMode === "user" ? "environment" : "user";
  const label = modal.querySelector("#mediaCameraModeLabel");
  const button = modal.querySelector("#mediaSwitchCamera");
  const modeName = facingMode === "user" ? "Front" : "Rear";
  label.textContent = `${modeName} camera selected`;
  button.setAttribute("aria-label", `Switch to ${facingMode === "user" ? "rear" : "front"} camera`);
  await startCamera();
}

async function takePhoto() {
  const preview = modal.querySelector("#cameraPreview");
  if (!preview.videoWidth || !preview.videoHeight) {
    setStatus("Wait for the camera preview to become ready.", "error");
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = preview.videoWidth;
  canvas.height = preview.videoHeight;
  canvas.getContext("2d").drawImage(preview, 0, 0, canvas.width, canvas.height);
  const photoBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!photoBlob) {
    setStatus("Could not capture the photo. Please try again.", "error");
    return;
  }
  await deliverFiles([new File([photoBlob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" })]);
}

function getRecorderMimeType() {
  return ["video/mp4;codecs=h264,aac", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    .find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || "";
}

function startRecording() {
  if (!cameraStream || !window.MediaRecorder) {
    setStatus("Video recording is not supported by this browser.", "error");
    return;
  }

  try {
    const mimeType = getRecorderMimeType();
    mediaRecorder = new MediaRecorder(cameraStream, mimeType ? { mimeType } : undefined);
  } catch (error) {
    setStatus("Could not start video recording on this device.", "error");
    return;
  }

  recordingChunks = [];
  discardingRecording = false;
  mediaRecorder.ondataavailable = (event) => {
    if (event.data?.size) recordingChunks.push(event.data);
  };
  mediaRecorder.onerror = () => {
    setStatus("Video recording failed. Please try again.", "error");
    stopRecording();
  };
  mediaRecorder.onstop = async () => {
    clearInterval(recordingTimer);
    recordingTimer = null;
    modal.querySelector("#mediaRecordingIndicator").hidden = true;
    modal.querySelector("#mediaCountdown").hidden = true;
    modal.querySelector("#mediaStopRecording").hidden = true;
    modal.querySelector("#mediaRecordVideo").hidden = !activeOptions?.allowsVideo;
    modal.querySelector("#mediaRecordVideo").disabled = false;
    modal.querySelector("#mediaTakePhoto").disabled = false;
    modal.querySelector("#mediaSwitchCamera").disabled = false;
    const chunks = recordingChunks;
    recordingChunks = [];
    const recorder = mediaRecorder;
    mediaRecorder = null;
    if (discardingRecording || !chunks.length) return;
    const blob = new Blob(chunks, { type: recorder?.mimeType || mimeType || "video/webm" });
    const extension = blob.type.includes("mp4") ? "mp4" : "webm";
    await deliverFiles([new File([blob], `capture-${Date.now()}.${extension}`, { type: blob.type })]);
  };

  try {
    mediaRecorder.start(250);
  } catch {
    mediaRecorder = null;
    setStatus("Could not start video recording on this device.", "error");
    return;
  }

  recordingStartedAt = Date.now();
  const stopButton = modal.querySelector("#mediaStopRecording");
  const recordButton = modal.querySelector("#mediaRecordVideo");
  const takePhotoButton = modal.querySelector("#mediaTakePhoto");
  const switchButton = modal.querySelector("#mediaSwitchCamera");
  const indicator = modal.querySelector("#mediaRecordingIndicator");
  const countdown = modal.querySelector("#mediaCountdown");
  recordButton.hidden = true;
  stopButton.hidden = false;
  takePhotoButton.disabled = true;
  switchButton.disabled = true;
  indicator.hidden = false;
  countdown.hidden = false;
  setStatus("Recording video. It will stop automatically at 30 seconds.");

  const updateCountdown = () => {
    const remaining = Math.max(0, MAX_VIDEO_SECONDS - Math.floor((Date.now() - recordingStartedAt) / 1000));
    countdown.textContent = `00:${String(remaining).padStart(2, "0")}`;
    if (!remaining) stopRecording();
  };
  updateCountdown();
  recordingTimer = setInterval(updateCountdown, 250);
}

function stopRecording() {
  clearInterval(recordingTimer);
  recordingTimer = null;
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
}

async function handleGallerySelection(event) {
  const input = event.currentTarget;
  if (input.files?.length) await deliverFiles(input.files);
  input.value = "";
}

export function closeMediaShareModal() {
  if (!modal || modal.hidden) return;
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    discardingRecording = true;
    mediaRecorder.onstop = null;
    mediaRecorder.stop();
    mediaRecorder = null;
  }
  clearInterval(recordingTimer);
  recordingTimer = null;
  stopCameraStream();
  modal.hidden = true;
  activeOptions = null;
  const resolve = resolveSelection;
  resolveSelection = null;
  resolve?.(null);
}

export function openMediaShareModal(options = {}) {
  makeModal();
  if (resolveSelection) closeMediaShareModal();

  activeOptions = {
    accept: options.accept || "image/*,video/*",
    multiple: Boolean(options.multiple),
    maxImageSize: Number(options.maxImageSize) || MAX_IMAGE_SIZE,
    maxVideoSize: Number(options.maxVideoSize) || MAX_VIDEO_SIZE,
    maxVideoSeconds: Number(options.maxVideoSeconds) || MAX_VIDEO_SECONDS,
    allowsVideo: String(options.accept || "image/*,video/*").toLowerCase().includes("video/"),
    onSelect: options.onSelect
  };

  const galleryInput = modal.querySelector("#mediaGalleryInput");
  galleryInput.accept = activeOptions.accept;
  galleryInput.multiple = activeOptions.multiple;
  modal.querySelector("#mediaCameraStage").hidden = true;
  modal.querySelector("#mediaRecordingIndicator").hidden = true;
  modal.querySelector("#mediaCountdown").hidden = true;
  modal.querySelector("#mediaTakePhoto").hidden = false;
  modal.querySelector("#mediaTakePhoto").disabled = true;
  modal.querySelector("#mediaRecordVideo").hidden = !activeOptions.allowsVideo;
  modal.querySelector("#mediaRecordVideo").disabled = true;
  modal.querySelector("#mediaStopRecording").hidden = true;
  modal.querySelector("#mediaSwitchCamera").disabled = false;
  modal.querySelector("#mediaCameraModeLabel").textContent = facingMode === "user" ? "Front camera" : "Rear camera";
  modal.querySelector("#mediaSwitchCamera").setAttribute("aria-label", `Switch to ${facingMode === "user" ? "rear" : "front"} camera`);
  setStatus("");
  resetUploadProgress();
  modal.hidden = false;

  return new Promise((resolve) => {
    resolveSelection = resolve;
  });
}

export async function uploadMediaToCloudinary(file, onProgress = () => {}) {
  if (!file) throw new Error("A file is required.");
  const mediaType = String(file.type || "").toLowerCase().split(";")[0];
  if (!ALLOWED_MEDIA_TYPES.has(mediaType)) throw new Error("Choose a supported photo or video file.");
  const isVideo = mediaType.startsWith("video/");
  const maxBytes = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
  if (file.size > maxBytes) {
    throw new Error(isVideo ? "Videos must be 300 MB or smaller." : "Photos must be 15 MB or smaller.");
  }
  if (isVideo) {
    const duration = await getVideoDuration(file);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 600) {
      throw new Error("Videos must have a readable duration of 10 minutes or less.");
    }
  }

  const uploadUrl = `${CLOUDINARY_URL}/auto/upload`;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", uploadUrl, true);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      try {
        const result = JSON.parse(request.responseText);
        if (request.status < 200 || request.status >= 300) {
          throw new Error(result.error?.message || "Media upload failed. Please try again.");
        }
        if (!result.secure_url) throw new Error("Upload returned no secure media URL.");
        resolve({ url: result.secure_url, thumbnailUrl: result.thumbnail_url || null, raw: result });
      } catch (error) {
        reject(error);
      }
    };
    request.onerror = () => reject(new Error("Media upload failed. Check your connection and try again."));
    request.onabort = () => reject(new Error("Media upload was cancelled."));
    request.ontimeout = () => reject(new Error("Media upload timed out. Please try again."));
    request.timeout = 120000;
    request.send(formData);
  });
}
