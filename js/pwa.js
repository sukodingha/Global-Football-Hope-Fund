/**
 * GFHF Progressive Web App (PWA) Module
 * - Handles the beforeinstallprompt event
 * - Controls the install modal UI
 * - Registers the service worker
 */

let deferredPrompt = null;
const CACHE_KEY = 'gfhf-pwa-installed';
const DISMISS_KEY = 'gfhf-pwa-install-dismissed';

// ===== DOM Refs =====
function ensureInstallModal() {
  const existingModal = document.getElementById('pwa-install-modal');
  if (existingModal) return existingModal;

  document.body.insertAdjacentHTML('beforeend', `
    <div id="pwa-install-modal" class="fb-modal" hidden>
      <div class="fb-modal-overlay"></div>
      <div class="fb-modal-card">
        <h3>Install GFHF?</h3>
        <p>Install the app on this device for sports updates, community chat, predictions, and donations.</p>
        <div class="pwa-install-actions">
          <button id="pwa-install-btn" class="btn" type="button">Yes</button>
          <button id="pwa-decline-btn" class="btn btn-secondary" type="button">No</button>
        </div>
      </div>
    </div>
  `);

  return document.getElementById('pwa-install-modal');
}

const installModal = ensureInstallModal();
const installBtn = document.getElementById('pwa-install-btn');
let declineBtn = document.getElementById('pwa-decline-btn');

function addDeclineOption() {
  if (!installModal || !installBtn || declineBtn) return;

  const actions = document.createElement('div');
  actions.className = 'pwa-install-actions';
  installBtn.parentNode.insertBefore(actions, installBtn);
  actions.appendChild(installBtn);

  declineBtn = document.createElement('button');
  declineBtn.id = 'pwa-decline-btn';
  declineBtn.className = 'btn btn-secondary';
  declineBtn.type = 'button';
  declineBtn.textContent = 'No';
  actions.appendChild(declineBtn);
}

addDeclineOption();

// ===== Check if app is already installed =====
function isAppInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true ||
         localStorage.getItem(CACHE_KEY) === 'true';
}

function wasInstallPromptDismissed() {
  return localStorage.getItem(DISMISS_KEY) === 'true';
}

// ===== Show install modal =====
function showInstallModal() {
  if (!installModal) return;
  if (isAppInstalled() || wasInstallPromptDismissed()) return;
  installModal.hidden = false;
}

// ===== Hide install modal =====
function hideInstallModal() {
  if (installModal) {
    installModal.hidden = true;
  }
}

// ===== Register Service Worker =====
function registerSW() {
  if ('serviceWorker' in navigator) {
    // Determine the correct SW path based on page depth
    const isInPages = window.location.pathname.includes('/pages/');
    const swPath = isInPages ? '../sw.js' : './sw.js';
    const scope = isInPages ? '../' : './';

    navigator.serviceWorker.register(swPath, { scope }).then((registration) => {
      // Check if there's a waiting service worker
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }

      // Listen for updatefound
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('New GFHF version available. Refreshing...');
            newWorker.postMessage({ type: 'SKIP_WAITING' });
            window.location.reload();
          }
        });
      });
    }).catch((error) => {
      console.error('Service Worker registration failed:', error);
    });

    // Re-register on controller change to refresh pages
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }
}

// ===== Capture Install Prompt =====
window.addEventListener('beforeinstallprompt', (event) => {
  // Prevent Chrome 67+ from automatically showing the prompt
  event.preventDefault();
  deferredPrompt = event;

  // Show the custom install modal
  showInstallModal();
});

// ===== Handle Install Button Click =====
if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) {
      hideInstallModal();
      return;
    }

    // Show the install prompt
    await deferredPrompt.prompt();

    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === 'accepted') {
      console.log('User accepted the install prompt');
      localStorage.setItem(CACHE_KEY, 'true');
    } else {
      console.log('User dismissed the install prompt');
      localStorage.setItem(DISMISS_KEY, 'true');
    }

    // Clear the deferred prompt and hide modal
    deferredPrompt = null;
    hideInstallModal();
  });
}

if (declineBtn) {
  declineBtn.addEventListener('click', () => {
    localStorage.setItem(DISMISS_KEY, 'true');
    deferredPrompt = null;
    hideInstallModal();
  });
}

// ===== Listen for app installed event =====
window.addEventListener('appinstalled', (event) => {
  console.log('GFHF was installed successfully');
  localStorage.setItem(CACHE_KEY, 'true');
  localStorage.removeItem(DISMISS_KEY);
  hideInstallModal();
  deferredPrompt = null;
});

// ===== Hide modal if already installed on load =====
if (isAppInstalled()) {
  hideInstallModal();
}

// ===== Initialize on DOM ready =====
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    registerSW();
  });
} else {
  registerSW();
}

