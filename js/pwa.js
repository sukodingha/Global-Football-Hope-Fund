/**
 * GFHF Progressive Web App (PWA) Module
 * - Handles the beforeinstallprompt lifecycle
 * - Controls the install banner and homepage download buttons
 * - Registers the service worker
 */

let deferredPrompt = null;
const CACHE_KEY = 'gfhf-pwa-installed';

function isAppInstalled() {
  let installedFlag = false;
  try {
    installedFlag = localStorage.getItem(CACHE_KEY) === 'true';
  } catch {
    // Display mode detection remains available when WebView storage is blocked.
  }
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true || installedFlag;
}

function wasInstallPromptDismissed() {
  try {
    return sessionStorage.getItem('pwaPromptDismissed') === 'true';
  } catch {
    return false;
  }
}

function setDownloadButtonsVisible(visible) {
  document.querySelectorAll('.pwa-download-btn').forEach((button) => {
    button.classList.toggle('is-visible', visible);
    button.setAttribute('aria-hidden', String(!visible));
    button.tabIndex = visible ? 0 : -1;
  });
}

function removeInstallBanner() {
  document.getElementById('pwa-install-banner')?.remove();
}

function hideInstallUi() {
  removeInstallBanner();
  setDownloadButtonsVisible(false);
}

async function promptInstall() {
  if (!deferredPrompt || isAppInstalled()) return;

  const installPrompt = deferredPrompt;
  deferredPrompt = null;
  removeInstallBanner();

  try {
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome !== 'accepted') {
      try {
        sessionStorage.setItem('pwaPromptDismissed', 'true');
      } catch {
        // Session storage is optional; the install prompt still closes normally.
      }
    }
  } catch (error) {
    console.warn('Could not open the app install prompt:', error);
  }
}

function showInstallBanner() {
  if (isAppInstalled() || wasInstallPromptDismissed() || !deferredPrompt) return;
  removeInstallBanner();

  const banner = document.createElement('aside');
  banner.id = 'pwa-install-banner';
  banner.className = 'pwa-install-banner';
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-label', 'Install Global Football Hope Fund');
  banner.innerHTML = `
    <div class="pwa-install-banner-copy">
      <strong>Take GFHF with you</strong>
      <span>Install the app for quicker access to matches and community.</span>
    </div>
    <div class="pwa-install-banner-actions">
      <button class="pwa-install-banner-button" type="button" data-pwa-install>Install</button>
      <button class="pwa-install-banner-dismiss" type="button" data-pwa-dismiss>Not Yet</button>
    </div>
  `;
  banner.querySelector('[data-pwa-install]').addEventListener('click', promptInstall);
  banner.querySelector('[data-pwa-dismiss]').addEventListener('click', () => {
    try {
      sessionStorage.setItem('pwaPromptDismissed', 'true');
    } catch {
      // The banner can still be dismissed when session storage is unavailable.
    }
    removeInstallBanner();
  });
  document.body.appendChild(banner);
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;

  const isInPages = window.location.pathname.includes('/pages/');
  const swPath = isInPages ? '../sw.js' : './sw.js';
  const scope = isInPages ? '../' : './';

  navigator.serviceWorker.register(swPath, { scope }).then((registration) => {
    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }

    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (!newWorker) return;
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

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  if (isAppInstalled()) return;

  deferredPrompt = event;
  setDownloadButtonsVisible(true);
  showInstallBanner();
});

document.addEventListener('click', (event) => {
  if (event.target.closest('.pwa-download-btn')) promptInstall();
});

window.addEventListener('appinstalled', () => {
  try {
    localStorage.setItem(CACHE_KEY, 'true');
  } catch {
    // Installation state is also detected through standalone display mode.
  }
  try {
    sessionStorage.removeItem('pwaPromptDismissed');
  } catch {
    // Installed state is also detected through standalone display mode.
  }
  deferredPrompt = null;
  hideInstallUi();
});

if (isAppInstalled()) hideInstallUi();
document.getElementById('pwa-install-modal')?.remove();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', registerSW);
} else {
  registerSW();
}
