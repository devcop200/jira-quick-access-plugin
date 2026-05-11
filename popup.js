// ── Helpers ──────────────────────────────────────────────────────────────────

function statusClass(category) {
  const map = { new: 'todo', indeterminate: 'inprog', done: 'done' };
  return 'status-' + (map[category] || 'todo');
}

function statusLabel(name) {
  return name || 'Unknown';
}

function priorityClass(name) {
  if (!name) return 'pri-medium';
  const n = name.toLowerCase();
  if (n === 'highest') return 'pri-highest';
  if (n === 'high') return 'pri-high';
  if (n === 'low') return 'pri-low';
  if (n === 'lowest') return 'pri-lowest';
  return 'pri-medium';
}

function issueTypeColor(name) {
  const n = (name || '').toLowerCase();
  if (n === 'bug') return '#e53935';
  if (n.includes('epic')) return '#8750c8';
  if (n.includes('story')) return '#4caf50';
  if (n.includes('task')) return '#0052cc';
  if (n.includes('sub-task')) return '#66b2ff';
  return '#42526e';
}

function issueTypeInitial(name) {
  if (!name) return '?';
  const n = name.toLowerCase();
  if (n === 'bug') return 'B';
  if (n.includes('epic')) return 'E';
  if (n.includes('story')) return 'S';
  return name[0].toUpperCase();
}

function showSpinner(container) {
  container.innerHTML = '<div class="loading-spinner"></div>';
}

function showMessage(container, msg, isError = false) {
  container.innerHTML = `<div class="state-msg ${isError ? 'error-msg' : ''}">${msg}</div>`;
}

function friendlyError(err) {
  if (err.message === 'NOT_CONFIGURED') return 'Jira is not configured.';
  if (err.message === 'UNAUTHORIZED') return 'Invalid token — check your settings.';
  if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
    return 'Cannot reach Jira.<br/>Make sure VPN is connected.';
  }
  return `Error: ${err.message}`;
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

async function openIssue(key) {
  const url = await JiraAPI.issueUrl(key);
  chrome.tabs.create({ url });
}

function renderIssues(issues) {
  if (!issues.length) return '<div class="state-msg">No issues found.</div>';

  return issues.map(issue => {
    const f = issue.fields;
    const statusCat  = f.status?.statusCategory?.key || 'new';
    const prioName   = f.priority?.name || 'Medium';
    const typeName   = f.issuetype?.name || '';
    const statusName = f.status?.name || '';

    return `
      <div class="issue-item" data-key="${issue.key}">
        <div class="issue-type-icon" style="background:${issueTypeColor(typeName)}" title="${typeName}">
          ${issueTypeInitial(typeName)}
        </div>
        <div class="issue-body">
          <div class="issue-key">${issue.key}</div>
          <div class="issue-summary" title="${escHtml(f.summary || '')}">${escHtml(f.summary || '(no summary)')}</div>
          <div class="issue-meta">
            <span class="status-badge ${statusClass(statusCat)}">${statusLabel(statusName)}</span>
            <span class="priority-dot ${priorityClass(prioName)}" title="${prioName}"></span>
          </div>
        </div>
        <button class="expand-btn" data-key="${issue.key}" title="Show details">›</button>
      </div>
      <div class="issue-detail" data-detail-key="${issue.key}"></div>
    `;
  }).join('');
}

function bindIssueClicks(container) {
  container.querySelectorAll('.issue-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.expand-btn')) return;
      openIssue(el.dataset.key);
    });
  });

  container.querySelectorAll('.expand-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleDetail(btn.dataset.key, container);
    });
  });
}

// ── Issue detail panel ───────────────────────────────────────────────────────

const detailCache = new Map();

