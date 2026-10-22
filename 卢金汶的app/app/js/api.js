// 与本地服务通信的唯一出口。
export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function jsonFetch(url, options = {}) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (e) {
    throw new ApiError('无法连接本地服务', 0, null);
  }
  const text = await res.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!res.ok) {
    const msg = (body && body.error) ? body.error : ('请求失败（' + res.status + '）');
    throw new ApiError(msg, res.status, body);
  }
  return body;
}

export const api = {
  ping() {
    return jsonFetch('/api/ping');
  },

  info() {
    return jsonFetch('/api/info');
  },

  getState() {
    return jsonFetch('/api/state');
  },

  putState(data, rev) {
    return jsonFetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Rev': String(rev) },
      body: JSON.stringify(data, null, 2)
    });
  },

  backup() {
    return jsonFetch('/api/backup', { method: 'POST' });
  },

  exportJsonUrl() {
    return '/api/export.json';
  },

  exportCsvUrl(params) {
    const qs = new URLSearchParams(params || {});
    return '/api/export.csv?' + qs.toString();
  }
};
