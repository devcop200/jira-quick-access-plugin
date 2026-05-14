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
  if (n.includes('sub-task') || n.includes('subtask')) return '#66b2ff';
  if (n.includes('story')) return '#4caf50';
  if (n.includes('task')) return '#0052cc';
  return '#42526e';
}

function issueTypeInitial(name) {
  if (!name) return '?';
  const n = name.toLowerCase();
  if (n === 'bug') return 'B';
  if (n.includes('epic')) return 'E';
  if (n.includes('sub-task') || n.includes('subtask')) return 'Sb';
  if (n.includes('story')) return 'S';
  if (n.includes('task')) return 'T';
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

function renderCard(issue, showPin) {
  const f = issue.fields;
  const statusCat  = f.status?.statusCategory?.key || 'new';
  const prioName   = f.priority?.name || 'Medium';
  const typeName   = f.issuetype?.name || '';
  const statusName = f.status?.name || '';
  const ttEntry    = ttTracker[issue.key];
  const hasActive  = ttEntry && (ttEntry.state === 'running' || ttEntry.state === 'paused');
  const totalMs    = ttGetTotalMs(issue.key);
  const isPinned   = pinnedTaskIds.has(issue.key);

  return `
    <div class="issue-item" data-key="${issue.key}">
      <div class="issue-type-icon" style="background:${issueTypeColor(typeName)}" title="${typeName}">
        ${issueTypeInitial(typeName)}
      </div>
      <div class="issue-body">
        <div class="issue-key">${issue.key}${totalMs > 0 ? `<span class="tt-time-chip" title="Time tracked with the plugin">${ttFormatMsCompact(totalMs)}</span>` : ''}</div>
        <div class="issue-summary" title="${escHtml(f.summary || '')}">${escHtml(f.summary || '(no summary)')}</div>
        <div class="issue-meta">
          <span class="status-badge ${statusClass(statusCat)}">${statusLabel(statusName)}</span>
          <span class="priority-dot ${priorityClass(prioName)}" title="${prioName}"></span>
        </div>
      </div>
      <div class="issue-actions">
        <div class="issue-btn-group">
          <button class="tt-clock-btn${hasActive ? ' active' : ''}" data-tt-clock="${issue.key}" data-summary="${escHtml(f.summary || '')}" title="Track time">⏱</button>
          ${showPin ? `<button class="pin-btn${isPinned ? ' pinned' : ''}" data-pin="${issue.key}" title="${isPinned ? 'Unpin' : 'Pin'}">📌</button>` : ''}
        </div>
        <button class="expand-btn" data-key="${issue.key}" title="Show details">›</button>
      </div>
    </div>
    <div class="issue-detail" data-detail-key="${issue.key}"></div>
  `;
}

function renderIssues(issues) {
  if (!issues.length) return '<div class="state-msg">No issues found.</div>';
  return issues.map(i => renderCard(i, false)).join('');
}

function bindPinButtons(container) {
  container.querySelectorAll('[data-pin]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      togglePin(btn.dataset.pin);
    });
  });
}

function togglePin(key) {
  if (pinnedTaskIds.has(key)) {
    pinnedTaskIds.delete(key);
  } else {
    pinnedTaskIds.add(key);
  }
  chrome.storage.local.set({ pinnedTaskIds: [...pinnedTaskIds] });
  applyFilter();
}

function bindIssueClicks(container) {
  container.querySelectorAll('.issue-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.expand-btn') || e.target.closest('.tt-clock-btn') || e.target.closest('.pin-btn')) return;
      openIssue(el.dataset.key);
    });
  });

  container.querySelectorAll('.expand-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleDetail(btn.dataset.key, container);
    });
  });

  container.querySelectorAll('.tt-clock-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const key     = btn.dataset.ttClock;
      const summary = btn.dataset.summary;
      const entry   = ttTracker[key];
      if (!entry || entry.state === 'stopped') {
        ttStart(key, summary);
      } else if (entry.state === 'running') {
        ttPause(key);
      } else {
        ttStart(key, summary);
      }
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
    appendTTDetailSection(key, detailEl);
    bindDetailLinks(detailEl);
    bindTTDetailNotes(key, detailEl);
    return;
  }

  detailEl.innerHTML = '<div class="loading-spinner" style="margin:16px auto"></div>';

  try {
    const data = await JiraAPI.getIssueDetails(key);
    detailCache.set(key, data);
    detailEl.innerHTML = buildDetailPanel(data);
    appendTTDetailSection(key, detailEl);
    bindDetailLinks(detailEl);
    bindTTDetailNotes(key, detailEl);
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

function appendTTDetailSection(key, detailEl) {
  const e = ttTracker[key];
  if (!e || (e.state === 'stopped' && !e.sessions.length)) return;

  const dp = detailEl.querySelector('.dp-inner');
  if (!dp) return;

  const isActive = e.state === 'running' || e.state === 'paused';
  let html = '<div class="dp-section"><div class="dp-label">Local Time Tracking</div>';

  if (isActive) {
    html += `<textarea class="tt-notes-textarea" data-dp-notes-ta="${escHtml(key)}" placeholder="Session notes…" style="width:100%;box-sizing:border-box">${escHtml(e.currentNotes || '')}</textarea>
    <div class="tt-notes-footer"><button class="tt-notes-save" data-dp-save="${escHtml(key)}">Save</button></div>`;
  }

  if (e.sessions.length) {
    html += `<div class="dp-label" style="margin-top:4px">Session history</div><div class="tt-session-history" data-history-key="${escHtml(key)}">`;
    html += ttBuildSessionHistoryHtml(e, key);
    html += '</div>';
  }

  html += '</div>';
  dp.insertAdjacentHTML('beforeend', html);
}

let ttNotesDebounce = null;

function bindTTDetailNotes(key, detailEl) {
  detailEl.querySelectorAll('[data-dp-notes-ta]').forEach(ta => {
    ta.addEventListener('input', () => {
      clearTimeout(ttNotesDebounce);
      ttNotesDebounce = setTimeout(() => ttSetNotes(ta.dataset.dpNotesTa, ta.value), 500);
    });
  });

  detailEl.querySelectorAll('[data-dp-save]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ta = detailEl.querySelector(`[data-dp-notes-ta="${btn.dataset.dpSave}"]`);
      if (ta) ttSetNotes(btn.dataset.dpSave, ta.value);
      btn.textContent = 'Saved ✓';
      setTimeout(() => { btn.textContent = 'Save'; }, 1500);
    });
  });

  bindSessionHistoryEvents(detailEl);
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