async function toggleDetail(key, container) {
  const detailEl = container.querySelector(`.issue-detail[data-detail-key="${key}"]`);
  const btn      = container.querySelector(`.expand-btn[data-key="${key}"]`);
  const isOpen   = detailEl.classList.contains('open');

  // Collapse everything in this container first
  container.querySelectorAll('.issue-detail.open').forEach(el => {
    el.classList.remove('open');
    el.innerHTML = '';
  });
  container.querySelectorAll('.expand-btn.active').forEach(b => b.classList.remove('active'));

  if (isOpen) return; // was open → now closed, done

  btn.classList.add('active');
  detailEl.classList.add('open');

  if (detailCache.has(key)) {
    detailEl.innerHTML = buildDetailPanel(detailCache.get(key));
    bindDetailLinks(detailEl);
    return;
  }

  detailEl.innerHTML = '<div class="loading-spinner" style="margin:16px auto"></div>';

  try {
    const data = await JiraAPI.getIssueDetails(key);
    detailCache.set(key, data);
    detailEl.innerHTML = buildDetailPanel(data);
    bindDetailLinks(detailEl);
  } catch (err) {
    detailEl.innerHTML = `<div class="state-msg error-msg" style="padding:12px 14px">${friendlyError(err)}</div>`;
  }
}

function buildDetailPanel(data) {
  const f  = data.fields;
  const rf = data.renderedFields || {};
  const out = [];

  // Description
  const descHtml = rf.description || '';
  const descText = f.description  || '';
  if (descHtml || descText) {
    out.push(`<div class="dp-section">
      <div class="dp-label">Description</div>
      <div class="dp-description">${descHtml || escHtml(descText)}</div>
    </div>`);
  }

  // Meta grid
  const meta = [];
  if (f.issuetype?.name) meta.push(['Type',     escHtml(f.issuetype.name)]);
  if (f.status?.name)    meta.push(['Status',   escHtml(f.status.name)]);
  if (f.priority?.name)  meta.push(['Priority', escHtml(f.priority.name)]);
  if (f.created)         meta.push(['Created',  formatDate(f.created)]);
  if (f.updated)         meta.push(['Modified', formatDate(f.updated)]);
  if (f.assignee)        meta.push(['Assignee', escHtml(f.assignee.displayName || f.assignee.name || '')]);
  if (f.reporter)        meta.push(['Reporter', escHtml(f.reporter.displayName || f.reporter.name || '')]);

  if (meta.length) {
    const cells = meta.map(([k, v]) => `
      <div class="dp-meta-cell">
        <span class="dp-label">${k}</span>
        <span class="dp-value">${v}</span>
      </div>`).join('');
    out.push(`<div class="dp-section"><div class="dp-meta-grid">${cells}</div></div>`);
  }

  // Time tracking
  const orig  = f.timeoriginalestimate;
  const spent = f.timespent;
  const left  = f.timeestimate;

  if (orig != null || spent != null || left != null) {
    let timeHtml = '<div class="dp-section">';

    if (orig != null && spent != null) {
      const pct  = Math.round(spent / orig * 100);
      const over = pct > 100;
      timeHtml += `
        <div class="dp-bar-header">
          <span class="dp-label">Estimate · Logged</span>
          <span class="dp-bar-est">${formatSeconds(orig)}</span>
        </div>
        <div class="dp-bar-wrap">
          <div class="dp-bar${over ? ' dp-bar-over' : ''}" style="width:${Math.min(pct, 100)}%">
            <span class="dp-bar-tip">${formatSeconds(spent)}</span>
          </div>
        </div>
        <div class="dp-bar-label${over ? ' over' : ''}">${pct}% of estimate${over ? ' — over budget' : ''}</div>`;
    } else {
      // Only one of the two is present — fall back to plain rows
      timeHtml += '<div class="dp-label">Time Tracking</div>';
      if (orig  != null) timeHtml += `<div class="dp-time-row"><span>Estimate</span><strong>${formatSeconds(orig)}</strong></div>`;
      if (spent != null) timeHtml += `<div class="dp-time-row"><span>Logged</span><strong>${formatSeconds(spent)}</strong></div>`;
    }

    if (left != null) timeHtml += `<div class="dp-time-row" style="margin-top:6px"><span>Remaining</span><strong>${formatSeconds(left)}</strong></div>`;

    timeHtml += '</div>';
    out.push(timeHtml);
  }

  // Linked issues
  const links = f.issuelinks || [];
  if (links.length) {
    const items = links.map(l => {
      const dir    = l.outwardIssue ? 'outward' : 'inward';
      const rel    = l.type[dir];
      const linked = l.outwardIssue || l.inwardIssue;
      return `<div class="dp-link">
        <span class="dp-link-rel">${escHtml(rel)}</span>
        <span class="dp-link-key link-key" data-key="${linked.key}">${linked.key}</span>
        <span class="dp-link-summary">${escHtml(linked.fields?.summary || '')}</span>
      </div>`;
    });
    out.push(`<div class="dp-section">
      <div class="dp-label">Linked Issues</div>
      ${items.join('')}
    </div>`);
  }

  // Labels
  if (f.labels?.length) {
    const chips = f.labels.map(l => `<span class="dp-chip">${escHtml(l)}</span>`).join('');
    out.push(`<div class="dp-section">
      <div class="dp-label">Labels</div>
      <div class="dp-chips">${chips}</div>
    </div>`);
  }

  // Epic / parent
  const epicKey  = f.customfield_10014;
  const epicName = f.customfield_10008;
  const parent   = f.parent;

  if (epicKey || parent) {
    let content = '';
    if (epicKey) {
      content = `<span class="dp-link-key link-key" data-key="${epicKey}">${epicKey}</span>`;
      if (epicName) content += ` — ${escHtml(String(epicName))}`;
    } else {
      content = `<span class="dp-link-key link-key" data-key="${parent.key}">${parent.key}</span>`;
      if (parent.fields?.summary) content += ` — ${escHtml(parent.fields.summary)}`;
    }
    out.push(`<div class="dp-section">
      <div class="dp-label">Epic</div>
      <div class="dp-value">${content}</div>
    </div>`);
  }

  return `<div class="dp-inner">${out.join('') || '<div class="state-msg" style="padding:12px">No additional details available.</div>'}</div>`;
}

