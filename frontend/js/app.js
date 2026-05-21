import { authModule, AuthError } from './auth.js';
import { showLoginModal, hideLoginModal, onLoginSuccess } from './auth-ui.js';

export { authModule, AuthError, showLoginModal, hideLoginModal, onLoginSuccess };

// ── Auth guards ───────────────────────────────────────────────────────────────

export async function requireAuth() {
  // Returns the current user, or null for guests — does NOT redirect.
  if (!authModule.isLoggedIn()) return null;
  try { return await authModule.getMe(); } catch { return null; }
}

export async function requireAuthStrict() {
  // Redirects to login page if not authenticated (use for payment.html, etc.)
  const user = await requireAuth();
  if (!user) {
    window.location.href = '/index.html?next=' + encodeURIComponent(location.pathname);
    return null;
  }
  return user;
}

// ── Navbar (used by dashboard.html, payment.html) ────────────────────────────

export function renderNavbar(user) {
  const nav = document.getElementById('navbar');
  if (!nav) return;
  nav.innerHTML = `
    <div class="nav-brand">
      <span class="nav-logo">&#9889;</span> MyApp
    </div>
    <div class="nav-links">
      <a href="/jlpt.html" class="${location.pathname.includes('jlpt') ? 'active' : ''}">&#x1F3CC; JLPT</a>
      <a href="/dashboard.html" class="${location.pathname.includes('dashboard') ? 'active' : ''}">Dashboard</a>
      <a href="/payment.html" class="${location.pathname.includes('payment') ? 'active' : ''}">&#x1F4B3; Payment</a>
    </div>
    <div class="nav-user">
      <span class="nav-username">&#x1F464; ${user.username}</span>
      <button class="btn-logout" id="logout-btn">Đăng xuất</button>
    </div>
  `;
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await authModule.logout();
    window.location.href = '/jlpt.html';
  });
}

// ── Floating user icon (used by jlpt.html and any page without navbar) ───────

let _currentUser = null;
export function getCurrentUser() { return _currentUser; }

export function renderUserIcon(user) {
  _currentUser = user;
  const existing = document.getElementById('uib-btn');
  if (existing) existing.remove();
  document.getElementById('uib-dropdown')?.remove();

  const btn = document.createElement('button');
  btn.id = 'uib-btn';
  btn.className = 'uib-btn';
  btn.setAttribute('aria-label', user ? `Đang đăng nhập: ${user.username}` : 'Đăng nhập');

  if (user) {
    btn.innerHTML = `<span class="uib-avatar">${user.username[0].toUpperCase()}</span>`;
    btn.addEventListener('click', (e) => { e.stopPropagation(); _showDropdown(user); });
  } else {
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
    btn.addEventListener('click', (e) => { e.stopPropagation(); showLoginModal(); });
  }

  document.body.appendChild(btn);
  _injectUserIconStyles();
}

function _showDropdown(user) {
  document.getElementById('uib-dropdown')?.remove();
  const dd = document.createElement('div');
  dd.id = 'uib-dropdown';
  dd.className = 'uib-dropdown';
  dd.innerHTML = `
    <div class="uib-dd-header">
      <strong>${user.username}</strong>
      <span>${user.email || ''}</span>
    </div>
    <a href="/jlpt.html" class="uib-dd-item">&#x1F3CC; Học JLPT</a>
    <a href="/dashboard.html" class="uib-dd-item">&#x1F4CA; Dashboard</a>
    ${user.is_superuser ? '<a href="/jlpt.html" class="uib-dd-item" id="uib-admin-link">&#x2699;&#xFE0F; Quản lý</a>' : ''}
    <button class="uib-dd-item uib-dd-logout" id="uib-logout">&#x1F6AA; Đăng xuất</button>
  `;
  document.body.appendChild(dd);

  document.getElementById('uib-logout').addEventListener('click', async () => {
    await authModule.logout();
    window.location.reload();
  });

  if (user.is_superuser) {
    document.getElementById('uib-admin-link')?.addEventListener('click', (e) => {
      e.preventDefault();
      dd.remove();
      document.dispatchEvent(new CustomEvent('uib:go-admin'));
    });
  }

  setTimeout(() => {
    document.addEventListener('click', () => dd.remove(), { once: true });
  }, 0);
}

let _uibStylesInjected = false;
function _injectUserIconStyles() {
  if (_uibStylesInjected) return;
  _uibStylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
.uib-btn{position:fixed;top:14px;right:18px;z-index:800;width:40px;height:40px;border-radius:50%;border:2px solid #d1d5db;background:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.12);transition:border-color .2s,box-shadow .2s;padding:0;color:#6b7280}
.uib-btn:hover{border-color:#4f46e5;box-shadow:0 4px 16px rgba(79,70,229,.25);color:#4f46e5}
.uib-avatar{width:36px;height:36px;border-radius:50%;background:#4f46e5;color:#fff;font-weight:700;font-size:.9rem;display:flex;align-items:center;justify-content:center}
.uib-dropdown{position:fixed;top:62px;right:18px;z-index:801;background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.12);min-width:210px;overflow:hidden}
.uib-dd-header{padding:12px 16px;background:#f9fafb;border-bottom:1px solid #e5e7eb}
.uib-dd-header strong{display:block;font-size:.9rem;color:#111827}
.uib-dd-header span{font-size:.78rem;color:#6b7280}
.uib-dd-item{display:block;width:100%;padding:10px 16px;text-align:left;background:none;border:none;border-bottom:1px solid #f3f4f6;cursor:pointer;font-size:.875rem;color:#374151;text-decoration:none;font-family:inherit;transition:background .15s}
.uib-dd-item:hover{background:#f3f4f6}
.uib-dd-logout{color:#dc2626!important}
.uib-dd-logout:hover{background:#fee2e2!important}
  `;
  document.head.appendChild(style);
}