let allIssues    = [];
let activeFilter = 'All';

let pinnedTaskIds          = new Set();
let wasPinnedBeforeTracking = new Set();
let myIssuesSearchQuery    = '';

document.getElementById('my-issues-search').addEventListener('input', function () {
  myIssuesSearchQuery = this.value;
  applyFilter();
});

function renderFilterBar() {
  const presentStatuses = [...new Set(allIssues.map(i => i.fields.status?.name).filter(Boolean))];

  if (presentStatuses.length < 2) {
    filterBar.classList.add('hidden');
    return;
  }

  const sorted = presentStatuses.sort((a, b) => {
    const ai = WORKFLOW_ORDER.indexOf(a);
    const bi = WORKFLOW_ORDER.indexOf(b);
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
  const statusFiltered = activeFilter === 'All'
    ? allIssues
    : allIssues.filter(i => i.fields.status?.name === activeFilter);

  const q = myIssuesSearchQuery.trim().toLowerCase();
  const filtered = q
    ? statusFiltered.filter(i =>
        i.key.toLowerCase().includes(q) ||
        (i.fields.summary || '').toLowerCase().includes(q)
      )
    : statusFiltered;

  const activeKeys = new Set(ttGetActive().map(([k]) => k));
  ttRenderSection();

  const pinned  = filtered.filter(i => pinnedTaskIds.has(i.key) && !activeKeys.has(i.key));
  const regular = filtered.filter(i => !pinnedTaskIds.has(i.key) && !activeKeys.has(i.key));

  // Show "My Tasks" header whenever a section sits above the regular list
  const myTasksHdr = document.getElementById('tt-my-tasks-header');
  if (myTasksHdr && !activeKeys.size) {
    myTasksHdr.classList.toggle('hidden', !(pinned.length > 0 && regular.length > 0));
  }

  let html = '';
  if (pinned.length) {
    html += '<div class="pinned-label">Pinned</div>';
    html += pinned.map(i => renderCard(i, true)).join('');
  }
  if (regular.length) {
    html += regular.map(i => renderCard(i, true)).join('');
  } else if (!pinned.length) {
    html += '<div class="state-msg">No issues found.</div>';
  }

  issuesContainer.innerHTML = html;
  bindIssueClicks(issuesContainer);
  bindPinButtons(issuesContainer);
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

// ── Theme toggle ───────────────────────────────────────────────────────────────

const themeBtn = document.getElementById('theme-btn');

function updateThemeBtn() {
  themeBtn.textContent = document.documentElement.classList.contains('dark') ? '☀️' : '🌙';
}

themeBtn.addEventListener('click', () => {
  const goingDark = !document.documentElement.classList.contains('dark');
  document.documentElement.classList.toggle('dark', goingDark);
  const theme = goingDark ? 'dark' : 'light';
  localStorage.setItem('jqa-theme', theme);
  chrome.storage.local.set({ theme });
  updateThemeBtn();
});

updateThemeBtn();

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
    end:   document.getElementById('date-to').value,
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
    const tip = `${item.key} — ${formatSeconds(item.totalSeconds)}`;
    if (data.length === 1) {
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}"><title>${tip}</title></circle>`;
    }
    const len = (item.totalSeconds / total) * circ;
    const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
      stroke="${color}" stroke-width="${sw}"
      stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}"
      transform="rotate(-90 ${cx} ${cy})"><title>${tip}</title></circle>`;
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
      const today = new Date();
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 6);
      const dateFrom = document.getElementById('date-from');
      const dateTo   = document.getElementById('date-to');
      if (!dateFrom.value) dateFrom.value = toLocalDate(weekAgo);
      if (!dateTo.value)   dateTo.value   = toLocalDate(today);
      dateFrom.max = toLocalDate(today);
      dateTo.max   = toLocalDate(today);
      customDates.classList.remove('hidden');
    } else {
      customDates.classList.add('hidden');
      loadLoggedWork();
    }
  });
});

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
  const mentionItems = notificationsContainer.querySelectorAll('[data-dismiss-mention]').length;
  chrome.storage.local.set({ mentionCount: mentionItems });
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

// ── Time Tracking ─────────────────────────────────────────────────────────────
//
// Storage key: 'timeTracking'
// Shape: { [issueKey]: { state, accumulatedMs, lastResumeTs, currentSessionStart,
//                        currentNotes, sessions[], summary } }
// state: 'running' | 'paused' | 'stopped'
// Sessions are completed start→stop cycles stored with notes.

let ttTracker = {};
let ttTickInterval = null;

function ttSave() {
  chrome.storage.local.set({ timeTracking: ttTracker });
}

function ttGetLiveMs(key) {
  const e = ttTracker[key];
  if (!e) return 0;
  if (e.state === 'running' && e.lastResumeTs) {
    return e.accumulatedMs + (Date.now() - e.lastResumeTs);
  }
  return e.accumulatedMs;
}

function ttGetTotalMs(key) {
  const e = ttTracker[key];
  if (!e) return 0;
  const past = e.sessions.reduce((s, sess) => s + sess.durationMs, 0);
  return past + (e.state !== 'stopped' ? ttGetLiveMs(key) : 0);
}

function ttFormatMs(ms) {
  const s   = Math.floor(ms / 1000);
  const h   = Math.floor(s / 3600);
  const m   = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${m}:${sec}` : `${m}:${sec}`;
}

