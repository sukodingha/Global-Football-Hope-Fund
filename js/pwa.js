/**
 * GFHF Progressive Web App (PWA) Module
 * - Registers the service worker
 * - Captures the beforeinstallprompt event
 * - Controls the install banner UI
 */

let deferredPrompt = null;
const CACHE_KEY = 'gfhf-pwa-installed';

// ===== DOM Refs =====
const installBanner = document.getElementById('appInstallBanner');
const installBtn = document.getElementById('installBannerBtn');
const dismissBtn = document.getElementById('dismissBannerBtn');

// ===== Check if app is already installed =====
function isAppInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true ||
         localStorage.getItem(CACHE_KEY) === 'true';
}

// ===== Hide install banner =====
function hideInstallBanner() {
  if (installBanner) {
    installBanner.hidden = true;
  }
}

// ===== Show install banner =====
function showInstallBanner() {
  if (!installBanner) return;
  if (isAppInstalled()) return;
  installBanner.hidden = false;
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
            // New content available, optionally notify user
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

  // Show the install banner
  showInstallBanner();
});

// ===== Handle Install Button Click =====
if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) {
      // If no deferred prompt, hide banner and mark as dismissed
      localStorage.setItem(CACHE_KEY, 'true');
      hideInstallBanner();
      return;
    }

    // Show the install prompt
    deferredPrompt.prompt();

    // Wait for the user to respond to the prompt
    const choiceResult = await deferredPrompt.userChoice;

    if (choiceResult.outcome === 'accepted') {
      console.log('User accepted the install prompt');
      localStorage.setItem(CACHE_KEY, 'true');
      hideInstallBanner();
    } else {
      console.log('User dismissed the install prompt');
      // Don't hide banner permanently, they might want to try again
    }

    // Clear the deferred prompt
    deferredPrompt = null;
  });
}

// ===== Handle Dismiss Button Click =====
if (dismissBtn) {
  dismissBtn.addEventListener('click', () => {
    localStorage.setItem(CACHE_KEY, 'true');
    hideInstallBanner();
  });
}

// ===== Listen for app installed event =====
window.addEventListener('appinstalled', (event) => {
  console.log('GFHF was installed successfully');
  localStorage.setItem(CACHE_KEY, 'true');
  hideInstallBanner();
  deferredPrompt = null;
});

// ===== Hide banner if already installed on load =====
if (isAppInstalled()) {
  hideInstallBanner();
}

// ===== Initialize on DOM ready =====
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    registerSW();
  });
} else {
  registerSW();
}

