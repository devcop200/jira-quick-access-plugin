const urlInput = document.getElementById('jira-url');
const patInput = document.getElementById('jira-pat');
const saveBtn = document.getElementById('save-btn');
const testBtn = document.getElementById('test-btn');
const statusMsg = document.getElementById('status-msg');
const saveIndicator = document.getElementById('save-indicator');

function showStatus(msg, type) {
  statusMsg.innerHTML = msg;
  statusMsg.className = `status visible ${type}`;
}

function clearStatus() {
  statusMsg.className = 'status';
}

// Load saved settings
chrome.storage.local.get(['jiraUrl', 'jiraPat'], ({ jiraUrl, jiraPat }) => {
  if (jiraUrl) urlInput.value = jiraUrl;
  if (jiraPat) patInput.value = jiraPat;
});

async function requestHostPermission(url) {
  try {
    return await chrome.permissions.request({ origins: [`${url}/*`] });
  } catch {
    return false;
  }
}

// Save
saveBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim().replace(/\/$/, '');
  const pat = patInput.value.trim();

  if (!url) { showStatus('Please enter the Jira URL.', 'error'); return; }
  if (!pat)  { showStatus('Please enter a Personal Access Token.', 'error'); return; }

  const granted = await requestHostPermission(url);
  if (!granted) {
    showStatus('Browser permission to access this URL was denied.', 'error');
    return;
  }

  chrome.storage.local.set({ jiraUrl: url, jiraPat: pat }, () => {
    clearStatus();
    saveIndicator.classList.add('visible');
    setTimeout(() => saveIndicator.classList.remove('visible'), 2500);
  });
});

// Test connection
testBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim().replace(/\/$/, '');
  const pat = patInput.value.trim();

  if (!url || !pat) {
    showStatus('Fill in both fields before testing.', 'error');
    return;
  }

  const granted = await requestHostPermission(url);
  if (!granted) {
    showStatus('Browser permission to access this URL was denied.', 'error');
    return;
  }

  testBtn.disabled = true;
  testBtn.textContent = 'Testing…';
  showStatus('Connecting to Jira…', 'info');

  try {
    // Save temporarily so api.js can read them
    await new Promise(r => chrome.storage.local.set({ jiraUrl: url, jiraPat: pat }, r));

    const user = await JiraAPI.getCurrentUser();

    const initials = (user.displayName || user.name || '?')
      .split(' ')
      .map(w => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

    showStatus(`
      <div class="user-card">
        <div class="user-avatar">${initials}</div>
        <div class="user-info">
          <div class="user-name">Connected as ${user.displayName || user.name}</div>
          <div class="user-email">${user.emailAddress || ''}</div>
        </div>
      </div>
    `, 'success');

    // Persist since test succeeded
    saveIndicator.classList.add('visible');
    setTimeout(() => saveIndicator.classList.remove('visible'), 2500);

  } catch (err) {
    if (err.message === 'UNAUTHORIZED') {
      showStatus('Authentication failed — check your PAT.', 'error');
    } else if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
      showStatus('Cannot reach Jira. Make sure your VPN is connected and the URL is correct.', 'error');
    } else {
      showStatus(`Connection error: ${err.message}`, 'error');
    }
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = 'Test Connection';
  }
});

// Clear status on input change
[urlInput, patInput].forEach(el => el.addEventListener('input', clearStatus));

// ── Watching settings ──────────────────────────────────────────────────────────

const watchingExcludeDoneInput = document.getElementById('watching-exclude-done');

chrome.storage.local.get('watchingExcludeDone', ({ watchingExcludeDone }) => {
  watchingExcludeDoneInput.checked = watchingExcludeDone !== false;
});

watchingExcludeDoneInput.addEventListener('change', () => {
  chrome.storage.local.set({ watchingExcludeDone: watchingExcludeDoneInput.checked });
});

// ── Notification settings ──────────────────────────────────────────────────────

const notifyReturnedInput     = document.getElementById('notify-returned');
const notifyMentionsInput     = document.getElementById('notify-mentions');
const notifyAssignmentsInput  = document.getElementById('notify-assignments');

chrome.storage.local.get(
  ['notifyReturned', 'notifyMentions', 'notifyAssignments'],
  ({ notifyReturned, notifyMentions, notifyAssignments }) => {
    notifyReturnedInput.checked    = notifyReturned    !== false;
    notifyMentionsInput.checked    = notifyMentions    !== false;
    notifyAssignmentsInput.checked = notifyAssignments !== false;
  }
);

notifyReturnedInput.addEventListener('change', () => {
  chrome.storage.local.set({ notifyReturned: notifyReturnedInput.checked });
});
notifyMentionsInput.addEventListener('change', () => {
  chrome.storage.local.set({ notifyMentions: notifyMentionsInput.checked });
});
notifyAssignmentsInput.addEventListener('change', () => {
  chrome.storage.local.set({ notifyAssignments: notifyAssignmentsInput.checked });
});

