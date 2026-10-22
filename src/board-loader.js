(function (global) {
  'use strict';

  const columns = ['backlog', 'todo', 'in-progress', 'done'];

  function buildBoardState(issues, previous, classify) {
    const apiState = Object.fromEntries(columns.map(column => [column, []]));
    const nextIssueColumns = {};
    const unfinished = [];
    for (const issue of issues) {
      const column = classify(issue.status);
      const subject = issue.subject || `Issue #${issue.id}`;
      apiState[column].push({ id: `api-${issue.id}`, content: subject, issueId: issue.id });
      nextIssueColumns[issue.id] = { column, subject };
      if (column !== 'done') unfinished.push(issue);
    }
    const mergedState = Object.fromEntries(columns.map(column => [column, [
      ...apiState[column], ...(previous[column] || []).filter(task => !task.issueId),
    ]]));
    return { apiState, nextIssueColumns, unfinished, mergedState };
  }

  function createBoardLoader({ getContext, fetchIssues, fetchAuthoredIssues, onResult, onError }) {
    let generation = 0;
    return {
      invalidate() { generation += 1; },
      async load(options = {}) {
        const request = ++generation;
        const context = { ...getContext() };
        const isCurrent = () => {
          const active = getContext();
          return request === generation && context.mode === active.mode && context.connection === active.connection;
        };
        try {
          const response = await (context.mode === 'authored' ? fetchAuthoredIssues() : fetchIssues());
          if (!isCurrent()) return { stale: true };
          await onResult(response, context, options);
          return { ok: true };
        } catch (error) {
          if (!isCurrent()) return { stale: true };
          onError(error);
          return { error: error.message };
        }
      },
    };
  }

  const api = { createBoardLoader, buildBoardState };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.reddieBoardLoader = api;
})(typeof self !== 'undefined' ? self : this);
