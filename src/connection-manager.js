function normalizeConfig(config) {
  const redmineBaseUrl = String(config.redmineBaseUrl || '').trim().replace(/\/+$/, '');
  const redmineApiKey = String(config.redmineApiKey || '').trim();
  if (!redmineBaseUrl) throw new Error('No Redmine URL configured');
  const url = new URL(redmineBaseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTP or HTTPS Redmine URL without credentials, query, or fragment');
  }
  if (!redmineApiKey) throw new Error('No API key configured');
  return { ...config, redmineBaseUrl: url.href.replace(/\/+$/, ''), redmineApiKey };
}

function connectionScope(baseUrl, userId) {
  return `${baseUrl.replace(/\/+$/, '')}|${userId}`;
}

// A candidate never becomes active (or reaches disk) until the full probe and
// switching guard pass. Existing requests keep their original client object.
function createConnectionManager({ initialConfig, createClient, persist, beforeCommit = () => {}, onCommit = () => {} }) {
  let state = { config: initialConfig, client: createClient(initialConfig), scope: '', metadata: null };
  let saving = false;
  let revision = 0;
  async function probe(config) {
    const normalized = normalizeConfig(config);
    const client = createClient(normalized);
    const [user, statuses, activities, priorities] = await Promise.all([
      client.getCurrentUser(), client.listStatuses(), client.listActivities(), client.listPriorities(),
    ]);
    if (!user || !user.id) throw new Error('Redmine did not return a current user');
    if (![statuses, activities, priorities].every(Array.isArray)) throw new Error('Redmine returned invalid connection metadata');
    return { config: normalized, client, scope: connectionScope(normalized.redmineBaseUrl, user.id), metadata: { user, statuses, activities, priorities } };
  }
  return {
    getState: () => state,
    async check() {
      const original = state;
      const checkedRevision = revision;
      const candidate = await probe(original.config);
      if (revision !== checkedRevision || saving) return { error: 'Connection changed while checking' };
      state = candidate;
      onCommit(state, original);
      return { ok: true, user: candidate.metadata.user };
    },
    async save(patch) {
      if (saving) throw new Error('Connection settings are already being checked');
      saving = true;
      const original = state;
      try {
        const candidate = await probe({ ...state.config, ...patch });
        beforeCommit(candidate, original);
        persist(candidate.config);
        revision += 1;
        state = candidate;
        onCommit(state, original);
        return { ok: true, user: candidate.metadata.user, scopeChanged: candidate.scope !== original.scope };
      } finally {
        saving = false;
      }
    },
    updatePreferences(patch) {
      if (saving) throw new Error('Wait for connection settings to finish saving');
      const config = { ...state.config, ...patch };
      persist(config);
      const previous = state;
      revision += 1;
      state = { ...state, config };
      onCommit(state, previous);
    },
  };
}

module.exports = { createConnectionManager, normalizeConfig, connectionScope };