function bindDetailLinks(detailEl) {
  detailEl.querySelectorAll('.link-key[data-key]').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => openIssue(el.dataset.key));
  });
}

// ── Tab switching ─────────────────────────────────────────────────────────────

const tabBtns = document.querySelectorAll('.tab');
const panels = {
  'my-issues':   document.getElementById('my-issues-panel'),
  'search':      document.getElementById('search-panel'),
  'logged-work': document.getElementById('logged-work-panel'),
  'watching':    document.getElementById('watching-panel'),
  'notifications': document.getElementById('notifications-panel'),
};

let workLoaded          = false;
let watchingLoaded      = false;
let notificationsLoaded = false;

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    Object.values(panels).forEach(p => p.classList.add('hidden'));
    panels[btn.dataset.tab].classList.remove('hidden');

    if (btn.dataset.tab === 'search') {
      document.getElementById('search-input').focus();
    } else if (btn.dataset.tab === 'logged-work' && !workLoaded) {
      loadLoggedWork();
    } else if (btn.dataset.tab === 'watching' && !watchingLoaded) {
      loadWatchingIssues();
    } else if (btn.dataset.tab === 'notifications' && !notificationsLoaded) {
      loadNotifications();
    }
  });
});

// ── My Issues + Status Filter ─────────────────────────────────────────────────

const WORKFLOW_ORDER = [
  'To Do',
  'In Progress',
  'Code Review',
  'Ready for Merge',
  'Ready for Testing',
  'In QA',
  'Done',
  'Blocked',
  'Final Stage',
];

const issuesContainer = document.getElementById('issues-container');
const filterBar = document.getElementById('filter-bar');

let allIssues = [];
let activeFilter = 'All';

