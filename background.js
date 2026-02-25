// BlockIt - Background Service Worker
// MIT License - Open Source
// v1.4.0

const RULE_ID_OFFSET = 1000;
const GITHUB_API_URL = 'https://api.github.com/repos/Abdulaziz-hu/blockit/releases/latest';
const CURRENT_VERSION = '1.4.1';

// ── INSTALL / STARTUP ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get([
    'sites', 'globalEnabled', 'blockHits', 'installDate', 'breakTimes', 'lastUpdateCheck', 'schedules'
  ]);

  if (!data.sites)                      await chrome.storage.local.set({ sites: [] });
  if (!data.blockHits)                  await chrome.storage.local.set({ blockHits: {} });
  if (!data.breakTimes)                 await chrome.storage.local.set({ breakTimes: {} });
  if (!data.schedules)                  await chrome.storage.local.set({ schedules: {} });
  if (data.globalEnabled === undefined) await chrome.storage.local.set({ globalEnabled: true });
  if (!data.installDate)                await chrome.storage.local.set({ installDate: new Date().toISOString() });
  if (!data.lastUpdateCheck)            await chrome.storage.local.set({ lastUpdateCheck: Date.now() });

  await syncRules();
  await updateBadge();
  checkForUpdates();
});

chrome.runtime.onStartup.addListener(async () => {
  await syncRules();
  await cleanExpiredBreakTimes();
  await updateBadge();

  const data = await chrome.storage.local.get(['lastUpdateCheck']);
  const lastCheck = data.lastUpdateCheck || 0;
  const oneDayMs = 24 * 60 * 60 * 1000;

  if (Date.now() - lastCheck > oneDayMs) {
    checkForUpdates();
  }
});

// ── BADGE ────────────────────────────────────────────────────────────────────

async function updateBadge() {
  try {
    const data = await chrome.storage.local.get(['sites', 'globalEnabled']);
    const sites = data.sites || [];
    const globalEnabled = data.globalEnabled !== false;
    const activeCount = globalEnabled ? sites.filter(s => s.enabled).length : 0;

    if (activeCount > 0) {
      await chrome.action.setBadgeText({ text: String(activeCount) });
      await chrome.action.setBadgeBackgroundColor({ color: '#e8ff00' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch (_) {}
}

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

// ── SCHEDULE HELPERS ─────────────────────────────────────────────────────────

/**
 * Check if a site's schedule is currently active (blocking should apply).
 * A schedule looks like: { enabled: true, days: [0,1,2,3,4], startTime: "09:00", endTime: "17:00" }
 * Days: 0=Sun, 1=Mon, ... 6=Sat
 */
function isScheduleActive(schedule) {
  if (!schedule || !schedule.enabled) return true; // No schedule = always block
  const now = new Date();
  const dayOfWeek = now.getDay();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  if (!schedule.days || !schedule.days.includes(dayOfWeek)) return false;

  const [startH, startM] = (schedule.startTime || '00:00').split(':').map(Number);
  const [endH, endM] = (schedule.endTime || '23:59').split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Overnight schedule (e.g. 22:00 - 06:00)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
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

// Run cleanup every 30 seconds & re-check schedules
setInterval(async () => {
  await cleanExpiredBreakTimes();
  await syncRules(); // Re-sync to apply schedule changes
  await updateBadge();
}, 30000);

// ── TAB NAVIGATION TRACKING ──────────────────────────────────────────────────

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;
  try {
    const url = new URL(details.url);
    if (!['http:', 'https:'].includes(url.protocol)) return;

    const domain = url.hostname.replace(/^www\./, '');

    const data = await chrome.storage.local.get(['sites', 'globalEnabled', 'breakTimes', 'schedules']);
    const sites = data.sites || [];
    const globalEnabled = data.globalEnabled !== false;
    const breakTimes = data.breakTimes || {};
    const schedules = data.schedules || {};

    if (!globalEnabled) return;

    if (breakTimes[domain] && breakTimes[domain] > Date.now()) {
      return;
    }

    const blocked = sites.find(s => s.enabled && domainMatches(s.domain, domain));
    if (!blocked) return;

    // Check schedule for this site
    const schedule = schedules[blocked.domain];
    if (!isScheduleActive(schedule)) return;

    await chrome.storage.session.set({ [`pendingBlock_${details.tabId}`]: blocked.domain });
  } catch (_) {}
}, { url: [{ schemes: ['http', 'https'] }] });

/**
 * Match a pattern (supports wildcard *) against a real domain.
 * e.g. "*.reddit.com" matches "old.reddit.com"
 */
function domainMatches(pattern, domain) {
  if (pattern === domain) return true;
  if (pattern.startsWith('*.')) {
    const base = pattern.slice(2);
    return domain === base || domain.endsWith('.' + base);
  }
  return false;
}

// ── MESSAGE HANDLER ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {

    case 'syncRules':
      syncRules()
        .then(() => updateBadge())
        .then(() => sendResponse({ success: true }));
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

    case 'exportData':
      handleExportData().then(result => sendResponse(result));
      return true;

    case 'importData':
      handleImportData(message.data).then(result => sendResponse(result));
      return true;

    case 'setSchedule':
      handleSetSchedule(message.domain, message.schedule).then(result => sendResponse(result));
      return true;

    case 'getSchedules':
      chrome.storage.local.get(['schedules'], (data) => {
        sendResponse({ success: true, schedules: data.schedules || {} });
      });
      return true;
  }
});