function ttFormatMsCompact(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function ttGetActive() {
  return Object.entries(ttTracker).filter(([, e]) => e.state === 'running' || e.state === 'paused');
}

function ttEnsureTick() {
  if (ttTickInterval) return;
  let ttAutoSaveTick = 0;
  ttTickInterval = setInterval(() => {
    if (!ttGetActive().length) {
      clearInterval(ttTickInterval);
      ttTickInterval = null;
      return;
    }
    ttGetActive().filter(([, e]) => e.state === 'running').forEach(([key]) => {
      const fmt = ttFormatMs(ttGetLiveMs(key));
      document.querySelectorAll(`.tt-chip[data-key="${key}"] .tt-chip-counter`).forEach(el => { el.textContent = fmt; });
      document.querySelectorAll(`.tt-section-counter[data-key="${key}"]`).forEach(el => { el.textContent = fmt; });
      document.querySelectorAll(`.tt-overflow-counter[data-key="${key}"]`).forEach(el => { el.textContent = fmt; });
    });
    ttAutoSaveTick++;
    if (ttAutoSaveTick >= 5) {
      ttAutoSaveTick = 0;
      let dirty = false;
      document.querySelectorAll('[data-tt-notes-ta]').forEach(ta => {
        const key = ta.dataset.ttNotesTa;
        if (ttTracker[key] && ttTracker[key].currentNotes !== ta.value) {
          ttTracker[key].currentNotes = ta.value;
          dirty = true;
        }
      });
      document.querySelectorAll('[data-dp-notes-ta]').forEach(ta => {
        const key = ta.dataset.dpNotesTa;
        if (ttTracker[key] && ttTracker[key].currentNotes !== ta.value) {
          ttTracker[key].currentNotes = ta.value;
          dirty = true;
        }
      });
      document.querySelectorAll('.tt-session-notes-ta').forEach(ta => {
        const key     = ta.dataset.sessionNotesKey;
        const startTs = Number(ta.dataset.sessionNotesStart);
        const e = ttTracker[key];
        if (!e) return;
        const sess = e.sessions.find(s => s.startTs === startTs);
        if (sess && sess.notes !== ta.value) {
          sess.notes = ta.value;
          dirty = true;
        }
      });
      if (dirty) ttSave();
    }
  }, 1000);
}

function ttStart(key, summary) {
  // Auto-pause any currently running timer
  for (const [k, e] of Object.entries(ttTracker)) {
    if (e.state === 'running') {
      e.accumulatedMs += Date.now() - e.lastResumeTs;
      e.lastResumeTs = null;
      e.state = 'paused';
    }
  }

  // Remember if this task was pinned so we can restore after stop
  if (pinnedTaskIds.has(key)) {
    wasPinnedBeforeTracking.add(key);
  }

  const now = Date.now();
  const ex  = ttTracker[key];

  if (!ex || ex.state === 'stopped') {
    ttTracker[key] = {
      state: 'running',
      accumulatedMs: 0,
      lastResumeTs: now,
      currentSessionStart: now,
      currentNotes: '',
      sessions: ex ? ex.sessions : [],
      summary: summary || key,
    };
  } else {
    ex.state = 'running';
    ex.lastResumeTs = now;
  }

  ttSave();
  ttRenderNavChips();
  applyFilter();
  ttEnsureTick();
}

function ttPause(key) {
  const e = ttTracker[key];
  if (!e || e.state !== 'running') return;
  e.accumulatedMs += Date.now() - e.lastResumeTs;
  e.lastResumeTs = null;
  e.state = 'paused';
  ttSave();
  ttRenderNavChips();
  ttUpdateRow(key);
}

function ttStop(key) {
  const e = ttTracker[key];
  if (!e) return;

  const now = Date.now();
  if (e.state === 'running' && e.lastResumeTs) {
    e.accumulatedMs += now - e.lastResumeTs;
  }
  e.sessions.push({
    startTs: e.currentSessionStart,
    endTs: now,
    durationMs: Math.max(60000, e.accumulatedMs),
    notes: e.currentNotes || '',
  });
  e.state = 'stopped';
  e.accumulatedMs = 0;
  e.lastResumeTs = null;
  e.currentNotes = '';
  e.currentSessionStart = 0;

  // Restore pin if task was pinned before tracking started
  if (wasPinnedBeforeTracking.has(key)) {
    pinnedTaskIds.add(key);
    wasPinnedBeforeTracking.delete(key);
    chrome.storage.local.set({ pinnedTaskIds: [...pinnedTaskIds] });
  }

  ttSave();
  ttRenderNavChips();
  applyFilter();
}

function ttSetNotes(key, notes) {
  if (ttTracker[key]) {
    ttTracker[key].currentNotes = notes;
    ttSave();
  }
}

function ttUpdateRow(key) {
  const e = ttTracker[key];
  if (!e) return;
  const running = e.state === 'running';

  const counter = document.querySelector(`.tt-section-counter[data-key="${key}"]`);
  if (counter) {
    counter.classList.toggle('paused', !running);
    counter.textContent = ttFormatMs(ttGetLiveMs(key));
  }
  const playBtn = document.querySelector(`[data-tt-play="${key}"]`);
  if (playBtn) {
    playBtn.title   = running ? 'Pause' : 'Resume';
    playBtn.textContent = running ? '⏸️' : '▶️';
  }
  const chipBtn = document.querySelector(`.tt-chip[data-key="${key}"] .tt-chip-btn`);
  if (chipBtn) {
    chipBtn.title       = running ? 'Pause' : 'Resume';
    chipBtn.dataset.ttToggle = key;
    chipBtn.textContent = running ? '⏸️' : '▶️';
  }
  const clockBtn = document.querySelector(`.tt-clock-btn[data-tt-clock="${key}"]`);
  if (clockBtn) clockBtn.classList.toggle('active', true);
}

let ttOverflowOpen = false;
let ttOverflowCloseHandler = null;

function ttChipHtml(key, e) {
  const running = e.state === 'running';
  return `<div class="tt-chip ${running ? 'running' : 'paused'}" data-key="${key}">
    <span class="tt-chip-key" data-chip-open="${key}">${escHtml(key)}</span>
    <span class="tt-chip-counter">${ttFormatMs(ttGetLiveMs(key))}</span>
    <button class="tt-chip-btn" data-tt-toggle="${key}" title="${running ? 'Pause' : 'Resume'}">${running ? '⏸️' : '▶️'}</button>
    <button class="tt-chip-btn" data-tt-chip-stop="${key}" title="Stop">⏹️</button>
    <button class="tt-chip-btn" data-tt-chip-notes="${key}" title="Notes">📝</button>
  </div>`;
}

function ttBindChipContainer(container) {
  container.querySelectorAll('[data-tt-toggle]').forEach(btn => {
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      const k = btn.dataset.ttToggle;
      const entry = ttTracker[k];
      if (!entry) return;
      if (entry.state === 'running') ttPause(k);
      else ttStart(k, entry.summary);
    });
  });
  container.querySelectorAll('[data-tt-chip-stop]').forEach(btn => {
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      ttStop(btn.dataset.ttChipStop);
    });
  });
  container.querySelectorAll('[data-tt-chip-notes]').forEach(btn => {
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      ttFocusNotes(btn.dataset.ttChipNotes);
      ttCloseOverflow();
    });
  });
  container.querySelectorAll('[data-chip-open]').forEach(span => {
    span.addEventListener('click', ev => {
      ev.stopPropagation();
      openIssue(span.dataset.chipOpen);
    });
  });
}

