// Calls the CMS API through the dev-server proxy (same origin, so the httpOnly session cookie is sent).
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details || {};
  }
}

async function request(method, url, body) {
  const isForm = body instanceof FormData;
  let res;
  try {
    res = await fetch(`/api${url}`, {
      method,
      headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the API. Is it running on port 4000?');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // session ended (signed out elsewhere, expired, disabled) or a new password is required
    if (res.status === 401 && !url.startsWith('/admin/auth/')) window.dispatchEvent(new Event('auth:expired'));
    if (res.status === 403 && data.details?.code === 'password_change_required') window.dispatchEvent(new Event('auth:password-change'));
    throw new ApiError(res.status, data.error || `Request failed (${res.status})`, data.details);
  }
  return data;
}

export const qs = (params = {}) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null && v !== false)).toString();
  return s ? `?${s}` : '';
};

export const api = {
  get: (url, params) => request('GET', `${url}${qs(params)}`),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  patch: (url, body) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),
  upload: (url, field, files) => {
    const fd = new FormData();
    for (const f of [].concat(files)) fd.append(field, f);
    return request('POST', url, fd);
  },
};
