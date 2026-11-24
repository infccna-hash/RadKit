export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request(method, url, body, opts = {}) {
  const headers = { 'X-RadKit': '1', ...(opts.headers || {}) };
  let payload = body;
  if (body !== undefined && !(body instanceof ArrayBuffer) && !(body instanceof Blob)) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch('/api' + url, {
    method,
    headers,
    body: payload,
    credentials: 'same-origin',
    signal: opts.signal,
  });
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth/') && !url.startsWith('/public/')) {
      window.dispatchEvent(new Event('rk:unauthorized'));
    }
    throw new ApiError(res.status, data?.error || `Erreur ${res.status}`, data);
  }
  return data;
}

export const api = {
  get: (u, o) => request('GET', u, undefined, o),
  post: (u, b, o) => request('POST', u, b ?? {}, o),
  put: (u, b, o) => request('PUT', u, b, o),
  patch: (u, b, o) => request('PATCH', u, b, o),
  del: (u, o) => request('DELETE', u, undefined, o),
  raw: (u, buf, o) =>
    request('POST', u, buf, { ...o, headers: { 'Content-Type': 'application/dicom', ...(o?.headers || {}) } }),
};
