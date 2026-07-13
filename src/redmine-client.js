const http = require('http');
const https = require('https');

// Cap on how long a single request may wait with no socket activity before
// it's abandoned. Node's http has no default timeout, so a dead host, a
// dropped VPN, or a stalled TLS handshake would otherwise leave the promise
// pending forever - the board spinner spins with no error path and no retry.
const REQUEST_TIMEOUT_MS = 30000;

// Thin direct client for the real Redmine REST API - no Converge/any
// intermediary backend required. Every reddie install just needs a
// Redmine base URL + a personal API key (Settings, or REDMINE_BASE_URL/
// REDMINE_API_KEY in .env).

// `raw: true` sends `body` as-is (a Buffer, for the uploads endpoint,
// which wants the file's actual bytes) instead of JSON-encoding it -
// everything else about the request/response handling is identical.
// `binary: true` is the response-side equivalent, for GETing attachment
// bytes (images embedded in a description/comment) - it collects the
// response as a Buffer and resolves { buffer, contentType } instead of
// JSON-parsing it, since JSON.parse on binary image data would fail (or
// worse, silently mangle it via the string coercion `data += chunk` does).
function requestOnce(baseUrl, apiKey, path, method = 'GET', body = null, { raw = false, contentType, binary = false } = {}) {
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
        const status = res.statusCode || 0;

        if (binary) {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            if (status >= 200 && status < 300) {
              resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] || 'application/octet-stream' });
            } else {
              // statusCode lets withRetry tell a transient 5xx from a 4xx.
              reject(Object.assign(new Error(`Redmine request failed (${status})`), { statusCode: status }));
            }
          });
          return;
        }

        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
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
            // statusCode lets withRetry tell a transient 5xx from a 4xx.
            reject(Object.assign(new Error(message), { statusCode: status }));
          }
        });
      },
    );

    req.on('error', reject);
    // 'timeout' fires on socket inactivity but does NOT abort the request on
    // its own - destroy() does, which then surfaces via the 'error' handler
    // above (or, if the socket never connected, ends the promise here).
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Redmine request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// How many times to retry a failed GET, and the base backoff between tries.
const MAX_GET_RETRIES = 2;
const RETRY_BACKOFF_MS = 300;