function ttRenderNavChips() {
  const container = document.getElementById('tt-chips');
  if (!container) return;

  const active = ttGetActive();
  if (!active.length) {
    container.innerHTML = '';
    ttCloseOverflow();
    return;
  }

  // Running timer always occupies the primary slot (never in overflow)
  const running = active.filter(([, e]) => e.state === 'running');
  const paused  = active.filter(([, e]) => e.state === 'paused');
  // Show at most 1 chip (the running one if any, else first paused)
  const sorted  = [...running, ...paused];
  const visible = sorted.slice(0, 1);
  const rest    = sorted.slice(1);

  let html = visible.map(([key, e]) => ttChipHtml(key, e)).join('');
  if (rest.length) {
    html += `<button class="tt-overflow-btn" id="tt-overflow-btn">+${rest.length} ▾</button>`;
  }

  container.innerHTML = html;
  ttBindChipContainer(container);

  const overflowBtn = document.getElementById('tt-overflow-btn');
  if (overflowBtn) {
    overflowBtn.addEventListener('click', ev => {
      ev.stopPropagation();
      ttToggleOverflow(rest, overflowBtn);
    });
  }

  // Keep overflow panel in sync if it's currently open
  if (ttOverflowOpen) {
    if (rest.length) ttToggleOverflow(rest, null, true);
    else ttCloseOverflow();
  }
}

function ttToggleOverflow(entries, anchorEl, forceOpen = false) {
  const panel = document.getElementById('tt-overflow-panel');
  if (!panel) return;

  if (ttOverflowOpen && !forceOpen) {
    ttCloseOverflow();
    return;
  }

  panel.innerHTML = entries.map(([key, e]) => {
    const running = e.state === 'running';
    return `<div class="tt-overflow-item ${running ? 'running' : ''}" data-key="${key}">
      <span class="tt-overflow-key" data-chip-open="${key}">${escHtml(key)}</span>
      <span class="tt-overflow-counter" data-key="${key}">${ttFormatMs(ttGetLiveMs(key))}</span>
      <button class="tt-chip-btn" data-tt-toggle="${key}" title="${running ? 'Pause' : 'Resume'}">${running ? '⏸️' : '▶️'}</button>
      <button class="tt-chip-btn" data-tt-chip-stop="${key}" title="Stop">⏹️</button>
      <button class="tt-chip-btn" data-tt-chip-notes="${key}" title="Notes">📝</button>
    </div>`;
  }).join('');

  panel.classList.remove('hidden');
  ttOverflowOpen = true;
  ttBindChipContainer(panel);

  if (!ttOverflowCloseHandler) {
    ttOverflowCloseHandler = ev => {
      if (!panel.contains(ev.target) && ev.target.id !== 'tt-overflow-btn') {
        ttCloseOverflow();
      }
    };
    setTimeout(() => document.addEventListener('click', ttOverflowCloseHandler), 0);
  }
}

function ttCloseOverflow() {
  const panel = document.getElementById('tt-overflow-panel');
  if (panel) panel.classList.add('hidden');
  ttOverflowOpen = false;
  if (ttOverflowCloseHandler) {
    document.removeEventListener('click', ttOverflowCloseHandler);
    ttOverflowCloseHandler = null;
  }
}

function ttFocusNotes(key) {
  // Switch to My Issues tab if not already there
  const myIssuesBtn = document.querySelector('.tab[data-tab="my-issues"]');
  if (myIssuesBtn && !myIssuesBtn.classList.contains('active')) myIssuesBtn.click();
  // Open the notes panel for this key in the TT section
  const panel = document.querySelector(`.tt-notes-panel[data-notes-key="${key}"]`);
  if (panel) {
    panel.classList.remove('hidden');
    panel.querySelector('textarea')?.focus();
  }
}

