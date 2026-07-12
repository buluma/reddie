const http = require('http');
const https = require('https');

// Thin direct client for the real Redmine REST API - no Converge/any
// intermediary backend required. Every reddie install just needs a
// Redmine base URL + a personal API key (Settings, or REDMINE_BASE_URL/
// REDMINE_API_KEY in .env).

// `raw: true` sends `body` as-is (a Buffer, for the uploads endpoint,
// which wants the file's actual bytes) instead of JSON-encoding it -
// everything else about the request/response handling is identical.
function request(baseUrl, apiKey, path, method = 'GET', body = null, { raw = false, contentType } = {}) {
  return new Promise((resolve, reject) => {
    let uri;
    try {
      uri = new URL(path, baseUrl);
    } catch (err) {
      reject(err);
      return;
    }
    const transport = uri.protocol === 'https:' ? https : http;
    const payload = body ? (raw ? body : JSON.stringify(body)) : null;

    const headers = {
      'Content-Type': contentType || 'application/json',
      'X-Redmine-API-Key': apiKey,
    };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    const req = transport.request(
      {
        hostname: uri.hostname,
        port: uri.port || (uri.protocol === 'https:' ? 443 : 80),
        path: uri.pathname + uri.search,
        method,
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          const status = res.statusCode || 0;
          let parsed = null;
          if (data) {
            try {
              parsed = JSON.parse(data);
            } catch {
              parsed = null;
            }
          }
          if (status >= 200 && status < 300) {
            resolve(parsed || {});
          } else {
            const message =
              (parsed && parsed.errors && parsed.errors.join(', ')) ||
              (parsed && parsed.error) ||
              `Redmine request failed (${status})`;
            reject(new Error(message));
          }
        });
      },
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

class RedmineClient {
  constructor(baseUrl, apiKey) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  get(path) {
    return request(this.baseUrl, this.apiKey, path, 'GET');
  }

  put(path, body) {
    return request(this.baseUrl, this.apiKey, path, 'PUT', body);
  }

  post(path, body) {
    return request(this.baseUrl, this.apiKey, path, 'POST', body);
  }

  postRaw(path, buffer, contentType) {
    return request(this.baseUrl, this.apiKey, path, 'POST', buffer, { raw: true, contentType });
  }

  async getCurrentUser() {
    const result = await this.get('/users/current.json');
    return result.user;
  }

  async listStatuses() {
    const result = await this.get('/issue_statuses.json');
    return result.issue_statuses || [];
  }

  async listActivities() {
    const result = await this.get('/enumerations/time_entry_activities.json');
    return (result.time_entry_activities || []).filter((a) => a.active !== false);
  }

  async listPriorities() {
    const result = await this.get('/enumerations/issue_priorities.json');
    return (result.issue_priorities || []).filter((p) => p.active !== false);
  }

  updatePriority(issueId, priorityId) {
    return this.put(`/issues/${issueId}.json`, { issue: { priority_id: priorityId } });
  }

  updateSubject(issueId, subject) {
    return this.put(`/issues/${issueId}.json`, { issue: { subject } });
  }

  async uploadFile(buffer, filename, contentType) {
    // Redmine's attachment flow is two steps: upload the raw bytes to get
    // a one-time token, then reference that token from the issue update
    // below - the file itself is never sent as part of the issue PUT.
    const result = await this.postRaw(
      `/uploads.json?filename=${encodeURIComponent(filename)}`,
      buffer,
      contentType || 'application/octet-stream',
    );
    return result.upload.token;
  }

  attachToIssue(issueId, token, filename, contentType) {
    return this.put(`/issues/${issueId}.json`, {
      issue: {
        uploads: [{ token, filename, content_type: contentType || 'application/octet-stream' }],
      },
    });
  }

  async listProjects() {
    const result = await this.get('/projects.json?limit=100');
    return result.projects || [];
  }

  async listProjectTrackers(projectId) {
    // Trackers are enabled per-project, not global - /trackers.json lists
    // every tracker in the whole Redmine instance regardless of whether
    // it's actually usable on a given project, which lets a create-ticket
    // form offer an invalid project/tracker pairing. Redmine's own create
    // validation rejects that pairing with a confusing "Tracker cannot be
    // blank" rather than "invalid tracker" (confirmed against a real
    // instance), so this has to be scoped per-project from the start.
    const result = await this.get(`/projects/${projectId}.json?include=trackers`);
    return (result.project && result.project.trackers) || [];
  }

  createIssue({ projectId, trackerId, subject, description, assigneeId }) {
    return this.post('/issues.json', {
      issue: {
        project_id: projectId,
        tracker_id: trackerId,
        subject,
        description: description || '',
        ...(assigneeId ? { assigned_to_id: assigneeId } : {}),
      },
    });
  }

  async listMyIssues() {
    const result = await this.get(
      '/issues.json?assigned_to_id=me&status_id=*&limit=100&sort=updated_on:desc',
    );
    return result.issues || [];
  }

  // Tickets you created but reassigned to someone else drop out of
  // listMyIssues() entirely (it's assignee-filtered) - this is the only
  // way to keep track of them.
  async listAuthoredIssues() {
    const result = await this.get(
      '/issues.json?author_id=me&status_id=*&limit=100&sort=updated_on:desc',
    );
    return result.issues || [];
  }

  async getIssueDetail(issueId) {
    const [issueResult, timeEntriesResult] = await Promise.all([
      this.get(`/issues/${issueId}.json?include=journals,attachments,relations,allowed_statuses`),
      this.get(`/time_entries.json?issue_id=${issueId}&limit=100&sort=spent_on:desc`).catch(() => ({
        time_entries: [],
      })),
    ]);
    return {
      issue: issueResult.issue,
      timeEntries: timeEntriesResult.time_entries || [],
    };
  }

  updateStatus(issueId, statusId) {
    return this.put(`/issues/${issueId}.json`, { issue: { status_id: statusId } });
  }

  async listProjectMembers(projectId) {
    const result = await this.get(`/projects/${projectId}/memberships.json?limit=100`);
    // Memberships are per-role, so the same user can appear more than once
    // (one row per role they hold on the project) - dedupe by user id.
    // Group memberships have no `user` field at all - skip those, they
    // aren't valid issue assignees on their own.
    const byId = new Map();
    (result.memberships || []).forEach((m) => {
      if (m.user && !byId.has(m.user.id)) byId.set(m.user.id, m.user);
    });
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  updateAssignee(issueId, userId) {
    // Redmine clears the assignee when assigned_to_id is an empty string -
    // null/undefined would be dropped from the JSON body entirely and
    // leave the existing assignee untouched instead of unassigning.
    return this.put(`/issues/${issueId}.json`, { issue: { assigned_to_id: userId || '' } });
  }

  addComment(issueId, comment) {
    return this.put(`/issues/${issueId}.json`, { issue: { notes: comment } });
  }

  addTimeEntry(issueId, { hours, activityId, comment, spentOn }) {
    return this.post('/time_entries.json', {
      time_entry: {
        issue_id: Number(issueId),
        hours,
        activity_id: activityId,
        comments: comment || '',
        ...(spentOn ? { spent_on: spentOn } : {}),
      },
    });
  }
}

// Redmine ships New/In Progress/Resolved/Feedback/Closed by default and
// most custom instances keep those names even after adding more statuses
// (confirmed against redmine.nasctech.com's 22-status list) - classify by
// name/is_closed so this works without per-instance configuration, and
// pick one canonical status per column for the reverse (drag -> statusId)
// direction deterministically by ascending id.
function classifyStatus(status) {
  const name = (status.name || '').toLowerCase();
  if (status.is_closed) return 'done';
  // "Resolved" is one of Redmine's five default out-of-box statuses, but
  // isn't always flagged is_closed at the workflow level (confirmed on
  // redmine.nasctech.com) - treat it as done regardless.
  if (/resolved|success|complete|^pass$/.test(name)) return 'done';
  if (/progress|review|testing|dev|deploy/.test(name)) return 'in-progress';
  if (/feedback|hold|pause|wait|escalation|blocked/.test(name)) return 'todo';
  return 'backlog';
}

const VALID_COLUMNS = ['backlog', 'todo', 'in-progress', 'done'];

// `overrides` is a { [statusId]: columnName } map from a user's manual
// remapping (Settings > Column Mapping) - layered on top of the automatic
// name/is_closed classification. Not every Redmine instance's status names
// match the heuristic (see classifyStatus above), so this is the escape
// hatch rather than requiring instance-specific code changes.
function buildColumnMapping(statuses, overrides = {}) {
  const sorted = [...statuses].sort((a, b) => a.id - b.id);
  const statusIdToColumn = {};
  const columnToStatusId = {};
  for (const status of sorted) {
    const override = overrides[status.id];
    const column = VALID_COLUMNS.includes(override) ? override : classifyStatus(status);
    statusIdToColumn[status.id] = column;
    if (!(column in columnToStatusId)) {
      columnToStatusId[column] = status.id;
    }
  }
  return { statusIdToColumn, columnToStatusId };
}

module.exports = { RedmineClient, buildColumnMapping };
