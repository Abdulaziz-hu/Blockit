// BlockIt – Settings Script
// MIT License – Open Source
// v1.4.0

const backBtn         = document.getElementById('backBtn');
const themeBtn        = document.getElementById('themeBtn');
const checkUpdateBtn  = document.getElementById('checkUpdateBtn');
const checkUpdateText = document.getElementById('checkUpdateText');
const updateStatus    = document.getElementById('updateStatus');
const clearDataBtn    = document.getElementById('clearDataBtn');
const currentVersionEl = document.getElementById('currentVersion');
const exportBtn       = document.getElementById('exportBtn');
const importFileInput = document.getElementById('importFileInput');
const ioStatus        = document.getElementById('ioStatus');
const importLabel     = document.getElementById('importBtn'); // <label> element

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

chrome.runtime.sendMessage({ action: 'getUpdateInfo' }, (response) => {
  if (response && response.currentVersion) {
    currentVersionEl.textContent = `v${response.currentVersion}`;
  }
});

checkUpdateBtn.addEventListener('click', () => {
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
        <a class="update-link" href="${response.releaseUrl}" target="_blank">Download v${response.latestVersion}</a>
      `;
    } else {
      updateStatus.className = 'update-status success';
      updateStatus.textContent = `✓ You're running the latest version (v${response.currentVersion})`;
    }
  });
});

// ── IO STATUS HELPER ───────────────────────────────────────────────────────

function showIOStatus(text, type = 'success', duration = 4000) {
  ioStatus.className = `io-status ${type}`;
  ioStatus.textContent = text;
  clearTimeout(ioStatus._timer);
  if (duration) {
    ioStatus._timer = setTimeout(() => {
      ioStatus.className = 'io-status hidden';
    }, duration);
  }
}

// ── EXPORT ────────────────────────────────────────────────────────────────
// Chrome extensions block URL.createObjectURL() due to CSP.
// We use a data: URI with chrome.downloads (if available) or a plain <a> with
// a base64 data URI, which works reliably inside extension pages.

exportBtn.addEventListener('click', async () => {
  exportBtn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({ action: 'exportData' });

    if (!response || !response.success) {
      showIOStatus('Export failed. Please try again.', 'error');
      return;
    }

    const json = JSON.stringify(response.data, null, 2);
    const date = new Date().toISOString().slice(0, 10);
    const filename = `blockit-backup-${date}.json`;

    // Encode as base64 data URI — works in extension pages without CSP issues
    const dataUri = 'data:application/json;base64,' + btoa(unescape(encodeURIComponent(json)));

    // Use chrome.downloads if available (MV3 extensions can have this permission)
    if (chrome.downloads) {
      chrome.downloads.download({ url: dataUri, filename, saveAs: true }, (downloadId) => {
        if (chrome.runtime.lastError || downloadId === undefined) {
          // Fallback to anchor click if downloads API fails
          triggerAnchorDownload(dataUri, filename);
        }
      });
    } else {
      triggerAnchorDownload(dataUri, filename);
    }

    const count = response.data.sites ? response.data.sites.length : 0;
    showIOStatus(`✓ Exported ${count} site${count !== 1 ? 's' : ''} successfully.`, 'success');
  } catch (e) {
    showIOStatus('Export failed: ' + e.message, 'error');
  } finally {
    exportBtn.disabled = false;
  }
});

function triggerAnchorDownload(dataUri, filename) {
  const a = document.createElement('a');
  a.href = dataUri;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 100);
}

// ── IMPORT ────────────────────────────────────────────────────────────────
// Chrome blocks programmatic .click() on <input type="file"> from extension
// pages. The workaround: the file input IS the button (rendered via a <label>
// wrapper in HTML), so the user's real click on the label opens the picker.
// We listen for the `change` event and process the file with FileReader.

importFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  importLabel.style.pointerEvents = 'none';
  importLabel.style.opacity = '0.5';
  importFileInput.value = ''; // allow re-selecting the same file next time

  const reader = new FileReader();

  reader.onload = async (evt) => {
    try {
      let parsed;
      try {
        parsed = JSON.parse(evt.target.result);
      } catch (_) {
        showIOStatus('Invalid JSON file. Please select a valid BlockIt backup.', 'error');
        return;
      }

      const response = await chrome.runtime.sendMessage({ action: 'importData', data: parsed });

      if (!response || !response.success) {
        showIOStatus(response?.error || 'Import failed. Please try again.', 'error');
        return;
      }

      showIOStatus(`✓ Import complete. ${response.count} site${response.count !== 1 ? 's' : ''} in blocklist.`, 'success');
    } catch (err) {
      showIOStatus('Import failed: ' + err.message, 'error');
    } finally {
      importLabel.style.pointerEvents = '';
      importLabel.style.opacity = '';
    }
  };

  reader.onerror = () => {
    showIOStatus('Could not read file. Please try again.', 'error');
    importLabel.style.pointerEvents = '';
    importLabel.style.opacity = '';
  };

  reader.readAsText(file);
});

// ── CLEAR DATA ─────────────────────────────────────────────────────────────

clearDataBtn.addEventListener('click', () => {
  const confirmed = confirm(
    '⚠️ WARNING ⚠️\n\n' +
    'This will permanently delete:\n' +
    '• All blocked sites\n' +
    '• All statistics\n' +
    '• All settings & schedules\n' +
    '• Break times\n\n' +
    'This action CANNOT be undone.\n\n' +
    'Are you absolutely sure?'
  );

  if (!confirmed) return;

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
      clearDataBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        Clear All Data`;
      alert('Failed to clear data. Please try again.');
    }
  });
});