function ttRenderSection() {
  const section    = document.getElementById('tt-section');
  const myTasksHdr = document.getElementById('tt-my-tasks-header');
  if (!section) return;

  const active = ttGetActive().sort(([, a], [, b]) => {
    if (a.state === 'running' && b.state !== 'running') return -1;
    if (b.state === 'running' && a.state !== 'running') return 1;
    return 0;
  });
  if (!active.length) {
    section.classList.add('hidden');
    if (myTasksHdr) myTasksHdr.classList.add('hidden');
    return;
  }

  section.innerHTML = '<div class="tt-section-label">Time Tracking</div>' +
    active.map(([key, e]) => {
      const running = e.state === 'running';
      return `<div class="tt-issue-row" data-key="${key}">
        <span class="tt-section-counter${running ? '' : ' paused'}" data-key="${key}">${ttFormatMs(ttGetLiveMs(key))}</span>
        <div class="tt-issue-info">
          <div class="tt-issue-key"><span class="tt-issue-key-link" data-tt-open="${escHtml(key)}">${escHtml(key)}</span></div>
          <div class="tt-issue-summary">${escHtml(e.summary || key)}</div>
        </div>
        <div class="tt-controls">
          <button class="tt-btn" data-tt-play="${key}" title="${running ? 'Pause' : 'Resume'}">${running ? '⏸️' : '▶️'}</button>
          <button class="tt-btn stop" data-tt-stop="${key}" title="Stop">⏹️</button>
          <button class="tt-btn" data-tt-notes="${key}" title="Notes">📝</button>
        </div>
      </div>
      <div class="tt-notes-panel hidden" data-notes-key="${key}">
        <textarea class="tt-notes-textarea" data-tt-notes-ta="${key}" placeholder="Session notes…">${escHtml(e.currentNotes || '')}</textarea>
        <div class="tt-notes-footer"><button class="tt-notes-save" data-tt-save="${key}">Save</button></div>
        ${ttRenderSessionHistory(key, e)}
      </div>`;
    }).join('');

  section.classList.remove('hidden');
  if (myTasksHdr) myTasksHdr.classList.remove('hidden');

  bindTTSection(section);
}

function ttBuildSessionHistoryHtml(e, key) {
  return e.sessions.slice().reverse().map(s => {
    return `<div class="tt-session-entry-wrap" data-session-key="${escHtml(key)}" data-session-start="${s.startTs}">
      <div class="tt-session-entry">
        <span class="tt-session-duration">${ttFormatMsCompact(s.durationMs)}</span>
        <span class="tt-session-date">${new Date(s.startTs).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
        <button class="tt-notes-toggle" data-session-toggle>▾ Notes</button>
        <button class="tt-session-delete" title="Remove session">×</button>
      </div>
      <div class="tt-session-notes-body hidden">
        <textarea class="tt-notes-textarea tt-session-notes-ta" data-session-notes-key="${escHtml(key)}" data-session-notes-start="${s.startTs}" placeholder="Session notes…">${escHtml(s.notes)}</textarea>
        <div class="tt-notes-footer"><button class="tt-notes-save tt-session-notes-save" data-session-notes-key="${escHtml(key)}" data-session-notes-start="${s.startTs}">Save</button></div>
      </div>
    </div>`;
  }).join('');
}

function ttRenderSessionHistory(key, e) {
  if (!e.sessions.length) return '';
  return `<div class="tt-session-history" data-history-key="${escHtml(key)}"><div class="tt-session-label">Past sessions</div>${ttBuildSessionHistoryHtml(e, key)}</div>`;
}

function ttDeleteSession(key, startTs) {
  const e = ttTracker[key];
  if (!e) return;
  e.sessions = e.sessions.filter(s => s.startTs !== startTs);
  ttSave();
}

function ttRefreshSessionHistory(key) {
  const e = ttTracker[key];
  if (!e) return;
  document.querySelectorAll(`.tt-session-history[data-history-key="${key}"]`).forEach(container => {
    if (!e.sessions.length) {
      container.remove();
      return;
    }
    container.innerHTML = '<div class="tt-session-label">Past sessions</div>' + ttBuildSessionHistoryHtml(e, key);
    bindSessionHistoryEvents(container);
  });
  // Update time chip on issue row (for stopped tickets in regular list)
  const totalMs = ttGetTotalMs(key);
  document.querySelectorAll(`.issue-item[data-key="${key}"] .issue-key`).forEach(el => {
    let chip = el.querySelector('.tt-time-chip');
    if (totalMs > 0) {
      if (chip) chip.textContent = ttFormatMsCompact(totalMs);
    } else if (chip) {
      chip.remove();
    }
  });
}

function bindSessionHistoryEvents(container) {
  container.querySelectorAll('[data-session-toggle]').forEach(btn => {
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      const wrap = btn.closest('.tt-session-entry-wrap');
      const body = wrap?.querySelector('.tt-session-notes-body');
      if (!body) return;
      const open = !body.classList.contains('hidden');
      body.classList.toggle('hidden');
      btn.textContent = open ? '▾ Notes' : '▴ Notes';
    });
  });

  container.querySelectorAll('.tt-session-delete').forEach(btn => {
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      const wrap     = btn.closest('.tt-session-entry-wrap');
      const key      = wrap?.dataset.sessionKey;
      const startTs  = Number(wrap?.dataset.sessionStart);
      if (!key || !startTs) return;
      ttDeleteSession(key, startTs);
      ttRefreshSessionHistory(key);
    });
  });

  container.querySelectorAll('.tt-session-notes-save').forEach(btn => {
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      const key     = btn.dataset.sessionNotesKey;
      const startTs = Number(btn.dataset.sessionNotesStart);
      const ta      = btn.closest('.tt-session-notes-body')?.querySelector('.tt-session-notes-ta');
      if (!key || !startTs || !ta) return;
      const e = ttTracker[key];
      if (!e) return;
      const sess = e.sessions.find(s => s.startTs === startTs);
      if (!sess) return;
      sess.notes = ta.value;
      ttSave();
      btn.textContent = 'Saved ✓';
      setTimeout(() => { btn.textContent = 'Save'; }, 1500);
    });
  });
}

