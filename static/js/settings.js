// BlockIt – Settings Script
// MIT License – Open Source

const backBtn = document.getElementById('backBtn');
const themeBtn = document.getElementById('themeBtn');
const checkUpdateBtn = document.getElementById('checkUpdateBtn');
const checkUpdateText = document.getElementById('checkUpdateText');
const updateStatus = document.getElementById('updateStatus');
const clearDataBtn = document.getElementById('clearDataBtn');
const currentVersionEl = document.getElementById('currentVersion');

// ── THEME ──────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

chrome.storage.local.get(['theme'], (data) => {
  applyTheme((data && data.theme) ? data.theme : 'dark');
});

themeBtn.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  chrome.storage.local.set({ theme: next });
});

// ── NAVIGATION ─────────────────────────────────────────────────────────────

backBtn.addEventListener('click', () => {
  window.location.href = 'popup.html';
});

// ── UPDATE CHECKER ─────────────────────────────────────────────────────────

// Load current version on open
chrome.runtime.sendMessage({ action: 'getUpdateInfo' }, (response) => {
  if (response && response.currentVersion) {
    currentVersionEl.textContent = `v${response.currentVersion}`;
  }
});

checkUpdateBtn.addEventListener('click', () => {
  // Disable button and show loading
  checkUpdateBtn.disabled = true;
  checkUpdateText.textContent = 'Checking...';
  updateStatus.className = 'update-status hidden';
  
  chrome.runtime.sendMessage({ action: 'checkForUpdates' }, (response) => {
    checkUpdateBtn.disabled = false;
    checkUpdateText.textContent = 'Check for Updates';
    
    if (!response) {
      updateStatus.className = 'update-status error';
      updateStatus.textContent = 'Failed to check for updates. Please try again.';
      return;
    }
    
    if (response.updateAvailable) {
      updateStatus.className = 'update-status info';
      updateStatus.innerHTML = `
        🎉 New version available: <strong>v${response.latestVersion}</strong>
        <br><br>
        Would you like to download it?
        <br><br>
        <a class="update-link" href="${response.releaseUrl}" target="_blank">Download v${response.latestVersion}</a>
      `;
    } else {
      updateStatus.className = 'update-status success';
      updateStatus.textContent = `✓ You're running the latest version (v${response.currentVersion})`;
    }
  });
});

// ── CLEAR DATA ─────────────────────────────────────────────────────────────

clearDataBtn.addEventListener('click', () => {
  const confirmed = confirm(
    '⚠️ WARNING ⚠️\n\n' +
    'This will permanently delete:\n' +
    '• All blocked sites\n' +
    '• All statistics\n' +
    '• All settings\n' +
    '• Break times\n\n' +
    'This action CANNOT be undone.\n\n' +
    'Are you absolutely sure?'
  );
  
  if (!confirmed) return;
  
  // Double confirmation for safety
  const doubleConfirmed = confirm(
    'Last chance!\n\n' +
    'Click OK to permanently delete all data.\n' +
    'Click Cancel to keep your data.'
  );
  
  if (!doubleConfirmed) return;
  
  clearDataBtn.disabled = true;
  clearDataBtn.textContent = 'Clearing...';
  
  chrome.runtime.sendMessage({ action: 'clearAllData' }, (response) => {
    if (response && response.success) {
      alert('✓ All data cleared successfully.\n\nThe extension has been reset to factory defaults.');
      window.location.href = 'popup.html';
    } else {
      clearDataBtn.disabled = false;
      clearDataBtn.textContent = 'Clear All Data';
      alert('Failed to clear data. Please try again.');
    }
  });
});