function renderFilterBar() {
  const presentStatuses = [...new Set(allIssues.map(i => i.fields.status?.name).filter(Boolean))];

  if (presentStatuses.length < 2) {
    filterBar.classList.add('hidden');
    return;
  }

  const sorted = presentStatuses.sort((a, b) => {
    const ai = WORKFLOW_ORDER.indexOf(a);
    const bi = WORKFLOW_ORDER.indexOf(b);
    // Known statuses in workflow order; unknowns go to the end alphabetically
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const counts = {};
  allIssues.forEach(i => {
    const s = i.fields.status?.name;
    if (s) counts[s] = (counts[s] || 0) + 1;
  });

  const chips = ['All', ...sorted].map(status => {
    const isActive = status === activeFilter;
    const count = status === 'All' ? allIssues.length : counts[status];
    return `<button class="filter-chip${isActive ? ' active' : ''}" data-status="${status}">
      ${status} <span style="opacity:0.7">${count}</span>
    </button>`;
  }).join('');

  filterBar.innerHTML = chips;
  filterBar.classList.remove('hidden');

  filterBar.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      activeFilter = chip.dataset.status;
      renderFilterBar();
      applyFilter();
    });
  });
}

function applyFilter() {
  const filtered = activeFilter === 'All'
    ? allIssues
    : allIssues.filter(i => i.fields.status?.name === activeFilter);

  issuesContainer.innerHTML = renderIssues(filtered);
  bindIssueClicks(issuesContainer);
}

async function loadMyIssues() {
  activeFilter = 'All';
  filterBar.classList.add('hidden');
  filterBar.innerHTML = '';
  showSpinner(issuesContainer);
  try {
    const data = await JiraAPI.getMyIssues();
    allIssues = data.issues || [];
    renderFilterBar();
    applyFilter();
  } catch (err) {
    allIssues = [];
    showMessage(issuesContainer, friendlyError(err), true);
  }
}

// ── Search ────────────────────────────────────────────────────────────────────

const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');

searchInput.addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  const q = searchInput.value.trim();
  if (!q) return;

  showSpinner(searchResults);
  try {
    const data = await JiraAPI.searchIssues(q);
    searchResults.innerHTML = renderIssues(data.issues || []);
    bindIssueClicks(searchResults);
  } catch (err) {
    showMessage(searchResults, friendlyError(err), true);
  }
});

// ── Buttons ───────────────────────────────────────────────────────────────────

document.getElementById('settings-btn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('refresh-btn').addEventListener('click', () => {
  const activeTab = document.querySelector('.tab.active').dataset.tab;
  if (activeTab === 'my-issues')     loadMyIssues();
  if (activeTab === 'logged-work')   loadLoggedWork();
  if (activeTab === 'watching')      loadWatchingIssues();
  if (activeTab === 'notifications') { notificationsLoaded = false; loadNotifications(); }
});

document.getElementById('go-settings-btn')?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// ── Logged Work ───────────────────────────────────────────────────────────────

const CHART_COLORS = [
  '#0052CC', '#36B37E', '#FF5630', '#6554C0', '#FF8B00',
  '#00B8D9', '#FF7452', '#57D9A3', '#998DD9', '#FFC400',
];

let currentPeriod = 'today';

function toLocalDate(d) {
  // Returns YYYY-MM-DD in local time (not UTC)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getPeriodDates() {
  const today = new Date();
  if (currentPeriod === 'today') {
    const t = toLocalDate(today);
    return { start: t, end: t };
  }
  if (currentPeriod === 'week') {
    const d = new Date(today);
    d.setDate(d.getDate() - 6);
    return { start: toLocalDate(d), end: toLocalDate(today) };
  }
  if (currentPeriod === 'month') {
    const d = new Date(today);
    d.setDate(d.getDate() - 29);
    return { start: toLocalDate(d), end: toLocalDate(today) };
  }
  return {
    start: document.getElementById('date-from').value,
    end: document.getElementById('date-to').value,
  };
}

