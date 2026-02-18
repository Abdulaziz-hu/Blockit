// BlockIt – Privacy Policy Script
// MIT License – Open Source

const backBtn = document.getElementById('backBtn');
const themeBtn = document.getElementById('themeBtn');

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
  window.location.href = 'settings.html';
});