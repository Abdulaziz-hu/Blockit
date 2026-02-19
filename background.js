// BlockIt - Background Service Worker
// MIT License - Open Source

const RULE_ID_OFFSET = 1000;
const GITHUB_API_URL = 'https://api.github.com/repos/Abdulaziz-hu/blockit/releases/latest';
const CURRENT_VERSION = '1.3.1';

// ── INSTALL / STARTUP ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get([
    'sites', 'globalEnabled', 'blockHits', 'installDate', 'breakTimes', 'lastUpdateCheck'
  ]);

  if (!data.sites)                      await chrome.storage.local.set({ sites: [] });
  if (!data.blockHits)                  await chrome.storage.local.set({ blockHits: {} });
  if (!data.breakTimes)                 await chrome.storage.local.set({ breakTimes: {} });
  if (data.globalEnabled === undefined) await chrome.storage.local.set({ globalEnabled: true });
  if (!data.installDate)                await chrome.storage.local.set({ installDate: new Date().toISOString() });
  if (!data.lastUpdateCheck)            await chrome.storage.local.set({ lastUpdateCheck: Date.now() });

  await syncRules();
  checkForUpdates();
});

chrome.runtime.onStartup.addListener(async () => {
  await syncRules();
  await cleanExpiredBreakTimes();

  const data = await chrome.storage.local.get(['lastUpdateCheck']);
  const lastCheck = data.lastUpdateCheck || 0;
  const oneDayMs = 24 * 60 * 60 * 1000;

  if (Date.now() - lastCheck > oneDayMs) {
    checkForUpdates();
  }
});

// ── UPDATE CHECKER ───────────────────────────────────────────────────────────

async function checkForUpdates() {
  try {
    const response = await fetch(GITHUB_API_URL);
    if (!response.ok) return;

    const release = await response.json();
    const latestVersion = release.tag_name.replace(/^v/, '');
    const updateAvailable = compareVersions(latestVersion, CURRENT_VERSION) > 0;

    await chrome.storage.local.set({
      lastUpdateCheck: Date.now(),
      latestVersion,
      updateAvailable,
      releaseUrl: release.html_url
    });

    // If a new update is detected, clear the dismissed flag so the banner shows again
    if (updateAvailable) {
      const existing = await chrome.storage.local.get(['dismissedVersion']);
      if (existing.dismissedVersion !== latestVersion) {
        await chrome.storage.local.remove('updateDismissed');
      }
    }
  } catch (e) {
    console.warn('BlockIt: Update check failed', e);
  }
}

function compareVersions(a, b) {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const diff = (aParts[i] || 0) - (bParts[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// ── BREAK TIME MANAGEMENT ────────────────────────────────────────────────────

async function cleanExpiredBreakTimes() {
  const data = await chrome.storage.local.get(['breakTimes']);
  const breakTimes = data.breakTimes || {};
  const now = Date.now();
  let changed = false;
  const expiredDomains = [];

  for (const domain in breakTimes) {
    if (breakTimes[domain] < now) {
      delete breakTimes[domain];
      expiredDomains.push(domain);
      changed = true;
    }
  }

  if (changed) {
    await chrome.storage.local.set({ breakTimes });
    await syncRules();

    // Refresh any tabs showing expired domains
    for (const domain of expiredDomains) {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.url) {
          try {
            const url = new URL(tab.url);
            const tabDomain = url.hostname.replace(/^www\./, '');
            if (tabDomain === domain) {
              chrome.tabs.reload(tab.id);
            }
          } catch (_) {}
        }
      }
    }
  }
}

// Run cleanup every 30 seconds
setInterval(cleanExpiredBreakTimes, 30000);

// ── TAB NAVIGATION TRACKING ──────────────────────────────────────────────────

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;
  try {
    const url = new URL(details.url);
    if (!['http:', 'https:'].includes(url.protocol)) return;

    const domain = url.hostname.replace(/^www\./, '');

    const data = await chrome.storage.local.get(['sites', 'globalEnabled', 'breakTimes']);
    const sites = data.sites || [];
    const globalEnabled = data.globalEnabled !== false;
    const breakTimes = data.breakTimes || {};

    if (!globalEnabled) return;

    // Check if domain has active break time
    if (breakTimes[domain] && breakTimes[domain] > Date.now()) {
      return; // Allow access during break
    }

    const blocked = sites.find(s => s.enabled && s.domain === domain);
    if (!blocked) return;

    await chrome.storage.session.set({ [`pendingBlock_${details.tabId}`]: domain });
  } catch (_) {}
}, { url: [{ schemes: ['http', 'https'] }] });

// ── MESSAGE HANDLER ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {

    case 'syncRules':
      syncRules().then(() => sendResponse({ success: true }));
      return true;

    case 'blockCurrentTab':
      handleBlockCurrentTab(message.tabId).then(result => sendResponse(result));
      return true;

    case 'getBlockedDomain':
      handleGetBlockedDomain(sender.tab?.id, message.fallback).then(result => sendResponse(result));
      return true;

    case 'getStats':
      handleGetStats(message.domain).then(result => sendResponse(result));
      return true;

    case 'unblockSite':
      handleUnblockSite(message.domain, sender.tab?.id).then(result => sendResponse(result));
      return true;

    case 'setBreakTime':
      handleSetBreakTime(message.domain, message.minutes, sender.tab?.id).then(result => sendResponse(result));
      return true;

    case 'checkForUpdates':
      checkForUpdates().then(() => {
        chrome.storage.local.get(['updateAvailable', 'latestVersion', 'releaseUrl'], (data) => {
          sendResponse({
            updateAvailable: data.updateAvailable || false,
            currentVersion: CURRENT_VERSION,
            latestVersion: data.latestVersion || CURRENT_VERSION,
            releaseUrl: data.releaseUrl || ''
          });
        });
      });
      return true;

    case 'getUpdateInfo':
      chrome.storage.local.get(['updateAvailable', 'latestVersion', 'releaseUrl'], (data) => {
        sendResponse({
          updateAvailable: data.updateAvailable || false,
          currentVersion: CURRENT_VERSION,
          latestVersion: data.latestVersion || CURRENT_VERSION,
          releaseUrl: data.releaseUrl || ''
        });
      });
      return true;

    case 'clearAllData':
      handleClearAllData().then(result => sendResponse(result));
      return true;
  }
});