function formatSeconds(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function buildDonutSVG(data, total) {
  const cx = 80, cy = 80, r = 56, sw = 22;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  const segments = data.map((item, i) => {
    const color = CHART_COLORS[i % CHART_COLORS.length];
    if (data.length === 1) {
      // Full circle, no dasharray needed
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" />`;
    }
    const len = (item.totalSeconds / total) * circ;
    const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
      stroke="${color}" stroke-width="${sw}"
      stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}"
      transform="rotate(-90 ${cx} ${cy})" />`;
    offset += len;
    return seg;
  }).join('');

  const label = formatSeconds(total);

  return `<svg width="160" height="160" viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#f4f5f7" stroke-width="${sw}" />
    ${segments}
    <text x="${cx}" y="${cy - 7}" text-anchor="middle"
      font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
      font-size="17" font-weight="700" fill="#172b4d">${label}</text>
    <text x="${cx}" y="${cy + 13}" text-anchor="middle"
      font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
      font-size="10" fill="#5e6c84">total logged</text>
  </svg>`;
}

function buildLegend(data) {
  return data.map((item, i) => {
    const color = CHART_COLORS[i % CHART_COLORS.length];
    return `<div class="legend-item">
      <span class="legend-dot" style="background:${color}"></span>
      <span class="legend-key" data-key="${item.key}">${item.key}</span>
      <span class="legend-summary" title="${item.summary}">${item.summary}</span>
      <span class="legend-time">${formatSeconds(item.totalSeconds)}</span>
    </div>`;
  }).join('');
}

const workChart  = document.getElementById('work-chart');
const workLegend = document.getElementById('work-legend');

function renderWorkContent(data) {
  if (!data.length) {
    workChart.innerHTML = '<div class="state-msg">No work logged<br/>in this period.</div>';
    workLegend.innerHTML = '';
    return;
  }
  const total = data.reduce((s, d) => s + d.totalSeconds, 0);
  workChart.innerHTML  = buildDonutSVG(data, total);
  workLegend.innerHTML = buildLegend(data);

  workLegend.querySelectorAll('.legend-key').forEach(el => {
    el.addEventListener('click', () => openIssue(el.dataset.key));
  });
}

async function loadLoggedWork() {
  workLoaded = true;
  showSpinner(workChart);
  workLegend.innerHTML = '';

  const { start, end } = getPeriodDates();
  if (!start || !end || start > end) {
    showMessage(workChart, 'Please select a valid date range.');
    workLoaded = false;
    return;
  }

  try {
    const data = await JiraAPI.getLoggedWork(start, end);
    renderWorkContent(data);
  } catch (err) {
    showMessage(workChart, friendlyError(err), true);
    workLoaded = false;
  }
}

// Period buttons
document.querySelectorAll('.period-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentPeriod = btn.dataset.period;

    const customDates = document.getElementById('custom-dates');
    if (currentPeriod === 'custom') {
      // Pre-fill to last 7 days when opening custom
      const today = new Date();
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 6);
      const dateFrom = document.getElementById('date-from');
      const dateTo   = document.getElementById('date-to');
      if (!dateFrom.value) dateFrom.value = toLocalDate(weekAgo);
      if (!dateTo.value)   dateTo.value   = toLocalDate(today);
      // Constrain to today max
      dateFrom.max = toLocalDate(today);
      dateTo.max   = toLocalDate(today);
      customDates.classList.remove('hidden');
    } else {
      customDates.classList.add('hidden');
      loadLoggedWork();
    }
  });
});

// Keep date-to min in sync with date-from
document.getElementById('date-from').addEventListener('change', e => {
  document.getElementById('date-to').min = e.target.value;
});

document.getElementById('apply-custom-dates').addEventListener('click', loadLoggedWork);

// ── Watching ──────────────────────────────────────────────────────────────────

const watchingContainer = document.getElementById('watching-container');

async function loadWatchingIssues() {
  watchingLoaded = true;
  showSpinner(watchingContainer);
  try {
    const { watchingExcludeDone } = await new Promise(r =>
      chrome.storage.local.get('watchingExcludeDone', r)
    );
    const data = await JiraAPI.getWatchingIssues(watchingExcludeDone !== false);
    watchingContainer.innerHTML = renderIssues(data.issues || []);
    bindIssueClicks(watchingContainer);
  } catch (err) {
    showMessage(watchingContainer, friendlyError(err), true);
    watchingLoaded = false;
  }
}

// ── Notifications (Returned + Assignments + Mentions) ─────────────────────────

const notificationsContainer = document.getElementById('notifications-container');

function updateNotificationsBadge(n) {
  const badge = document.getElementById('notifications-count');
  if (n > 0) {
    badge.textContent = n;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function formatMentionBody(body) {
  return body
    .replace(/\[~([^\]]+)\]/g, (_, u) => `@${u}`)
    .replace(/\{[^}]+\}[\s\S]*?\{[^}]+\}/g, '')
    .replace(/\{[^}]+\}/g, '')
    .replace(/![\w.]+(?:\|[^!]*)!/g, '[image]')
    .replace(/\[([^|\]]+)\|[^\]]+\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
}

function renderMentionItem(mention) {
  const snippet = escHtml(formatMentionBody(mention.body));
  return `
    <div class="notif-item">
      <div class="notif-item-header">
        <span class="notif-type-badge notif-type-mention">Mention</span>
        <span class="notif-item-key" data-key="${mention.issueKey}">${mention.issueKey}</span>
        <span class="notif-item-summary" title="${escHtml(mention.summary)}">${escHtml(mention.summary)}</span>
        <button class="notif-dismiss" data-dismiss-mention="${escHtml(mention.dismissKey)}" title="Dismiss">×</button>
      </div>
      <div class="notif-item-meta">by ${escHtml(mention.author)} · ${formatDate(mention.date)}</div>
      <div class="notif-item-body">${snippet}</div>
    </div>
  `;
}

function renderReturnedItem(item) {
  return `
    <div class="notif-item">
      <div class="notif-item-header">
        <span class="notif-type-badge notif-type-returned">Returned</span>
        <span class="notif-item-key" data-key="${item.key}">${item.key}</span>
        <span class="notif-item-summary" title="${escHtml(item.summary)}">${escHtml(item.summary)}</span>
        <button class="notif-dismiss" data-dismiss-returned="${item.key}" title="Dismiss">×</button>
      </div>
      <div class="notif-item-meta">${escHtml(item.status)}</div>
    </div>
  `;
}

function renderAssignmentItem(item) {
  return `
    <div class="notif-item">
      <div class="notif-item-header">
        <span class="notif-type-badge notif-type-assigned">Assigned</span>
        <span class="notif-item-key" data-key="${item.key}">${item.key}</span>
        <span class="notif-item-summary" title="${escHtml(item.summary)}">${escHtml(item.summary)}</span>
        <button class="notif-dismiss" data-dismiss-assignment="${item.key}" title="Dismiss">×</button>
      </div>
      <div class="notif-item-meta">${escHtml(item.status)}</div>
    </div>
  `;
}

function updateAfterDismiss() {
  const remaining = notificationsContainer.querySelectorAll('.notif-item').length;
  updateNotificationsBadge(remaining);
  // Keep extension icon badge in sync for mention dismissals
  const mentionItems = notificationsContainer.querySelectorAll('[data-dismiss-mention]').length;
  chrome.storage.local.set({ mentionCount: mentionItems });
  // Remove section headers that now have no items below them
  notificationsContainer.querySelectorAll('.notif-section-header').forEach(header => {
    const next = header.nextElementSibling;
    if (!next || next.classList.contains('notif-section-header')) header.remove();
  });
  if (!remaining) showMessage(notificationsContainer, 'No new notifications.');
}

async function loadNotifications() {
  notificationsLoaded = true;
  showSpinner(notificationsContainer);

  try {
    const [returned, assignments, mentions] = await Promise.all([
      JiraAPI.getReturnedNotifications(),
      JiraAPI.getAssignmentNotifications(),
      JiraAPI.getMentions(),
    ]);

    const total = returned.length + assignments.length + mentions.length;
    updateNotificationsBadge(total);
    chrome.storage.local.set({ mentionCount: mentions.length });

    if (!total) {
      showMessage(notificationsContainer, 'No new notifications.');
      return;
    }

    let html = '';
    if (returned.length) {
      html += `<div class="notif-section-header">Returned · ${returned.length}</div>`;
      html += returned.map(renderReturnedItem).join('');
    }
    if (assignments.length) {
      html += `<div class="notif-section-header">Assignments · ${assignments.length}</div>`;
      html += assignments.map(renderAssignmentItem).join('');
    }
    if (mentions.length) {
      html += `<div class="notif-section-header">Mentions · ${mentions.length}</div>`;
      html += mentions.map(renderMentionItem).join('');
    }
    notificationsContainer.innerHTML = html;

    notificationsContainer.querySelectorAll('.notif-item-key').forEach(el => {
      el.addEventListener('click', () => openIssue(el.dataset.key));
    });

    notificationsContainer.querySelectorAll('[data-dismiss-returned]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.dismissReturned;
        const { dismissedReturned = [] } = await new Promise(r =>
          chrome.storage.local.get('dismissedReturned', r)
        );
        if (!dismissedReturned.includes(key)) {
          chrome.storage.local.set({ dismissedReturned: [...dismissedReturned, key] });
        }
        btn.closest('.notif-item').remove();
        updateAfterDismiss();
      });
    });

    notificationsContainer.querySelectorAll('[data-dismiss-mention]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.dismissMention;
        const { dismissedMentions = [] } = await new Promise(r =>
          chrome.storage.local.get('dismissedMentions', r)
        );
        if (!dismissedMentions.includes(key)) {
          chrome.storage.local.set({ dismissedMentions: [...dismissedMentions, key] });
        }
        btn.closest('.notif-item').remove();
        updateAfterDismiss();
      });
    });

    notificationsContainer.querySelectorAll('[data-dismiss-assignment]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.dismissAssignment;
        const { pendingAssignments = [] } = await new Promise(r =>
          chrome.storage.local.get('pendingAssignments', r)
        );
        chrome.storage.local.set({ pendingAssignments: pendingAssignments.filter(k => k !== key) });
        btn.closest('.notif-item').remove();
        updateAfterDismiss();
      });
    });

  } catch (err) {
    showMessage(notificationsContainer, friendlyError(err), true);
    notificationsLoaded = false;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const { jiraUrl, jiraPat } = await JiraAPI.getSettings();

  const notConfigured = document.getElementById('not-configured');
  const mainContent   = document.getElementById('main-content');

  if (!jiraUrl || !jiraPat) {
    notConfigured.classList.remove('hidden');
    mainContent.classList.add('hidden');
    return;
  }

  // Verify the browser has granted host permission for the stored URL.
  // This can be missing if the user hasn't re-saved Settings since the
  // extension was updated to use optional_host_permissions.
  const hasPermission = await chrome.permissions.contains({ origins: [`${jiraUrl}/*`] });
  if (!hasPermission) {
    notConfigured.classList.remove('hidden');
    mainContent.classList.add('hidden');
    notConfigured.querySelector('p').innerHTML =
      'Browser permission required to access your Jira URL.<br/>Open Settings and click <strong>Save</strong> to grant access.';
    return;
  }

  notConfigured.classList.add('hidden');
  mainContent.classList.remove('hidden');

  // Show username async (non-blocking)
  JiraAPI.getCurrentUser()
    .then(u => {
      const label = document.getElementById('user-label');
      label.textContent = u.displayName || u.name || '';
    })
    .catch(() => {});

  // Seed notifications badge from last known counts (no extra API call)
  chrome.storage.local.get(
    ['watchCount', 'dismissedReturned', 'mentionCount', 'pendingAssignments'],
    ({ watchCount = 0, dismissedReturned = [], mentionCount = 0, pendingAssignments = [] }) => {
      const returnedCount    = Math.max(0, watchCount - dismissedReturned.length);
      const notifCount       = returnedCount + (mentionCount || 0) + pendingAssignments.length;
      if (notifCount > 0) updateNotificationsBadge(notifCount);
    }
  );

  loadMyIssues();
}

init();
