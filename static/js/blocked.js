// BlockIt - Blocked Page Script
// MIT License - Open Source

// ── THEME ─────────────────────────────────────────────────────────────────────
// Apply theme immediately from storage to avoid any flash.
// We use the callback form (not async/await) so it fires as fast as possible.

const htmlEl = document.documentElement;

chrome.storage.local.get(['theme'], (data) => {
  const theme = (data && data.theme) ? data.theme : 'dark';
  htmlEl.setAttribute('data-theme', theme);
  updateThemeButton(theme);
});

function updateThemeButton(theme) {
  const label = document.getElementById('themeLabel');
  if (label) label.textContent = theme === 'dark' ? 'Light' : 'Dark';
}

document.getElementById('themeBtn').addEventListener('click', () => {
  const current = htmlEl.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  htmlEl.setAttribute('data-theme', next);
  updateThemeButton(next);
  // Persist so popup + future blocked pages stay in sync
  chrome.storage.local.set({ theme: next });
});

// ── DOMAIN RESOLUTION ─────────────────────────────────────────────────────────
// Strategy 1: ask background for the session-stored domain for this tab.
// Strategy 2: fall back to the ?site= query param in the URL.
// Strategy 3: fall back to document.referrer hostname.
// This triple-fallback means the site name is always shown correctly.

function getDomainFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const siteParam = params.get('site');
  if (siteParam) return siteParam;
  return null;
}

function getDomainFromReferrer() {
  try {
    if (document.referrer) {
      return new URL(document.referrer).hostname.replace(/^www\./, '');
    }
  } catch (_) {}
  return null;
}

// Kick off domain resolution immediately
const urlFallback = getDomainFromUrl() || getDomainFromReferrer();

// Ask background (most reliable)
chrome.runtime.sendMessage(
  { action: 'getBlockedDomain', fallback: urlFallback },
  (response) => {
    let domain = null;

    if (!chrome.runtime.lastError && response && response.success && response.domain) {
      domain = response.domain;
    } else {
      // Background couldn't help — use URL/referrer fallback
      domain = urlFallback;
    }

    if (domain) {
      initPage(domain);
    } else {
      // Absolute last resort: show a generic message
      initPage(null);
    }
  }
);

// ── PAGE INIT ────────────────────────────────────────────────────────────────

function initPage(domain) {
  const displayDomain = domain || 'this site';

  // Update page title and site name element
  document.getElementById('siteName').textContent = displayDomain;
  document.title = domain ? `Blocked: ${domain} — BlockIt` : 'Blocked — BlockIt';

// Motivational (and mostly unhinged) quotes
  const quotes = [
    // Classics
    'Stay focused. You blocked this site for a reason.',
    'Deep work beats distraction. Keep going.',
    'Your future self will thank you.',
    'Focus is a superpower. You have it.',

    // The Drill Sergeant
    'DROP AND GIVE ME 20 MINUTES OF PRODUCTIVITY, PRIVATE!',
    'IS THAT A TAB I SEE? EYES ON THE CODE, SOLDIER!',
    'YOU THINK THE ENEMY IS WATCHING CAT VIDEOS? GET BACK TO WORK!',
    'UNLESS THAT WEBSITE IS TITLED "HOW TO BE USEFUL," CLOSE IT!',
    'I DID NOT RECRUIT YOU TO SCROLL THROUGH REDDIT! MOVE IT!',
    'YOUR FOCUS IS SO WEAK IT MAKES ME SICK! BACK TO THE TASK!',

    // The Disappointed Parent/Friend
    'I’m not mad, I’m just disappointed. Get back to work.',
    'Is this really what we’re doing with our life today?',
    'Go back to work before I tell your router how ashamed I am.',
    'Your ancestors didn’t survive the Stone Age for you to watch this.',
    'Oh, look who’s trying to procrastinate again. How original.',

    // Fun & Self-Aware
    'Error 404: Willpower not found. (Just kidding, go work.)',
    'This site is a trap. Don’t be a snack.',
    'If you spend as much time working as you do trying to bypass this, you’d be a CEO by now.',
    'Congratulations! You just saved 15 minutes of your life. Use them wisely.',
    'The "Add to Blocklist" button was your smartest move today. Keep it that way.',
    'Nothing to see here but your own untapped potential. Get moving.'
  ];
  document.getElementById('motivationalText').textContent =
    quotes[Math.floor(Math.random() * quotes.length)];

  // Load stats (only if we know the domain)
  if (domain) {
    loadStats(domain);
    setupUnblock(domain);
  } else {
    // Hide stats bar if no domain known
    const statsBar = document.getElementById('statsBar');
    if (statsBar) statsBar.style.display = 'none';
    // Disable unblock button
    const btn = document.getElementById('unblockBtn');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.4'; }
  }
}

// ── STATS ────────────────────────────────────────────────────────────────────

function loadStats(domain) {
  chrome.runtime.sendMessage({ action: 'getStats', domain }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn('BlockIt: getStats error', chrome.runtime.lastError.message);
      return;
    }
    if (!response || !response.success) {
      console.warn('BlockIt: getStats returned failure', response);
      return;
    }
    document.getElementById('blockCount').textContent   = response.timesBlocked;
    document.getElementById('totalBlocked').textContent = response.sitesBlocked;
    document.getElementById('daysActive').textContent   = response.daysActive;
  });
}

// ── UNBLOCK ──────────────────────────────────────────────────────────────────

function setupUnblock(domain) {
  const btn        = document.getElementById('unblockBtn');
  const successMsg = document.getElementById('successMsg');

  btn.addEventListener('click', () => {
    btn.disabled = true;
    successMsg.classList.add('visible');

    chrome.runtime.sendMessage({ action: 'unblockSite', domain }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('BlockIt: unblockSite error', chrome.runtime.lastError.message);
        // Hard fallback: navigate directly after a delay
        setTimeout(() => { window.location.href = `https://${domain}`; }, 500);
        return;
      }
      if (!response || !response.success) {
        console.warn('BlockIt: unblockSite returned failure', response);
        setTimeout(() => { window.location.href = `https://${domain}`; }, 500);
      }
      // Background handles tab navigation after clearing rules
    });
  });
}