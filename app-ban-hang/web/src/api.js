// Gọi máy chủ. Đường dẫn tương đối để chạy được qua Home Assistant.
const TOKEN_KEY = 'banhang_token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* trình duyệt chặn lưu trữ */
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export async function api(method, url, body) {
  const token = getToken();
  let res;
  try {
    res = await fetch('api' + url, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Không kết nối được máy chủ. Kiểm tra wifi hoặc máy Home Assistant.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) onUnauthorized();
  if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
  return data;
}

export const get = (url) => api('GET', url);
export const post = (url, body = {}) => api('POST', url, body);
export const put = (url, body = {}) => api('PUT', url, body);
export const del = (url) => api('DELETE', url);

export const imageUrl = (name) => (name ? `images/${name}` : null);
export const downloadUrl = (url) => `api${url}${url.includes('?') ? '&' : '?'}token=${getToken()}`;
