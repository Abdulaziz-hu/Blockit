// BlockIt – Popup Script
// MIT License – Open Source

const urlInput          = document.getElementById('urlInput');
const addBtn            = document.getElementById('addBtn');
const sitesList         = document.getElementById('sitesList');
const listCount         = document.getElementById('listCount');
const globalToggle      = document.getElementById('globalToggle');
const globalToggleLabel = document.getElementById('globalToggleLabel');
const globalToggleText  = document.getElementById('globalToggleText');
const pausedBanner      = document.getElementById('pausedBanner');
const blockCurrentBtn   = document.getElementById('blockCurrentBtn');
const currentDomainEl   = document.getElementById('currentDomain');
const clearAllBtn       = document.getElementById('clearAllBtn');
const msgEl             = document.getElementById('msg');
const themeBtn          = document.getElementById('themeBtn');
const settingsBtn       = document.getElementById('settingsBtn');
const searchInput       = document.getElementById('searchInput');
const searchClear       = document.getElementById('searchClear');
const updateBanner      = document.getElementById('updateBanner');
const updateLink        = document.getElementById('updateLink');
const updateVersion     = document.getElementById('updateVersion');
const updateClose       = document.getElementById('updateClose');

let allSites = [];
let searchQuery = '';

// ── THEME ──────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

chrome.storage.local.get(['theme'], (data) => {
  applyTheme((data && data.theme) ? data.theme : 'dark');
});

themeBtn.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next    = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  chrome.storage.local.set({ theme: next });
});

// ── SETTINGS NAVIGATION ────────────────────────────────────────────────────

settingsBtn.addEventListener('click', () => {
  window.location.href = 'settings.html';
});

// ── UPDATE CHECKER ─────────────────────────────────────────────────────────

function checkForUpdates() {
  chrome.runtime.sendMessage({ action: 'getUpdateInfo' }, (response) => {
    if (chrome.runtime.lastError || !response) return;
    
    if (response.updateAvailable) {
      updateVersion.textContent = `v${response.latestVersion} is ready`;
      updateLink.href = response.releaseUrl || '#';
      updateBanner.classList.add('visible');
    }
  });
}

updateClose.addEventListener('click', () => {
  updateBanner.classList.remove('visible');
  chrome.storage.local.set({ updateDismissed: true });
});

// Check on open if banner wasn't dismissed
chrome.storage.local.get(['updateDismissed'], (data) => {
  if (!data.updateDismissed) {
    checkForUpdates();
  }
});

// ── SEARCH ─────────────────────────────────────────────────────────────────

searchInput.addEventListener('input', (e) => {
  searchQuery = e.target.value.trim().toLowerCase();
  
  if (searchQuery) {
    searchClear.style.display = 'block';
  } else {
    searchClear.style.display = 'none';
  }
  
  filterSites();
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchQuery = '';
  searchClear.style.display = 'none';
  filterSites();
});

function filterSites() {
  const items = document.querySelectorAll('.site-item');
  let visibleCount = 0;
  
  items.forEach(item => {
    const domain = item.querySelector('.site-domain').textContent.toLowerCase();
    const matches = !searchQuery || domain.includes(searchQuery);
    
    if (matches) {
      item.classList.remove('hidden');
      visibleCount++;
    } else {
      item.classList.add('hidden');
    }
  });
  
  // Show "no results" message if searching and nothing matches
  const noResults = document.querySelector('.no-results');
  if (searchQuery && visibleCount === 0 && allSites.length > 0) {
    if (!noResults) {
      const div = document.createElement('div');
      div.className = 'no-results';
      div.innerHTML = `
        <div class="no-results-icon">🔍</div>
        <div class="no-results-text">No sites match "${searchQuery}"</div>
      `;
      sitesList.appendChild(div);
    }
  } else if (noResults) {
    noResults.remove();
  }
}

// ── HELPERS ────────────────────────────────────────────────────────────────

function normalizeDomain(input) {
  input = input.trim().toLowerCase();
  if (!input) return null;
  input = input.replace(/^(https?:\/\/)?(www\.)?/, '');
  input = input.split('/')[0].split('?')[0].split('#')[0];
  if (!input || !/^[a-z0-9]([a-z0-9\-\.]*[a-z0-9])?(\.[a-z]{2,})$/.test(input)) return null;
  return input;
}

function showMsg(text, type = 'error', duration = 2500) {
  msgEl.textContent = text;
  msgEl.className   = `msg ${type}`;
  clearTimeout(msgEl._timer);
  msgEl._timer = setTimeout(() => {
    msgEl.className  = 'msg hidden';
    msgEl.textContent = '';
  }, duration);
}