// Whether a failed request should be retried. GET is the only idempotent
// method here, so writes are never retried - a blind PUT/POST retry could
// double-post a comment or time entry. A missing statusCode means the request
// never got an HTTP response (network error / timeout), which is exactly the
// transient case worth retrying; a present statusCode is only transient for
// 5xx (a 4xx like 422/404/403 is a client error that won't fix itself).
function isRetriable(method, error) {
  if (method !== 'GET') return false;
  const status = error && error.statusCode;
  if (!status) return true;
  return status >= 500;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs `attempt` (a function returning a Promise), retrying transient GET
// failures with a linear backoff. Non-retriable failures reject immediately.
async function withRetry(attempt, { method = 'GET', retries = MAX_GET_RETRIES, backoffMs = RETRY_BACKOFF_MS } = {}) {
  for (let tries = 0; ; tries += 1) {
    try {
      return await attempt();
    } catch (err) {
      if (tries >= retries || !isRetriable(method, err)) throw err;
      await delay(backoffMs * (tries + 1));
    }
  }
}

// Public entry point: same signature as requestOnce, but wraps it so a
// transient GET failure is retried before it ever reaches a caller.
function request(baseUrl, apiKey, path, method = 'GET', body = null, options = {}) {
  return withRetry(() => requestOnce(baseUrl, apiKey, path, method, body, options), { method });
}

// Redmine caps `limit` at 100 per page and returns `total_count`, so any list
// longer than 100 is silently truncated unless the caller walks `offset` to
// the end. This is the shared paging loop behind every list endpoint: it's
// decoupled from HTTP via a fetchPage(offset, limit) callback that resolves
// { items, total_count }, so the loop itself is pure and unit-testable.
const PAGE_SIZE = 100;
// Safety cap so a server that lies about total_count (or always returns a full
// page) can't spin the board load forever - 1000 pages = 100k rows, far past
// anything a personal Redmine board realistically holds.
const MAX_PAGES = 1000;

async function collectAllPages(fetchPage, pageSize = PAGE_SIZE) {
  const all = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { items = [], total_count } = await fetchPage(offset, pageSize);
    all.push(...items);
    offset += pageSize;
    // total_count is authoritative when present; when it's missing we can't
    // assume a full page is the last one, so only a short/empty page ends it.
    const knownTotal = Number.isFinite(total_count) && total_count > 0 ? total_count : Infinity;
    if (items.length < pageSize || all.length >= knownTotal) break;
  }
  return all;
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

  // For images embedded in a description/comment (e.g. `![](attachments/download/61/foo.png)`
  // in Markdown) - those attachment URLs need the same X-Redmine-API-Key
  // header as everything else, which a plain <img src> can't send. Only
  // call this with a URL already confirmed to resolve to this same
  // Redmine instance (see main.js's fetch-image handler) - it always
  // attaches the API key, so pointing it at an arbitrary third-party URL
  // would leak the key to that host.
  fetchBinary(path) {
    return request(this.baseUrl, this.apiKey, path, 'GET', null, { binary: true });
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
    return collectAllPages(async (offset, limit) => {
      const result = await this.get(`/projects.json?limit=${limit}&offset=${offset}`);
      return { items: result.projects || [], total_count: result.total_count };
    });
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

  createIssue({ projectId, trackerId, subject, description, assigneeId, customFields }) {
    return this.post('/issues.json', {
      issue: {
        project_id: projectId,
        tracker_id: trackerId,
        subject,
        description: description || '',
        ...(assigneeId ? { assigned_to_id: assigneeId } : {}),
        ...(customFields && customFields.length ? { custom_fields: customFields } : {}),
      },
    });
  }

  // /custom_fields.json (the authoritative field-definition endpoint -
  // format, possible_values, is_required) is admin-only and 403s for a
  // regular API key (confirmed against a real instance). The only way to
  // know which custom fields a project+tracker pairing uses is to sample
  // an existing issue of that pairing and read its custom_fields array -
  // this loses format/required-ness info, so the create form can only
  // offer plain text inputs, not proper dropdowns/checkboxes. Returns []
  // if no existing issue of that pairing was found to sample.
  async listTrackerCustomFields(projectId, trackerId) {
    const result = await this.get(
      `/issues.json?project_id=${projectId}&tracker_id=${trackerId}&status_id=*&limit=1`,
    );
    const issue = (result.issues || [])[0];
    return (issue && issue.custom_fields) || [];
  }

  async listMyIssues() {
    return collectAllPages(async (offset, limit) => {
      const result = await this.get(
        `/issues.json?assigned_to_id=me&status_id=*&limit=${limit}&offset=${offset}&sort=updated_on:desc`,
      );
      return { items: result.issues || [], total_count: result.total_count };
    });
  }

  // Tickets you created but reassigned to someone else drop out of
  // listMyIssues() entirely (it's assignee-filtered) - this is the only
  // way to keep track of them.
  async listAuthoredIssues() {
    return collectAllPages(async (offset, limit) => {
      const result = await this.get(
        `/issues.json?author_id=me&status_id=*&limit=${limit}&offset=${offset}&sort=updated_on:desc`,
      );
      return { items: result.issues || [], total_count: result.total_count };
    });
  }

  async getIssueDetail(issueId) {
    const [issueResult, timeEntries] = await Promise.all([
      this.get(`/issues/${issueId}.json?include=journals,attachments,relations,allowed_statuses,children`),
      // Time tracking can be disabled on an instance (this 403s then) - fall
      // back to an empty log rather than failing the whole detail load.
      collectAllPages(async (offset, limit) => {
        const result = await this.get(
          `/time_entries.json?issue_id=${issueId}&limit=${limit}&offset=${offset}&sort=spent_on:desc`,
        );
        return { items: result.time_entries || [], total_count: result.total_count };
      }).catch(() => []),
    ]);
    return {
      issue: issueResult.issue,
      timeEntries,
    };
  }

  updateStatus(issueId, statusId) {
    return this.put(`/issues/${issueId}.json`, { issue: { status_id: statusId } });
  }

  async listProjectMembers(projectId) {
    const memberships = await collectAllPages(async (offset, limit) => {
      const result = await this.get(`/projects/${projectId}/memberships.json?limit=${limit}&offset=${offset}`);
      return { items: result.memberships || [], total_count: result.total_count };
    });
    // Memberships are per-role, so the same user can appear more than once
    // (one row per role they hold on the project) - dedupe by user id.
    // Group memberships have no `user` field at all - skip those, they
    // aren't valid issue assignees on their own.
    const byId = new Map();
    memberships.forEach((m) => {
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

// Resolves an embedded image URL (absolute or relative) against the
// configured Redmine base URL and returns the path to fetch *only if* it
// stays on that same origin - otherwise null. This is the guard that stops
// the X-Redmine-API-Key header being attached to a request bound for some
// other host: a ticket description can embed an <img> pointing anywhere
// (pasted from elsewhere), and fetchBinary always sends the key. Pure and
// exported so the leak-prevention rule is unit-testable rather than only
// living inside main.js's IPC handler.
function sameInstanceImagePath(rawUrl, baseUrl) {
  const resolved = new URL(rawUrl, baseUrl);
  const configuredOrigin = new URL(baseUrl).origin;
  if (resolved.origin !== configuredOrigin) return null;
  return resolved.pathname + resolved.search;
}

module.exports = { RedmineClient, buildColumnMapping, sameInstanceImagePath, collectAllPages, isRetriable, withRetry };
