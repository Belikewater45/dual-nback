/* Cross-device sync through one secret GitHub Gist.
 * Each device keeps its full history locally (works offline); when online,
 * it pulls the gist, merges (union of sessions by id, newest settings win),
 * saves locally, and pushes the merged copy back. Merging is order-free,
 * so two devices that trained offline always converge. */
(function (root) {
  'use strict';
  const API = 'https://api.github.com';
  const FILE = 'dual-nback-sync.json';
  const DESC = 'Dual N-Back sync data (used by the Dual N-Back app)';

  function headers(token) {
    return {
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }

  async function gh(token, path, opts) {
    const res = await fetch(API + path, Object.assign({ headers: headers(token), cache: 'no-store' }, opts || {}));
    if (res.status === 401) throw new Error('GitHub rejected the token (401). Check it was copied fully and has the "gist" permission.');
    if (res.status === 403 || res.status === 404) {
      const txt = await res.text().catch(() => '');
      throw new Error('GitHub refused the request (' + res.status + '). The token may lack the "gist" permission. ' + txt.slice(0, 120));
    }
    if (!res.ok) throw new Error('GitHub error ' + res.status);
    return res.json();
  }

  async function findGist(token) {
    for (let page = 1; page <= 10; page++) {
      const list = await gh(token, '/gists?per_page=100&page=' + page);
      for (const g of list) if (g.files && g.files[FILE]) return g.id;
      if (list.length < 100) break;
    }
    return null;
  }

  async function readGist(token, id) {
    const g = await gh(token, '/gists/' + id);
    const f = g.files && g.files[FILE];
    if (!f) return null;
    let content = f.content;
    if (f.truncated && f.raw_url) {
      const r = await fetch(f.raw_url, { cache: 'no-store' });
      content = await r.text();
    }
    try { return JSON.parse(content); } catch (e) { return null; }
  }

  async function createGist(token, data) {
    const body = { description: DESC, public: false, files: {} };
    body.files[FILE] = { content: JSON.stringify(data) };
    const g = await gh(token, '/gists', { method: 'POST', body: JSON.stringify(body) });
    return g.id;
  }

  async function writeGist(token, id, data) {
    const body = { files: {} };
    body.files[FILE] = { content: JSON.stringify(data) };
    await gh(token, '/gists/' + id, { method: 'PATCH', body: JSON.stringify(body) });
  }

  function merge(a, b) {
    a = a || {}; b = b || {};
    const byId = new Map();
    for (const s of (a.sessions || [])) byId.set(s.id, s);
    for (const s of (b.sessions || [])) if (!byId.has(s.id)) byId.set(s.id, s);
    const ev = new Map();
    for (const e of (a.events || [])) ev.set(e.id, e);
    for (const e of (b.events || [])) if (!ev.has(e.id)) ev.set(e.id, e);
    const sa = a.settings || {}, sb = b.settings || {};
    const settings = (sb.updatedAt || 0) > (sa.updatedAt || 0) ? sb : sa;
    return {
      v: 1,
      sessions: Array.from(byId.values()).sort((x, y) => x.t - y.t),
      events: Array.from(ev.values()).sort((x, y) => x.t - y.t),
      settings
    };
  }

  function sameData(a, b) {
    if (!a || !b) return false;
    return (a.sessions || []).length === (b.sessions || []).length &&
      (a.events || []).length === (b.events || []).length &&
      ((a.settings || {}).updatedAt || 0) === ((b.settings || {}).updatedAt || 0);
  }

  /* Full sync. cfg: {token, gistId}. Returns {data, gistId}. */
  async function sync(cfg, local) {
    let id = cfg.gistId;
    let remote = null;
    if (id) {
      try { remote = await readGist(cfg.token, id); }
      catch (e) { if (/404/.test(e.message)) id = null; else throw e; }
    }
    if (!id) {
      id = await findGist(cfg.token);
      if (id) remote = await readGist(cfg.token, id);
    }
    const merged = merge(local, remote);
    if (!id) id = await createGist(cfg.token, merged);
    else if (!sameData(merged, remote)) await writeGist(cfg.token, id, merged);
    return { data: merged, gistId: id };
  }

  const api = { sync, merge, FILE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DNBSync = api;
})(this);
