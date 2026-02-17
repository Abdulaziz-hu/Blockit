// BlockIt - Background Service Worker
// MIT License - Open Source

const RULE_ID_OFFSET = 1000;

// ── INSTALL / STARTUP ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(['sites', 'globalEnabled', 'blockHits', 'installDate']);

  if (!data.sites)                      await chrome.storage.local.set({ sites: [] });
  if (!data.blockHits)                  await chrome.storage.local.set({ blockHits: {} });
  if (data.globalEnabled === undefined) await chrome.storage.local.set({ globalEnabled: true });
  if (!data.installDate)                await chrome.storage.local.set({ installDate: new Date().toISOString() });

  await syncRules();
});

chrome.runtime.onStartup.addListener(async () => {
  await syncRules();
});

// ── TAB NAVIGATION TRACKING ──────────────────────────────────────────────────
// Before the declarativeNetRequest redirect fires, store the intended domain
// in chrome.storage.session keyed by tabId. This lets blocked.js reliably know
// which site was blocked — even if Chrome strips query params in some builds.

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;
  try {
    const url = new URL(details.url);
    if (!['http:', 'https:'].includes(url.protocol)) return;

    const domain = url.hostname.replace(/^www\./, '');

    const data          = await chrome.storage.local.get(['sites', 'globalEnabled']);
    const sites         = data.sites || [];
    const globalEnabled = data.globalEnabled !== false;
    if (!globalEnabled) return;

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
  }
});

// ── HANDLERS ─────────────────────────────────────────────────────────────────

async function handleGetBlockedDomain(tabId, fallback) {
  try {
    if (tabId) {
      const key     = `pendingBlock_${tabId}`;
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
    const data        = await chrome.storage.local.get(['sites', 'blockHits', 'installDate']);
    const sites       = data.sites || [];
    const hits        = data.blockHits || {};
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
      success:      true,
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
    const data  = await chrome.storage.local.get(['sites']);
    const sites = (data.sites || []).filter(s => s.domain !== domain);
    await chrome.storage.local.set({ sites });

    if (tabId) await chrome.storage.session.remove([`pendingBlock_${tabId}`]);

    // Sync rules first — rule must be gone before the tab navigates
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
    const data     = await chrome.storage.local.get(['sites']);
    const sites    = data.sites || [];

    if (sites.find(s => s.domain === hostname)) {
      return { success: false, error: 'Already blocked', domain: hostname };
    }

    const newSite = {
      id:      Date.now(),
      domain:  hostname,
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
  const data          = await chrome.storage.local.get(['sites', 'globalEnabled']);
  const sites         = data.sites || [];
  const globalEnabled = data.globalEnabled !== false;

  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeIds     = existingRules.map(r => r.id);
  const addRules      = [];

  if (globalEnabled) {
    sites.forEach((site) => {
      if (!site.enabled) return;

      const domain         = site.domain.replace(/^www\./, '');
      const ruleId         = RULE_ID_OFFSET + (site.id % 900000);
      const requestDomains = [domain];
      if (!domain.startsWith('www.')) requestDomains.push(`www.${domain}`);

      addRules.push({
        id:       ruleId,
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