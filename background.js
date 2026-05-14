// ── Icon ──────────────────────────────────────────────────────────────────────

const setIcon = () => {
  const size = 128;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0052CC';
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, 20);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 82px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('J', 64, 68);
  chrome.action.setIcon({ imageData: ctx.getImageData(0, 0, size, size) });
};

// Run on every service worker activation (covers wake-ups from alarm too)
setIcon();

// ── Watch Filter Polling ───────────────────────────────────────────────────────

const ALARM_NAME   = 'jira-watch';
const POLL_MINUTES = 1;

function getSettings() {
  return new Promise(r =>
    chrome.storage.local.get(
      ['jiraUrl', 'jiraPat', 'watchJql', 'jiraUsername', 'notifyReturned', 'notifyMentions', 'notifyAssignments'],
      r
    )
  );
}

function bgFetch(jiraUrl, jiraPat, path) {
  return fetch(`${jiraUrl.replace(/\/$/, '')}/rest/api/2/${path}`, {
    credentials: 'omit',
    headers: {
      Authorization: `Bearer ${jiraPat}`,
      Accept: 'application/json',
      'X-Atlassian-Token': 'no-check',
    },
  });
}

async function jiraCount(jiraUrl, jiraPat, jql) {
  const url = `${jiraUrl.replace(/\/$/, '')}/rest/api/2/search?jql=${encodeURIComponent(jql)}&maxResults=1&fields=none`;
  const res = await fetch(url, {
    credentials: 'omit',
    headers: {
      Authorization: `Bearer ${jiraPat}`,
      Accept: 'application/json',
      'X-Atlassian-Token': 'no-check',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.total || 0;
}

// ── Badge ─────────────────────────────────────────────────────────────────────

async function refreshBadge() {
  const { watchCount = 0, dismissedReturned = [], pendingAssignments = [], mentionCount = 0 } =
    await new Promise(r =>
      chrome.storage.local.get(
        ['watchCount', 'dismissedReturned', 'pendingAssignments', 'mentionCount'], r
      )
    );
  const total = Math.max(0, watchCount - dismissedReturned.length)
              + pendingAssignments.length
              + mentionCount;
  chrome.action.setBadgeText({ text: total > 0 ? String(total) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#DE350B' });
}

// React to popup-side dismissals and mention count updates immediately
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (['watchCount', 'pendingAssignments', 'mentionCount', 'dismissedReturned'].some(k => k in changes)) {
    refreshBadge();
  }
});

async function pollWatchFilter() {
  const { jiraUrl, jiraPat, watchJql, notifyReturned } = await getSettings();
  if (!jiraUrl || !jiraPat || !watchJql) return;

  try {
    const count = await jiraCount(jiraUrl, jiraPat, watchJql);

    const { watchCount: prev } = await new Promise(r =>
      chrome.storage.local.get('watchCount', r)
    );

    // Notify only when count goes up (ticket returned to you) and notifications are enabled
    if (notifyReturned !== false && typeof prev === 'number' && count > prev) {
      const diff = count - prev;
      chrome.notifications.create(`jira-watch-${Date.now()}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon.svg'),
        title: 'Jira — Action Required',
        message: `${diff} ticket${diff > 1 ? 's' : ''} returned and waiting for your action.`,
      });
    }

    chrome.storage.local.set({ watchCount: count });
  } catch {
    // VPN not connected or Jira unreachable — fail silently
  }
}

// ── Mention Polling ───────────────────────────────────────────────────────────

async function pollMentions() {
  const { jiraUrl, jiraPat, jiraUsername, notifyMentions } = await getSettings();
  if (!jiraUrl || !jiraPat || !jiraUsername) return;

  try {
    const jql = encodeURIComponent(`comment ~ "${jiraUsername}" ORDER BY updated DESC`);
    const url = `${jiraUrl.replace(/\/$/, '')}/rest/api/2/search?jql=${jql}&maxResults=20&fields=none`;
    const res = await fetch(url, {
      credentials: 'omit',
      headers: {
        Authorization: `Bearer ${jiraPat}`,
        Accept: 'application/json',
        'X-Atlassian-Token': 'no-check',
      },
    });
    if (!res.ok) return;
    const data = await res.json();
    const currentKeys = (data.issues || []).map(i => i.key);

    const { mentionSeenKeys: prev } = await new Promise(r =>
      chrome.storage.local.get('mentionSeenKeys', r)
    );

    chrome.storage.local.set({ mentionSeenKeys: currentKeys });

    if (notifyMentions !== false && Array.isArray(prev)) {
      const newKeys = currentKeys.filter(k => !prev.includes(k));
      if (newKeys.length === 1) {
        const mentionPattern = `[~${jiraUsername}]`;
        try {
          const cr = await bgFetch(jiraUrl, jiraPat, `issue/${newKeys[0]}/comment?maxResults=100`);
          if (cr.ok) {
            const cd = await cr.json();
            const mentioning = (cd.comments || []).filter(c => c.body?.includes(mentionPattern));
            const last = mentioning[mentioning.length - 1];
            const author = last?.author?.displayName || last?.author?.name || 'Someone';
            chrome.notifications.create(`jira-mention-${Date.now()}`, {
              type: 'basic',
              iconUrl: chrome.runtime.getURL('icon.svg'),
              title: `${author} mentioned you in ${newKeys[0]}`,
              message: 'Open the Jira plugin to view the mention.',
            });
          } else { throw new Error(); }
        } catch {
          chrome.notifications.create(`jira-mention-${Date.now()}`, {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icon.svg'),
            title: `New mention in ${newKeys[0]}`,
            message: 'Open the Jira plugin to view the mention.',
          });
        }
      } else if (newKeys.length > 1) {
        chrome.notifications.create(`jira-mention-${Date.now()}`, {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icon.svg'),
          title: 'Jira — New Mentions',
          message: `You were mentioned in ${newKeys.length} tickets.`,
        });
      }
    }
  } catch {
    // VPN not connected or Jira unreachable — fail silently
  }
}

// ── Assignment Polling ────────────────────────────────────────────────────────

async function pollAssignments() {
  const { jiraUrl, jiraPat, notifyAssignments } = await getSettings();
  if (!jiraUrl || !jiraPat) return;

  try {
    const jql = encodeURIComponent('assignee = currentUser() AND resolution = Unresolved ORDER BY created DESC');
    const res = await bgFetch(jiraUrl, jiraPat, `search?jql=${jql}&maxResults=50&fields=summary`);
    if (!res.ok) return;
    const data = await res.json();
    const currentKeys = (data.issues || []).map(i => i.key);
    const issueMap = Object.fromEntries((data.issues || []).map(i => [i.key, i.fields.summary || '']));

    const { assignedSeenKeys: prev, pendingAssignments: existing = [] } = await new Promise(r =>
      chrome.storage.local.get(['assignedSeenKeys', 'pendingAssignments'], r)
    );

    const newKeys = Array.isArray(prev) ? currentKeys.filter(k => !prev.includes(k)) : [];

    if (notifyAssignments !== false && newKeys.length > 0 && Array.isArray(prev)) {
      if (newKeys.length === 1) {
        chrome.notifications.create(`jira-assign-${Date.now()}`, {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icon.svg'),
          title: 'Jira — New Assignment',
          message: `${newKeys[0]}: ${issueMap[newKeys[0]].slice(0, 100)}`,
        });
      } else {
        chrome.notifications.create(`jira-assign-${Date.now()}`, {
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icon.svg'),
          title: 'Jira — New Assignments',
          message: `${newKeys.length} new tickets assigned to you.`,
        });
      }
    }

    // Merge new keys into pending, cap at 50
    const updatedPending = [...new Set([...existing, ...newKeys])].slice(-50);
    chrome.storage.local.set({ assignedSeenKeys: currentKeys, pendingAssignments: updatedPending });
  } catch {
    // VPN not connected or Jira unreachable — fail silently
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

async function pollAll() {
  await Promise.all([pollWatchFilter(), pollMentions(), pollAssignments()]);
  refreshBadge();
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: POLL_MINUTES });
  pollAll();
});

chrome.runtime.onStartup.addListener(() => {
  // Re-create alarm (persists across restarts but be safe)
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: POLL_MINUTES });
  pollAll();
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) pollAll();
});