function bindTTSection(container) {
  container.querySelectorAll('[data-tt-open]').forEach(el => {
    el.addEventListener('click', ev => {
      ev.stopPropagation();
      openIssue(el.dataset.ttOpen);
    });
  });

  container.querySelectorAll('[data-tt-play]').forEach(btn => {
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      const key = btn.dataset.ttPlay;
      const e   = ttTracker[key];
      if (!e) return;
      if (e.state === 'running') ttPause(key);
      else ttStart(key, e.summary);
    });
  });

  container.querySelectorAll('[data-tt-stop]').forEach(btn => {
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      const key = btn.dataset.ttStop;
      const row = btn.closest('.tt-issue-row');
      if (!row) return;

      const existing = row.querySelector('.tt-stop-confirm');
      if (existing) { existing.remove(); return; }

      const confirmEl = document.createElement('div');
      confirmEl.className = 'tt-stop-confirm';
      confirmEl.innerHTML = 'Stop timer? <button class="tt-stop-yes">Stop</button><button class="tt-stop-no">Cancel</button>';
      row.appendChild(confirmEl);

      confirmEl.querySelector('.tt-stop-yes').addEventListener('click', e => {
        e.stopPropagation();
        ttStop(key);
      });
      confirmEl.querySelector('.tt-stop-no').addEventListener('click', e => {
        e.stopPropagation();
        confirmEl.remove();
      });
    });
  });

  container.querySelectorAll('[data-tt-notes]').forEach(btn => {
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      const key   = btn.dataset.ttNotes;
      const panel = container.querySelector(`.tt-notes-panel[data-notes-key="${key}"]`);
      if (panel) panel.classList.toggle('hidden');
    });
  });

  container.querySelectorAll('[data-tt-notes-ta]').forEach(ta => {
    ta.addEventListener('input', () => {
      const key = ta.dataset.ttNotesTa;
      clearTimeout(ttNotesDebounce);
      ttNotesDebounce = setTimeout(() => ttSetNotes(key, ta.value), 500);
    });
  });

  container.querySelectorAll('[data-tt-save]').forEach(btn => {
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      const key = btn.dataset.ttSave;
      const ta  = container.querySelector(`[data-tt-notes-ta="${key}"]`);
      if (ta) ttSetNotes(key, ta.value);
      btn.textContent = 'Saved ✓';
      setTimeout(() => { btn.textContent = 'Save'; }, 1500);
    });
  });

  bindSessionHistoryEvents(container);
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

  JiraAPI.getCurrentUser()
    .then(u => {
      const label = document.getElementById('user-label');
      label.textContent = u.displayName || u.name || '';
    })
    .catch(() => {});

  chrome.storage.local.get(
    ['watchCount', 'dismissedReturned', 'mentionCount', 'pendingAssignments'],
    ({ watchCount = 0, dismissedReturned = [], mentionCount = 0, pendingAssignments = [] }) => {
      const returnedCount = Math.max(0, watchCount - dismissedReturned.length);
      const notifCount    = returnedCount + (mentionCount || 0) + pendingAssignments.length;
      if (notifCount > 0) updateNotificationsBadge(notifCount);
    }
  );

  // Load persisted state before rendering issues
  chrome.storage.local.get(['timeTracking', 'pinnedTaskIds'], d => {
    ttTracker    = d.timeTracking || {};
    pinnedTaskIds = new Set(d.pinnedTaskIds || []);
    ttRenderNavChips();
    if (ttGetActive().length) ttEnsureTick();
    loadMyIssues();
  });
}

init();

// ── Create Issue ──────────────────────────────────────────────────────────────

const ciPanel = document.getElementById('create-issue-panel');

let ciSelectedLabels = [];
let ciAssignee       = null;  // { name, displayName }
let ciLinkTypes      = [];

// ── open / close ──

function ciOpen() {
  document.getElementById('main-content').classList.add('hidden');
  ciPanel.classList.remove('hidden');
  ciResetForm();
  ciLoadInitialData();
}

function ciClose() {
  ciPanel.classList.add('hidden');
  document.getElementById('main-content').classList.remove('hidden');
}

// ── form reset ──

function ciResetForm() {
  document.getElementById('ci-project').innerHTML    = '<option value="">Loading…</option>';
  document.getElementById('ci-issuetype').innerHTML  = '<option value="">—</option>';
  document.getElementById('ci-summary').value        = '';
  document.getElementById('ci-description').value    = '';
  document.getElementById('ci-labels-chips').innerHTML = '';
  document.getElementById('ci-labels-input').value   = '';
  document.getElementById('ci-assignee-input').value = '';
  document.getElementById('ci-assignee-name').value  = '';
  document.getElementById('ci-estimate').value       = '';
  document.getElementById('ci-remaining').value      = '';
  document.getElementById('ci-links-list').innerHTML = '';
  document.getElementById('ci-error').classList.add('hidden');
  document.getElementById('ci-advanced-body').classList.remove('ci-adv-open');
  document.getElementById('ci-advanced-btn').textContent = 'Advanced ▾';
  const sub = document.getElementById('ci-submit-btn');
  sub.disabled = false;
  sub.textContent = 'Create';
  sub.style.background = '';
  ciSelectedLabels = [];
  ciAssignee = null;
}

// ── load data on open ──

async function ciLoadInitialData() {
  try {
    const [projects, me, linkData, stored] = await Promise.all([
      JiraAPI.getProjects(),
      JiraAPI.getCurrentUser(),
      JiraAPI.getLinkTypes(),
      new Promise(r => chrome.storage.local.get('defaultProject', r)),
    ]);

    ciLinkTypes = linkData.issueLinkTypes || [];

    const projectSel   = document.getElementById('ci-project');
    const sorted       = (projects || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    const defaultKey   = stored.defaultProject || '';
    projectSel.innerHTML = sorted
      .map(p => `<option value="${escHtml(p.key)}">${escHtml(p.name)} (${escHtml(p.key)})</option>`)
      .join('');

    if (defaultKey && sorted.find(p => p.key === defaultKey)) {
      projectSel.value = defaultKey;
    }
    if (projectSel.value) ciLoadIssueTypes(projectSel.value);

    ciAssignee = {
      name: me.name || me.accountId || '',
      displayName: me.displayName || me.name || '',
    };
    document.getElementById('ci-assignee-input').value = ciAssignee.displayName;
    document.getElementById('ci-assignee-name').value  = ciAssignee.name;
  } catch (err) {
    document.getElementById('ci-project').innerHTML = '<option value="">Failed to load</option>';
    console.error('ciLoadInitialData', err);
  }
}

async function ciLoadIssueTypes(projectKey) {
  const sel = document.getElementById('ci-issuetype');
  sel.innerHTML = '<option value="">Loading…</option>';
  try {
    const meta  = await JiraAPI.getCreateMeta(projectKey);
    const types = (meta.issuetypes || []).filter(t => !t.subtask);
    if (!types.length) { sel.innerHTML = '<option value="">None available</option>'; return; }
    sel.innerHTML = types.map(t =>
      `<option value="${escHtml(t.id)}" data-name="${escHtml(t.name)}">${escHtml(t.name)}</option>`
    ).join('');
    const taskOpt = [...sel.options].find(o => o.dataset.name?.toLowerCase() === 'task');
    if (taskOpt) sel.value = taskOpt.value;
  } catch (err) {
    console.error('ciLoadIssueTypes', err);
    sel.innerHTML = '<option value="">Failed to load</option>';
  }
}

// ── label chips ──

function ciRenderLabels() {
  const container = document.getElementById('ci-labels-chips');
  container.innerHTML = ciSelectedLabels.map((l, i) =>
    `<span class="ci-tag-chip">${escHtml(l)}<button class="ci-tag-remove" data-idx="${i}" tabindex="-1">×</button></span>`
  ).join('');
  container.querySelectorAll('.ci-tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      ciSelectedLabels.splice(Number(btn.dataset.idx), 1);
      ciRenderLabels();
    });
  });
}

