import { authModule, AuthError } from './auth.js';

export async function requireAuth() {
  if (!authModule.isLoggedIn()) {
    window.location.href = '/index.html';
    return null;
  }
  try {
    return await authModule.getMe();
  } catch {
    window.location.href = '/index.html';
    return null;
  }
}

export function renderNavbar(user) {
  const nav = document.getElementById('navbar');
  if (!nav) return;
  nav.innerHTML = `
    <div class="nav-brand">
      <span class="nav-logo">⚡</span> MyApp
    </div>
    <div class="nav-links">
      <a href="/dashboard.html" class="${location.pathname.includes('dashboard') ? 'active' : ''}">Dashboard</a>
      <a href="/jlpt.html" class="${location.pathname.includes('jlpt') ? 'active' : ''}">🎌 JLPT</a>
      <a href="/payment.html" class="${location.pathname.includes('payment') ? 'active' : ''}">💳 Payment</a>
    </div>
    <div class="nav-user">
      <span class="nav-username">👤 ${user.username}</span>
      <button class="btn-logout" id="logout-btn">Đăng xuất</button>
    </div>
  `;
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await authModule.logout();
    window.location.href = '/index.html';
  });
}

export { authModule, AuthError };