// ── Watch Filter ───────────────────────────────────────────────────────────────

const watchJqlInput = document.getElementById('watch-jql');
const saveWatchBtn  = document.getElementById('save-watch-btn');
const testWatchBtn  = document.getElementById('test-watch-btn');
const watchStatusEl = document.getElementById('watch-status');
const watchSaveInd  = document.getElementById('watch-save-ind');

function showWatchStatus(msg, type) {
  watchStatusEl.innerHTML = msg;
  watchStatusEl.className = `status visible ${type}`;
}

chrome.storage.local.get(['watchJql'], ({ watchJql }) => {
  if (watchJql) watchJqlInput.value = watchJql;
});

saveWatchBtn.addEventListener('click', () => {
  const jql = watchJqlInput.value.trim();
  chrome.storage.local.set({ watchJql: jql }, () => {
    watchStatusEl.className = 'status';
    watchSaveInd.classList.add('visible');
    setTimeout(() => watchSaveInd.classList.remove('visible'), 2500);
  });
});

testWatchBtn.addEventListener('click', async () => {
  const jql = watchJqlInput.value.trim();
  if (!jql) { showWatchStatus('Enter a JQL filter first.', 'error'); return; }

  testWatchBtn.disabled = true;
  testWatchBtn.textContent = 'Testing…';
  showWatchStatus('Fetching…', 'info');

  try {
    await new Promise(r => chrome.storage.local.set({ watchJql: jql }, r));
    const data = await JiraAPI.getWatchedIssues(jql);
    showWatchStatus(
      `Filter matched <strong>${data.total}</strong> issue${data.total !== 1 ? 's' : ''}.`,
      'success'
    );
  } catch (err) {
    const msg =
      err.message === 'UNAUTHORIZED'        ? 'Invalid token — check Connection settings.' :
      err.message.includes('HTTP_400')      ? 'Invalid JQL — check your filter syntax.' :
      err.message.includes('Failed to fetch') ? 'Cannot reach Jira. Make sure VPN is connected.' :
      `Error: ${err.message}`;
    showWatchStatus(msg, 'error');
  } finally {
    testWatchBtn.disabled = false;
    testWatchBtn.textContent = 'Test Filter';
  }
});

// ── Create Issue Defaults ──────────────────────────────────────────────────────

const defaultProjectSel  = document.getElementById('default-project');
const saveDefaultsBtn    = document.getElementById('save-defaults-btn');
const defaultsSaveInd    = document.getElementById('defaults-save-ind');
const defaultsStatusEl   = document.getElementById('defaults-status');

async function loadProjectsForDefaults() {
  const { jiraUrl, jiraPat } = await new Promise(r =>
    chrome.storage.local.get(['jiraUrl', 'jiraPat'], r)
  );
  if (!jiraUrl || !jiraPat) {
    defaultProjectSel.innerHTML = '<option value="">Configure connection first</option>';
    defaultProjectSel.disabled = true;
    return;
  }
  try {
    const projects = await JiraAPI.getProjects();
    const sorted   = (projects || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    defaultProjectSel.innerHTML =
      '<option value="">— None —</option>' +
      sorted.map(p => `<option value="${p.key}">${p.name} (${p.key})</option>`).join('');
    defaultProjectSel.disabled = false;

    const { defaultProject } = await new Promise(r => chrome.storage.local.get('defaultProject', r));
    if (defaultProject) defaultProjectSel.value = defaultProject;
  } catch {
    defaultProjectSel.innerHTML = '<option value="">Failed to load projects</option>';
    defaultProjectSel.disabled = true;
  }
}

saveDefaultsBtn.addEventListener('click', () => {
  const key = defaultProjectSel.value;
  chrome.storage.local.set({ defaultProject: key }, () => {
    defaultsStatusEl.className = 'status';
    defaultsSaveInd.classList.add('visible');
    setTimeout(() => defaultsSaveInd.classList.remove('visible'), 2500);
  });
});

loadProjectsForDefaults();

// ── Appearance / Theme ─────────────────────────────────────────────────────────

const themeSelect = document.getElementById('theme-select');

function applyTheme(theme) {
  const html = document.documentElement;
  if (theme === 'dark') {
    html.classList.add('dark');
  } else if (theme === 'light') {
    html.classList.remove('dark');
  } else {
    html.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
}

chrome.storage.local.get('theme', ({ theme }) => {
  themeSelect.value = theme || 'auto';
});

themeSelect.addEventListener('change', () => {
  const theme = themeSelect.value;
  chrome.storage.local.set({ theme });
  localStorage.setItem('jqa-theme', theme);
  applyTheme(theme);
});