function ciAddLabel(val) {
  const v = val.trim();
  if (v && !ciSelectedLabels.includes(v)) {
    ciSelectedLabels.push(v);
    ciRenderLabels();
  }
  document.getElementById('ci-labels-input').value = '';
  ciCloseDD('ci-labels-dropdown');
}

// ── dropdown helpers ──
// Dropdowns use position:fixed to escape overflow clipping inside scrollable containers.

function ciPositionDD(ddEl, anchorEl) {
  const rect   = anchorEl.getBoundingClientRect();
  ddEl.style.top   = `${rect.bottom + 2}px`;
  ddEl.style.left  = `${rect.left}px`;
  ddEl.style.width = `${rect.width}px`;
}

function ciOpenDD(ddId, anchorEl, items, onSelect) {
  const dd = document.getElementById(ddId);
  if (!items.length) { ciCloseDD(ddId); return; }
  ciPositionDD(dd, anchorEl);
  dd.innerHTML = items.map((item, i) => {
    const label = typeof item === 'string' ? item : item.label;
    const key   = item.key ? `<span class="ci-dd-item-key">${escHtml(item.key)}</span>` : '';
    return `<div class="ci-dd-item" data-idx="${i}">${key}${escHtml(label)}</div>`;
  }).join('');
  dd.classList.add('ci-dd-open');
  dd.querySelectorAll('.ci-dd-item').forEach((el, i) => {
    el.addEventListener('mousedown', e => { e.preventDefault(); onSelect(items[i]); });
  });
}

function ciCloseDD(ddId) {
  const dd = document.getElementById(ddId);
  if (dd) { dd.classList.remove('ci-dd-open'); dd.innerHTML = ''; }
}

function ciOpenDDEl(ddEl, anchorEl, items, onSelect) {
  if (!items.length) { ddEl.classList.remove('ci-dd-open'); ddEl.innerHTML = ''; return; }
  ciPositionDD(ddEl, anchorEl);
  ddEl.innerHTML = items.map((item, i) =>
    `<div class="ci-dd-item" data-idx="${i}"><span class="ci-dd-item-key">${escHtml(item.key)}</span>${escHtml(item.summary)}</div>`
  ).join('');
  ddEl.classList.add('ci-dd-open');
  ddEl.querySelectorAll('.ci-dd-item').forEach((el, i) => {
    el.addEventListener('mousedown', e => { e.preventDefault(); onSelect(items[i]); });
  });
}

// ── label input binding ──

function ciBindLabelInput() {
  const input = document.getElementById('ci-labels-input');
  document.getElementById('ci-labels-wrap').addEventListener('click', () => input.focus());

  let debounce = null;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    const q = input.value.trim();
    if (!q) { ciCloseDD('ci-labels-dropdown'); return; }
    debounce = setTimeout(async () => {
      const suggestions = await JiraAPI.searchLabels(q);
      // Exclude already-selected labels; always keep the literal typed value as first option
      const filtered = suggestions.filter(l => !ciSelectedLabels.includes(l));
      if (!ciSelectedLabels.includes(q) && !filtered.includes(q)) filtered.unshift(q);
      ciOpenDD('ci-labels-dropdown', document.getElementById('ci-labels-wrap'), filtered.slice(0, 8), item => {
        ciAddLabel(typeof item === 'string' ? item : item.label);
        input.focus();
      });
    }, 200);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const v = input.value.trim().replace(/,$/, '');
      if (v) ciAddLabel(v);
    } else if (e.key === 'Backspace' && !input.value && ciSelectedLabels.length) {
      ciSelectedLabels.pop();
      ciRenderLabels();
    } else if (e.key === 'Escape') {
      ciCloseDD('ci-labels-dropdown');
    }
  });
  input.addEventListener('blur', () => setTimeout(() => ciCloseDD('ci-labels-dropdown'), 150));
}

// ── assignee input binding ──

function ciBindAssigneeInput() {
  const input   = document.getElementById('ci-assignee-input');
  const hiddenN = document.getElementById('ci-assignee-name');
  let debounce  = null;

  input.addEventListener('input', () => {
    ciAssignee = null;
    hiddenN.value = '';
    clearTimeout(debounce);
    const q = input.value.trim();
    if (!q) { ciCloseDD('ci-assignee-dropdown'); return; }
    debounce = setTimeout(async () => {
      try {
        const users = await JiraAPI.searchUsers(q);
        const items = (users || []).map(u => ({
          label: u.displayName || u.name || '',
          name:  u.name || u.accountId || '',
        }));
        ciOpenDD('ci-assignee-dropdown', input, items, item => {
          ciAssignee    = item;
          input.value   = item.label;
          hiddenN.value = item.name;
          ciCloseDD('ci-assignee-dropdown');
        });
      } catch { ciCloseDD('ci-assignee-dropdown'); }
    }, 250);
  });

  input.addEventListener('blur',    () => setTimeout(() => ciCloseDD('ci-assignee-dropdown'), 150));
  input.addEventListener('keydown', e => { if (e.key === 'Escape') ciCloseDD('ci-assignee-dropdown'); });
}

