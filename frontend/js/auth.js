const AUTH_CONFIG = {
  baseUrl: '/api/v1',
  accessTokenKey: 'access_token',
  refreshTokenKey: 'refresh_token',
  tokenExpiryKey: 'token_expiry',
};

const tokenStorage = {
  save(accessToken, refreshToken, expiresIn) {
    const expiry = Date.now() + expiresIn * 1000;
    localStorage.setItem(AUTH_CONFIG.accessTokenKey, accessToken);
    localStorage.setItem(AUTH_CONFIG.refreshTokenKey, refreshToken);
    localStorage.setItem(AUTH_CONFIG.tokenExpiryKey, String(expiry));
  },
  saveAccess(accessToken, expiresIn) {
    const expiry = Date.now() + expiresIn * 1000;
    localStorage.setItem(AUTH_CONFIG.accessTokenKey, accessToken);
    localStorage.setItem(AUTH_CONFIG.tokenExpiryKey, String(expiry));
  },
  getAccess() { return localStorage.getItem(AUTH_CONFIG.accessTokenKey); },
  getRefresh() { return localStorage.getItem(AUTH_CONFIG.refreshTokenKey); },
  isExpired() {
    const expiry = localStorage.getItem(AUTH_CONFIG.tokenExpiryKey);
    if (!expiry) return true;
    return Date.now() > parseInt(expiry) - 60_000;
  },
  clear() {
    localStorage.removeItem(AUTH_CONFIG.accessTokenKey);
    localStorage.removeItem(AUTH_CONFIG.refreshTokenKey);
    localStorage.removeItem(AUTH_CONFIG.tokenExpiryKey);
  },
};

async function apiRequest(path, options = {}) {
  const url = `${AUTH_CONFIG.baseUrl}${path}`;
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    let message;
    if (Array.isArray(data.detail)) {
      message = data.detail.map(e => e.msg?.replace('Value error, ', '') ?? String(e)).join(' | ');
    } else {
      message = data.detail || `HTTP ${response.status}`;
    }
    throw new AuthError(message, response.status);
  }
  return data;
}

export class AuthError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
  }
}

export const authModule = {
  async register(username, email, password, fullName = null) {
    return apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password, full_name: fullName }),
    });
  },

  async login(username, password) {
    const tokens = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    tokenStorage.save(tokens.access_token, tokens.refresh_token, tokens.expires_in);
    const user = await this.getMe();
    return { user, tokens };
  },

  async logout() {
    try {
      const token = await this.getValidToken();
      if (token) {
        await apiRequest('/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } finally {
      tokenStorage.clear();
    }
  },

  async getValidToken() {
    if (!tokenStorage.getAccess()) return null;
    if (tokenStorage.isExpired()) return this.refreshToken();
    return tokenStorage.getAccess();
  },

  async refreshToken() {
    const refreshToken = tokenStorage.getRefresh();
    if (!refreshToken) throw new AuthError('Không có refresh token', 401);
    const data = await apiRequest('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    tokenStorage.saveAccess(data.access_token, data.expires_in);
    return data.access_token;
  },

  async getMe() {
    const token = await this.getValidToken();
    if (!token) throw new AuthError('Chưa đăng nhập', 401);
    return apiRequest('/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  },

  isLoggedIn() { return !!tokenStorage.getAccess(); },

  async authFetch(path, options = {}) {
    const token = await this.getValidToken();
    if (!token) throw new AuthError('Chưa đăng nhập', 401);
    const response = await fetch(`${AUTH_CONFIG.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
    if (response.status === 401) {
      tokenStorage.clear();
      throw new AuthError('Phiên đăng nhập hết hạn', 401);
    }
    return response;
  },
};

export default authModule;