// ── HANDLERS ─────────────────────────────────────────────────────────────────

async function handleClearAllData() {
  try {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();

    await chrome.storage.local.set({
      sites: [],
      globalEnabled: true,
      blockHits: {},
      breakTimes: {},
      schedules: {},
      installDate: new Date().toISOString(),
      lastUpdateCheck: Date.now()
    });

    await syncRules();
    await updateBadge();

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleExportData() {
  try {
    const data = await chrome.storage.local.get([
      'sites', 'globalEnabled', 'blockHits', 'installDate', 'schedules'
    ]);

    const exportObj = {
      version: CURRENT_VERSION,
      exportedAt: new Date().toISOString(),
      sites: data.sites || [],
      globalEnabled: data.globalEnabled !== false,
      blockHits: data.blockHits || {},
      schedules: data.schedules || {},
      installDate: data.installDate || new Date().toISOString()
    };

    return { success: true, data: exportObj };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleImportData(importObj) {
  try {
    if (!importObj || !Array.isArray(importObj.sites)) {
      return { success: false, error: 'Invalid import file format.' };
    }

    // Merge or replace — we merge by domain to avoid duplicates
    const existing = await chrome.storage.local.get(['sites', 'blockHits', 'schedules']);
    const existingSites = existing.sites || [];
    const existingHits = existing.blockHits || {};
    const existingSchedules = existing.schedules || {};

    const mergedSitesMap = {};
    for (const s of existingSites) mergedSitesMap[s.domain] = s;
    for (const s of importObj.sites) {
      if (s.domain) mergedSitesMap[s.domain] = {
        id: s.id || Date.now() + Math.random(),
        domain: s.domain,
        enabled: s.enabled !== false,
        addedAt: s.addedAt || new Date().toISOString()
      };
    }

    const mergedHits = { ...existingHits, ...(importObj.blockHits || {}) };
    const mergedSchedules = { ...existingSchedules, ...(importObj.schedules || {}) };

    await chrome.storage.local.set({
      sites: Object.values(mergedSitesMap),
      blockHits: mergedHits,
      schedules: mergedSchedules
    });

    await syncRules();
    await updateBadge();

    return { success: true, count: Object.values(mergedSitesMap).length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function handleSetSchedule(domain, schedule) {
  try {
    const data = await chrome.storage.local.get(['schedules']);
    const schedules = data.schedules || {};

    if (schedule === null) {
      delete schedules[domain];
    } else {
      schedules[domain] = schedule;
    }

    await chrome.storage.local.set({ schedules });
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

    if (tabId) {
      await chrome.storage.session.remove([`pendingBlock_${tabId}`]);
    }

    await syncRules();

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
    await updateBadge();

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
    await updateBadge();

    return { success: true, domain: hostname, site: newSite };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── SYNC RULES ────────────────────────────────────────────────────────────────

async function syncRules() {
  const data = await chrome.storage.local.get(['sites', 'globalEnabled', 'breakTimes', 'schedules']);
  const sites = data.sites || [];
  const globalEnabled = data.globalEnabled !== false;
  const breakTimes = data.breakTimes || {};
  const schedules = data.schedules || {};
  const now = Date.now();

  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeIds = existingRules.map(r => r.id);
  const addRules = [];

  if (globalEnabled) {
    for (const site of sites) {
      if (!site.enabled) continue;

      // Skip if domain has active break time
      if (breakTimes[site.domain] && breakTimes[site.domain] > now) continue;

      // Skip if schedule says we shouldn't block right now
      const schedule = schedules[site.domain];
      if (!isScheduleActive(schedule)) continue;

      const domain = site.domain.replace(/^www\./, '');
      const ruleId = RULE_ID_OFFSET + (Math.abs(hashCode(domain)) % 900000);

      // Handle wildcard domains like *.reddit.com
      let requestDomains;
      if (domain.startsWith('*.')) {
        // We can't use wildcards in declarativeNetRequest requestDomains directly
        // so we use urlFilter instead
        const base = domain.slice(2);
        addRules.push({
          id: ruleId,
          priority: 1,
          action: {
            type: 'redirect',
            redirect: {
              extensionPath: '/blocked.html?site=' + encodeURIComponent(base)
            }
          },
          condition: {
            urlFilter: `||${base}^`,
            resourceTypes: ['main_frame']
          }
        });
        continue;
      }

      requestDomains = [domain];
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
    }
  }

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds, addRules });
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}