function getFaviconUrl(domain) {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

function formatDomain(domain) {
  return domain.length > 28 ? domain.slice(0, 26) + '…' : domain;
}

// ── STORAGE OPS ───────────────────────────────────────────────────────────

async function getSites() {
  const data = await chrome.storage.local.get(['sites']);
  return data.sites || [];
}

async function saveSites(sites) {
  await chrome.storage.local.set({ sites });
  await chrome.runtime.sendMessage({ action: 'syncRules' });
}

async function getGlobalEnabled() {
  const data = await chrome.storage.local.get(['globalEnabled']);
  return data.globalEnabled !== false;
}

async function setGlobalEnabled(val) {
  await chrome.storage.local.set({ globalEnabled: val });
  await chrome.runtime.sendMessage({ action: 'syncRules' });
}

// ── RENDER ────────────────────────────────────────────────────────────────

async function render() {
  const [sites, globalEnabled] = await Promise.all([getSites(), getGlobalEnabled()]);

  allSites = sites;
  
  globalToggle.checked = globalEnabled;
  globalToggleText.textContent = globalEnabled ? 'ON' : 'OFF';
  globalToggleLabel.classList.toggle('active', globalEnabled);
  pausedBanner.classList.toggle('visible', !globalEnabled);

  listCount.textContent = sites.length;

  if (sites.length === 0) {
    sitesList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🚫</div>
        <div class="empty-state-text">No sites blocked yet.<br>Add a URL above or block<br>the current tab.</div>
      </div>`;
    return;
  }

  sitesList.innerHTML = '';

  sites.slice().reverse().forEach((site) => {
    const item = document.createElement('div');
    item.className  = `site-item${site.enabled ? '' : ' disabled'}`;
    item.dataset.id = site.id;

    item.innerHTML = `
      <div class="site-favicon">
        <img
          src="${getFaviconUrl(site.domain)}"
          alt=""
          onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
        />
        <div class="site-favicon-placeholder" style="display:none">${site.domain.charAt(0).toUpperCase()}</div>
      </div>
      <span class="site-domain" title="${site.domain}">${formatDomain(site.domain)}</span>
      <div class="site-actions">
        <label class="site-toggle" title="${site.enabled ? 'Disable blocking' : 'Enable blocking'}">
          <input type="checkbox" ${site.enabled ? 'checked' : ''} data-id="${site.id}" class="site-enabled-toggle" />
          <div class="site-toggle-track"></div>
        </label>
        <button class="delete-btn" data-id="${site.id}" title="Remove site">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    `;

    sitesList.appendChild(item);
  });
  
  // Reapply search filter after render
  if (searchQuery) {
    filterSites();
  }
}

// ── EVENT HANDLERS ────────────────────────────────────────────────────────

async function addSite() {
  const raw = urlInput.value.trim();
  if (!raw) return;

  const domain = normalizeDomain(raw);
  if (!domain) {
    showMsg('Invalid domain – try "reddit.com"');
    return;
  }

  const sites = await getSites();
  if (sites.find(s => s.domain === domain)) {
    showMsg(`${domain} is already blocked`);
    return;
  }

  sites.push({ id: Date.now(), domain, enabled: true, addedAt: new Date().toISOString() });
  await saveSites(sites);

  urlInput.value = '';
  showMsg(`${domain} blocked`, 'success');
  render();
}

addBtn.addEventListener('click', addSite);
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addSite(); });

async function loadCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;

    const url = new URL(tab.url);
    if (!['http:', 'https:'].includes(url.protocol)) {
      currentDomainEl.textContent    = 'n/a';
      blockCurrentBtn.disabled       = true;
      blockCurrentBtn.style.opacity  = '0.4';
      blockCurrentBtn.style.cursor   = 'not-allowed';
      return;
    }

    const hostname = url.hostname.replace(/^www\./, '');
    currentDomainEl.textContent = formatDomain(hostname);

    const sites   = await getSites();
    const already = sites.find(s => s.domain === hostname);
    if (already) {
      currentDomainEl.textContent   = `${formatDomain(hostname)} (blocked)`;
      blockCurrentBtn.disabled      = true;
      blockCurrentBtn.style.opacity = '0.5';
      blockCurrentBtn.style.cursor  = 'default';
    }
  } catch (_) {
    currentDomainEl.textContent = '—';
  }
}

blockCurrentBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const result = await chrome.runtime.sendMessage({ action: 'blockCurrentTab', tabId: tab.id });

  if (result.success) {
    showMsg(`${result.domain} blocked`, 'success');
    blockCurrentBtn.disabled      = true;
    blockCurrentBtn.style.opacity = '0.5';
    currentDomainEl.textContent   = `${formatDomain(result.domain)} (blocked)`;
    render();
  } else if (result.error === 'Already blocked') {
    showMsg(`${result.domain} is already blocked`);
  } else {
    showMsg(result.error || 'Could not block this page');
  }
});

globalToggle.addEventListener('change', async () => {
  await setGlobalEnabled(globalToggle.checked);
  render();
});

sitesList.addEventListener('change', async (e) => {
  if (!e.target.classList.contains('site-enabled-toggle')) return;
  const id   = Number(e.target.dataset.id);
  const sites = await getSites();
  const site  = sites.find(s => s.id === id);
  if (!site) return;
  site.enabled = e.target.checked;
  await saveSites(sites);
  render();
});

sitesList.addEventListener('click', async (e) => {
  const btn = e.target.closest('.delete-btn');
  if (!btn) return;
  const id       = Number(btn.dataset.id);
  const sites    = await getSites();
  const filtered = sites.filter(s => s.id !== id);
  await saveSites(filtered);
  render();
  await loadCurrentTab();
});

clearAllBtn.addEventListener('click', async () => {
  if (!confirm('Remove all blocked sites?')) return;
  await saveSites([]);
  render();
  loadCurrentTab();
});

// ── INIT ──────────────────────────────────────────────────────────────────

(async () => {
  await render();
  await loadCurrentTab();
})();