// ── HANDLERS ─────────────────────────────────────────────────────────────────

async function handleClearAllData() {
  try {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();

    // Re-initialize with defaults
    await chrome.storage.local.set({
      sites: [],
      globalEnabled: true,
      blockHits: {},
      breakTimes: {},
      installDate: new Date().toISOString(),
      lastUpdateCheck: Date.now()
    });

    await syncRules();

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleSetBreakTime(domain, minutes, tabId) {
  try {
    const expiresAt = Date.now() + (minutes * 60 * 1000);
    const data = await chrome.storage.local.get(['breakTimes']);
    const breakTimes = data.breakTimes || {};

    breakTimes[domain] = expiresAt;
    await chrome.storage.local.set({ breakTimes });

    // Clear session marker for this tab
    if (tabId) {
      await chrome.storage.session.remove([`pendingBlock_${tabId}`]);
    }

    // Sync rules to remove the block FIRST, then redirect
    await syncRules();

    // Give the declarativeNetRequest rules a moment to propagate, then navigate
    if (tabId) {
      setTimeout(() => {
        chrome.tabs.update(tabId, { url: `https://${domain}` }).catch(() => {});
      }, 500);
    }

    return { success: true, domain, expiresAt };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleGetBlockedDomain(tabId, fallback) {
  try {
    if (tabId) {
      const key = `pendingBlock_${tabId}`;
      const session = await chrome.storage.session.get([key]);
      if (session[key]) return { success: true, domain: session[key] };
    }
    if (fallback) return { success: true, domain: fallback };
    return { success: false, domain: null };
  } catch (e) {
    return { success: false, domain: fallback || null, error: e.message };
  }
}

async function handleGetStats(domain) {
  try {
    const data = await chrome.storage.local.get(['sites', 'blockHits', 'installDate']);
    const sites = data.sites || [];
    const hits = data.blockHits || {};
    const installDate = data.installDate;

    hits[domain] = (hits[domain] || 0) + 1;
    await chrome.storage.local.set({ blockHits: hits });

    let daysActive = 1;
    if (installDate) {
      daysActive = Math.max(1, Math.round(
        (Date.now() - new Date(installDate).getTime()) / 86400000
      ));
    }

    return {
      success: true,
      timesBlocked: hits[domain],
      sitesBlocked: sites.filter(s => s.enabled).length,
      daysActive
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleUnblockSite(domain, tabId) {
  try {
    const data = await chrome.storage.local.get(['sites']);
    const sites = (data.sites || []).filter(s => s.domain !== domain);
    await chrome.storage.local.set({ sites });

    if (tabId) await chrome.storage.session.remove([`pendingBlock_${tabId}`]);

    await syncRules();

    if (tabId) {
      setTimeout(() => {
        chrome.tabs.update(tabId, { url: `https://${domain}` }).catch(() => {});
      }, 350);
    }

    return { success: true, domain };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleBlockCurrentTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) return { success: false, error: 'No URL' };

    const url = new URL(tab.url);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { success: false, error: 'Cannot block this page type' };
    }

    const hostname = url.hostname.replace(/^www\./, '');
    const data = await chrome.storage.local.get(['sites']);
    const sites = data.sites || [];

    if (sites.find(s => s.domain === hostname)) {
      return { success: false, error: 'Already blocked', domain: hostname };
    }

    const newSite = {
      id: Date.now(),
      domain: hostname,
      enabled: true,
      addedAt: new Date().toISOString()
    };

    sites.push(newSite);
    await chrome.storage.local.set({ sites });
    await syncRules();

    return { success: true, domain: hostname, site: newSite };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── SYNC RULES ────────────────────────────────────────────────────────────────

async function syncRules() {
  const data = await chrome.storage.local.get(['sites', 'globalEnabled', 'breakTimes']);
  const sites = data.sites || [];
  const globalEnabled = data.globalEnabled !== false;
  const breakTimes = data.breakTimes || {};
  const now = Date.now();

  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeIds = existingRules.map(r => r.id);
  const addRules = [];

  if (globalEnabled) {
    sites.forEach((site) => {
      if (!site.enabled) return;

      // Skip if domain has active break time
      if (breakTimes[site.domain] && breakTimes[site.domain] > now) {
        return;
      }

      const domain = site.domain.replace(/^www\./, '');
      const ruleId = RULE_ID_OFFSET + (site.id % 900000);
      const requestDomains = [domain];
      if (!domain.startsWith('www.')) requestDomains.push(`www.${domain}`);

      addRules.push({
        id: ruleId,
        priority: 1,
        action: {
          type: 'redirect',
          redirect: {
            extensionPath: '/blocked.html?site=' + encodeURIComponent(domain)
          }
        },
        condition: {
          requestDomains,
          resourceTypes: ['main_frame']
        }
      });
    });
  }

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds, addRules });
}