// ── linked issue row ──

function ciAddLinkRow() {
  const list = document.getElementById('ci-links-list');
  const row  = document.createElement('div');
  row.className = 'ci-link-row';

  const seen    = new Set();
  const options = [];
  for (const lt of ciLinkTypes) {
    for (const dir of ['outward', 'inward']) {
      const lbl = lt[dir];
      if (!seen.has(lbl)) {
        seen.add(lbl);
        options.push({ value: `${lt.id}:${dir}`, label: lbl });
      }
    }
  }

  row.innerHTML = `
    <select class="ci-link-type-sel">
      ${options.map(o => `<option value="${escHtml(o.value)}">${escHtml(o.label)}</option>`).join('')}
    </select>
    <div class="ci-link-row-issue">
      <input class="ci-link-issue-input" type="text" placeholder="Issue key or summary…" autocomplete="off" />
      <div class="ci-dropdown ci-link-dd"></div>
    </div>
    <button class="ci-link-remove" title="Remove">×</button>`;

  list.appendChild(row);
  row.querySelector('.ci-link-remove').addEventListener('click', () => row.remove());
  ciBindLinkIssueInput(row);
}

function ciBindLinkIssueInput(row) {
  const input = row.querySelector('.ci-link-issue-input');
  const dd    = row.querySelector('.ci-link-dd');
  let debounce = null;

  input.addEventListener('input', () => {
    clearTimeout(debounce);
    const q = input.value.trim();
    if (!q) { dd.classList.remove('ci-dd-open'); dd.innerHTML = ''; return; }
    debounce = setTimeout(async () => {
      try {
        const data   = await JiraAPI.searchIssues(q);
        const issues = (data.issues || []).slice(0, 7)
          .map(iss => ({ key: iss.key, summary: (iss.fields.summary || '').slice(0, 55) }));
        ciOpenDDEl(dd, input, issues, item => {
          input.value = item.key;
          dd.classList.remove('ci-dd-open');
          dd.innerHTML = '';
        });
      } catch { dd.classList.remove('ci-dd-open'); }
    }, 300);
  });

  input.addEventListener('blur', () => setTimeout(() => { dd.classList.remove('ci-dd-open'); dd.innerHTML = ''; }, 150));
}

// ── submit ──

async function ciSubmit() {
  const projectKey = document.getElementById('ci-project').value;
  const issueTypeEl = document.getElementById('ci-issuetype');
  const summary    = document.getElementById('ci-summary').value.trim();
  const description = document.getElementById('ci-description').value.trim();
  const errorEl    = document.getElementById('ci-error');
  const submitBtn  = document.getElementById('ci-submit-btn');

  errorEl.classList.add('hidden');
  if (!projectKey)       { ciShowError('Project is required.'); return; }
  if (!issueTypeEl.value){ ciShowError('Issue Type is required.'); return; }
  if (!summary)          { ciShowError('Summary is required.'); return; }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating…';

  const fields = {
    project:   { key: projectKey },
    issuetype: { id: issueTypeEl.value },
    summary,
  };
  if (description)          fields.description = description;
  if (ciSelectedLabels.length) fields.labels   = [...ciSelectedLabels];

  const assigneeName = document.getElementById('ci-assignee-name').value;
  if (assigneeName) fields.assignee = { name: assigneeName };

  const advOpen = document.getElementById('ci-advanced-body').classList.contains('ci-adv-open');
  if (advOpen) {
    const estimate  = document.getElementById('ci-estimate').value.trim();
    const remaining = document.getElementById('ci-remaining').value.trim();
    if (estimate || remaining) {
      fields.timetracking = {};
      if (estimate)  fields.timetracking.originalEstimate  = estimate;
      if (remaining) fields.timetracking.remainingEstimate = remaining;
    }
  }

  try {
    const created = await JiraAPI.createIssue(fields);
    const newKey  = created.key;

    if (advOpen) {
      const linkRows = document.querySelectorAll('#ci-links-list .ci-link-row');
      for (const rowEl of linkRows) {
        const typeVal  = rowEl.querySelector('.ci-link-type-sel').value;
        const issueKey = rowEl.querySelector('.ci-link-issue-input').value.trim().toUpperCase();
        if (!issueKey || !typeVal) continue;
        const [typeId, dir] = typeVal.split(':');
        const payload = dir === 'outward'
          ? { type: { id: typeId }, outwardIssue: { key: newKey },     inwardIssue: { key: issueKey } }
          : { type: { id: typeId }, outwardIssue: { key: issueKey },   inwardIssue: { key: newKey } };
        try { await JiraAPI.createIssueLink(payload); } catch (e) { console.warn('link failed', e); }
      }
    }

    submitBtn.textContent  = `Created ${newKey} ✓`;
    submitBtn.style.background = '#36B37E';
    setTimeout(() => { ciClose(); loadMyIssues(); }, 1800);

  } catch (err) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create';
    ciShowError(friendlyError(err));
  }
}

function ciShowError(msg) {
  const el = document.getElementById('ci-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ── bind all events ──

(function ciInit() {
  document.getElementById('create-btn').addEventListener('click', ciOpen);
  document.getElementById('ci-close-btn').addEventListener('click', ciClose);
  document.getElementById('ci-cancel-btn').addEventListener('click', ciClose);

  document.getElementById('ci-project').addEventListener('change', e => {
    ciLoadIssueTypes(e.target.value);
  });

  document.getElementById('ci-advanced-btn').addEventListener('click', () => {
    const body = document.getElementById('ci-advanced-body');
    const btn  = document.getElementById('ci-advanced-btn');
    const open = body.classList.toggle('ci-adv-open');
    btn.textContent = open ? 'Advanced ▴' : 'Advanced ▾';
  });

  document.getElementById('ci-add-link-btn').addEventListener('click', ciAddLinkRow);
  document.getElementById('ci-submit-btn').addEventListener('click', ciSubmit);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !ciPanel.classList.contains('hidden')) ciClose();
  });

  ciBindLabelInput();
  ciBindAssigneeInput();
}());
