(function (global) {
  'use strict';

  function createIssueDetailLoader({ api, onStart, onLoad, onError }) {
    let generation = 0;
    let issueId = null;
    const capture = () => ({ issueId, generation });
    const isCurrent = (request) => request.generation === generation && request.issueId === issueId;
    return {
      capture,
      isCurrent,
      invalidate() { generation += 1; issueId = null; },
      async load(id) {
        issueId = id;
        generation += 1;
        const request = capture();
        onStart(id);
        try {
          const result = await api.fetchIssueDetail(id);
          if (!isCurrent(request)) return { stale: true };
          if (!result || result.error || !result.issue) throw new Error(result?.error || 'Failed to load issue.');
          const projectId = result.issue.project?.id;
          const metadata = projectId
            ? await Promise.all([
                api.fetchProjectMembers(projectId), api.fetchProjectTrackers(projectId),
                api.fetchProjectCategories(projectId), api.fetchProjectVersions(projectId),
              ])
            : [];
          if (!isCurrent(request)) return { stale: true };
          const [members = {}, trackers = {}, categories = {}, versions = {}] = metadata;
          onLoad({ ...result, members: members?.items || [], trackers: trackers?.items || [], categories: categories?.items || [], versions: versions?.items || [] });
          return { ok: true };
        } catch (error) {
          if (!isCurrent(request)) return { stale: true };
          onError(error);
          return { error: error.message };
        }
      },
    };
  }

  const api = { createIssueDetailLoader };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.reddieIssueLoader = api;
})(typeof self !== 'undefined' ? self : this);
