const JiraAPI = {
  async getSettings() {
    return new Promise(resolve =>
      chrome.storage.local.get(['jiraUrl', 'jiraPat'], resolve)
    );
  },

  async request(path, options = {}) {
    const { jiraUrl, jiraPat } = await this.getSettings();
    if (!jiraUrl || !jiraPat) throw new Error('NOT_CONFIGURED');

    const base = jiraUrl.replace(/\/$/, '');
    const url = `${base}/rest/api/2/${path}`;

    const res = await fetch(url, {
      ...options,
      credentials: 'omit',
      headers: {
        Authorization: `Bearer ${jiraPat}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Atlassian-Token': 'no-check',
        ...(options.headers || {}),
      },
    });

    if (res.status === 401) throw new Error('UNAUTHORIZED');
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP_${res.status}: ${text.slice(0, 200)}`);
    }

    const body = await res.text().catch(() => '');
    return body ? JSON.parse(body) : null;
  },

  _currentUser: null,

  async getCurrentUser() {
    if (!this._currentUser) {
      this._currentUser = await this.request('myself');
      const username = this._currentUser.name || this._currentUser.accountId;
      if (username) chrome.storage.local.set({ jiraUsername: username });
    }
    return this._currentUser;
  },

  _sameUser(author, me) {
    if (me.accountId && author.accountId) return author.accountId === me.accountId;
    if (me.name && author.name) return author.name === me.name;
    if (me.key && author.key) return author.key === me.key;
    return false;
  },

  async getWatchingIssues(excludeDone = true) {
    const base = 'watcher = currentUser()';
    const jql  = excludeDone ? `${base} AND status != Done` : base;
    return this.request(
      `search?jql=${encodeURIComponent(jql + ' ORDER BY updated DESC')}&maxResults=50&fields=summary,status,priority,issuetype,project`
    );
  },

  async getWatchedIssues(jql) {
    return this.request(
      `search?jql=${encodeURIComponent(jql)}&maxResults=30&fields=summary,status,priority,issuetype,project`
    );
  },

  async getLoggedWork(startDate, endDate) {
    const jql = encodeURIComponent(
      `worklogAuthor = currentUser() AND worklogDate >= "${startDate}" AND worklogDate <= "${endDate}"`
    );
    const search = await this.request(
      `search?jql=${jql}&maxResults=50&fields=summary`
    );
    if (!search.issues?.length) return [];

    const me = await this.getCurrentUser();

    const rows = await Promise.all(
      search.issues.map(async issue => {
        const wlData = await this.request(`issue/${issue.key}/worklog?maxResults=1000`);
        const mine = (wlData.worklogs || []).filter(w => {
          const d = w.started.slice(0, 10);
          return d >= startDate && d <= endDate && this._sameUser(w.author, me);
        });
        if (!mine.length) return null;
        return {
          key: issue.key,
          summary: issue.fields.summary || '',
          totalSeconds: mine.reduce((s, w) => s + w.timeSpentSeconds, 0),
        };
      })
    );

    return rows
      .filter(Boolean)
      .sort((a, b) => b.totalSeconds - a.totalSeconds);
  },

  async getMyIssues() {
    const jql = encodeURIComponent(
      'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC'
    );
    return this.request(
      `search?jql=${jql}&maxResults=30&fields=summary,status,priority,issuetype,project`
    );
  },

  async searchIssues(query) {
    const escaped = query.replace(/"/g, '\\"');
    const jql = encodeURIComponent(
      `text ~ "${escaped}" AND resolution = Unresolved ORDER BY updated DESC`
    );
    return this.request(
      `search?jql=${jql}&maxResults=20&fields=summary,status,priority,issuetype,project`
    );
  },

  async getIssue(key) {
    return this.request(
      `issue/${key}?fields=summary,status,priority,issuetype,project,description,assignee,reporter,comment`
    );
  },

  async getIssueDetails(key) {
    const fields = [
      'summary', 'description', 'issuetype', 'status', 'priority',
      'created', 'updated', 'assignee', 'reporter',
      'timeoriginalestimate', 'timeestimate', 'timespent',
      'labels', 'issuelinks', 'subtasks', 'parent',
      'customfield_10014', 'customfield_10008',
    ].join(',');
    return this.request(`issue/${key}?fields=${fields}&expand=renderedFields`);
  },

  async getReturnedNotifications() {
    const { watchJql, dismissedReturned = [] } = await new Promise(r =>
      chrome.storage.local.get(['watchJql', 'dismissedReturned'], r)
    );
    if (!watchJql) return [];

    const data = await this.getWatchedIssues(watchJql);
    return (data.issues || [])
      .filter(i => !dismissedReturned.includes(i.key))
      .map(i => ({
        key: i.key,
        summary: i.fields.summary || '',
        status: i.fields.status?.name || '',
        typeName: i.fields.issuetype?.name || '',
        priorityName: i.fields.priority?.name || 'Medium',
      }));
  },

  async getAssignmentNotifications() {
    const { pendingAssignments = [] } = await new Promise(r =>
      chrome.storage.local.get('pendingAssignments', r)
    );
    if (!pendingAssignments.length) return [];

    const me = await this.getCurrentUser();

    const results = await Promise.all(
      pendingAssignments.map(async key => {
        try {
          const issue = await this.request(
            `issue/${key}?fields=summary,status,issuetype,assignee`
          );
          const f = issue.fields;
          if (!f.assignee || !this._sameUser(f.assignee, me)) return null;
          return { key, summary: f.summary || '', status: f.status?.name || '' };
        } catch {
          return null;
        }
      })
    );

    const valid = results.filter(Boolean);
    // Clean stale keys (no longer assigned / deleted)
    const validKeys = valid.map(r => r.key);
    if (validKeys.length !== pendingAssignments.length) {
      chrome.storage.local.set({ pendingAssignments: pendingAssignments.filter(k => validKeys.includes(k)) });
    }
    return valid;
  },

  async getMentions() {
    const me = await this.getCurrentUser();
    const username = me.name || me.accountId;
    const mentionPattern = `[~${username}]`;

    const { dismissedMentions = [] } = await new Promise(r =>
      chrome.storage.local.get('dismissedMentions', r)
    );

    const jql = encodeURIComponent(`comment ~ "${username}" ORDER BY updated DESC`);
    const search = await this.request(
      `search?jql=${jql}&maxResults=15&fields=summary`
    );

    if (!search.issues?.length) return [];

    const results = await Promise.all(
      search.issues.map(async issue => {
        const wlData = await this.request(`issue/${issue.key}/comment?orderBy=created&maxResults=1000`);
        const comments = wlData.comments || [];

        const mentioning = comments.filter(c => c.body?.includes(mentionPattern));
        if (!mentioning.length) return null;

        const last = mentioning[mentioning.length - 1];
        const dismissKey = `${issue.key}:${last.id}`;
        if (dismissedMentions.includes(dismissKey)) return null;

        const responded = comments.some(c =>
          this._sameUser(c.author, me) && new Date(c.created) > new Date(last.created)
        );
        if (responded) return null;

        return {
          issueKey: issue.key,
          summary: issue.fields.summary || '',
          commentId: last.id,
          body: last.body || '',
          author: last.author?.displayName || last.author?.name || 'Unknown',
          date: last.created,
          dismissKey,
        };
      })
    );

    return results.filter(Boolean);
  },

  async getProjects() {
    return this.request('project?maxResults=100');
  },

  async getCreateMeta(projectKey) {
    // Jira 9+ exposes per-project endpoint; older versions use the legacy createmeta
    try {
      const data = await this.request(
        `issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes?maxResults=50`
      );
      return { issuetypes: data.values || [] };
    } catch (err) {
      if (!err.message.startsWith('HTTP_404') && !err.message.startsWith('HTTP_405')) throw err;
    }
    const data = await this.request(
      `issue/createmeta?projectKeys=${encodeURIComponent(projectKey)}&expand=projects.issuetypes`
    );
    const project = (data.projects || []).find(p => p.key === projectKey);
    return { issuetypes: project?.issuetypes || [] };
  },

  async searchLabels(query) {
    const q = encodeURIComponent(query);
    // Jira's dedicated label suggest endpoint (works on Server/DC)
    try {
      const data = await this.request(
        `../1.0/labels/suggest?query=${q}&maxResults=10`
      );
      const suggestions = data?.suggestions || [];
      return suggestions.map(s => (typeof s === 'string' ? s : s.label)).filter(Boolean);
    } catch {}
    // Fallback: standard label list endpoint, filter client-side
    try {
      const data = await this.request('label?maxResults=200');
      const all = Array.isArray(data) ? data : (data?.values || []);
      return all.filter(l => l.toLowerCase().includes(query.toLowerCase())).slice(0, 10);
    } catch {}
    return [];
  },

  async searchUsers(query) {
    return this.request(
      `user/search?username=${encodeURIComponent(query)}&maxResults=10&includeActive=true`
    );
  },

  async getLinkTypes() {
    return this.request('issueLinkType');
  },

  async createIssue(fields) {
    return this.request('issue', {
      method: 'POST',
      body: JSON.stringify({ fields }),
    });
  },

  async createIssueLink(payload) {
    return this.request('issueLink', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async getTransitions(issueKey) {
    return this.request(`issue/${issueKey}/transitions`);
  },

  async transitionIssue(issueKey, transitionId) {
    return this.request(`issue/${issueKey}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ transition: { id: transitionId } }),
    });
  },

  async logWork(issueKey, timeSpentSeconds, started, comment) {
    const body = { timeSpentSeconds, started };
    if (comment) body.comment = comment;
    return this.request(`issue/${issueKey}/worklog`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  issueUrl(key) {
    return new Promise(resolve =>
      chrome.storage.local.get(['jiraUrl'], ({ jiraUrl }) =>
        resolve(`${(jiraUrl || '').replace(/\/$/, '')}/browse/${key}`)
      )
    );
  },
};
