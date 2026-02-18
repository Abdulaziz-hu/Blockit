// BlockIt - Blocked Page Script
// MIT License - Open Source

// ── THEME ─────────────────────────────────────────────────────────────────────

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
  chrome.storage.local.set({ theme: next });
});

// ── DOMAIN RESOLUTION ─────────────────────────────────────────────────────────

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

const urlFallback = getDomainFromUrl() || getDomainFromReferrer();

chrome.runtime.sendMessage(
  { action: 'getBlockedDomain', fallback: urlFallback },
  (response) => {
    let domain = null;

    if (!chrome.runtime.lastError && response && response.success && response.domain) {
      domain = response.domain;
    } else {
      domain = urlFallback;
    }

    if (domain) {
      initPage(domain);
    } else {
      initPage(null);
    }
  }
);

// ── PAGE INIT ────────────────────────────────────────────────────────────────

function initPage(domain) {
  const displayDomain = domain || 'this site';

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

  if (domain) {
    loadStats(domain);
    setupUnblock(domain);
    setupBreakTime(domain);
  } else {
    const statsBar = document.getElementById('statsBar');
    if (statsBar) statsBar.style.display = 'none';
    const btn = document.getElementById('unblockBtn');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.4'; }
    const breakSection = document.getElementById('breakTimeSection');
    if (breakSection) breakSection.style.display = 'none';
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
    successMsg.textContent = 'Unblocked — redirecting…';
    successMsg.classList.add('visible');

    chrome.runtime.sendMessage({ action: 'unblockSite', domain }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('BlockIt: unblockSite error', chrome.runtime.lastError.message);
        setTimeout(() => { window.location.href = `https://${domain}`; }, 500);
        return;
      }
      if (!response || !response.success) {
        console.warn('BlockIt: unblockSite returned failure', response);
        setTimeout(() => { window.location.href = `https://${domain}`; }, 500);
      }
    });
  });
}

// ── BREAK TIME ───────────────────────────────────────────────────────────────

function setupBreakTime(domain) {
  const breakButtons = document.querySelectorAll('.btn-break');
  const successMsg   = document.getElementById('successMsg');
  const unblockBtn   = document.getElementById('unblockBtn');
  
  breakButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const minutes = parseInt(btn.dataset.minutes, 10);
      
      // Disable all buttons
      breakButtons.forEach(b => b.disabled = true);
      unblockBtn.disabled = true;
      
      successMsg.textContent = `${minutes} min break granted — redirecting…`;
      successMsg.classList.add('visible');
      
      chrome.runtime.sendMessage({ action: 'setBreakTime', domain, minutes }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('BlockIt: setBreakTime error', chrome.runtime.lastError.message);
          setTimeout(() => { window.location.href = `https://${domain}`; }, 500);
          return;
        }
        if (!response || !response.success) {
          console.warn('BlockIt: setBreakTime returned failure', response);
          setTimeout(() => { window.location.href = `https://${domain}`; }, 500);
        }
      });
    });
  });
}