/**
 * auth-ui.js — Reusable login/register modal UI component.
 * Depends only on auth.js (API calls). No coupling to any specific HTML page.
 *
 * Usage:
 *   import { showLoginModal, hideLoginModal, onLoginSuccess } from './auth-ui.js';
 *
 * After successful login, dispatches: document event 'auth:login' with { detail: { user } }
 */

import { authModule } from './auth.js';

const MODAL_ID = 'auth-login-modal';

export function showLoginModal() {
  if (document.getElementById(MODAL_ID)) return;
  _injectStyles();
  const overlay = document.createElement('div');
  overlay.id = MODAL_ID;
  overlay.className = 'alm-overlay';
  overlay.innerHTML = `
    <div class="alm-card" role="dialog" aria-modal="true" aria-label="Đăng nhập">
      <button class="alm-close" id="alm-close" aria-label="Đóng">&#x2715;</button>
      <div class="alm-brand">
        <span class="alm-logo">&#9889;</span>
        <h2>Chào mừng!</h2>
        <p>Đăng nhập để lưu lịch sử và tiến độ học của bạn</p>
      </div>
      <div id="alm-alert" class="alm-alert" style="display:none;"></div>
      <div class="alm-tabs">
        <button class="alm-tab active" data-tab="login">Đăng nhập</button>
        <button class="alm-tab" data-tab="register">Đăng ký</button>
      </div>
      <div id="alm-panel-login" class="alm-panel active">
        <form id="alm-form-login">
          <div class="alm-field">
            <label>Tên đăng nhập</label>
            <input id="alm-username" type="text" required placeholder="username" autocomplete="username" />
          </div>
          <div class="alm-field">
            <label>Mật khẩu</label>
            <input id="alm-password" type="password" required placeholder="••••••••" autocomplete="current-password" />
          </div>
          <button type="submit" class="alm-btn" id="alm-btn-login">Đăng nhập</button>
        </form>
      </div>
      <div id="alm-panel-register" class="alm-panel">
        <form id="alm-form-register">
          <div class="alm-field">
            <label>Tên đăng nhập</label>
            <input id="alm-reg-username" type="text" required placeholder="username (3-50 ký tự)" autocomplete="username" />
          </div>
          <div class="alm-field">
            <label>Email</label>
            <input id="alm-reg-email" type="email" required placeholder="email@example.com" autocomplete="email" />
          </div>
          <div class="alm-field">
            <label>Họ tên <span style="color:#9ca3af">(tùy chọn)</span></label>
            <input id="alm-reg-fullname" type="text" placeholder="Họ và tên" autocomplete="name" />
          </div>
          <div class="alm-field">
            <label>Mật khẩu</label>
            <input id="alm-reg-password" type="password" required placeholder="Tối thiểu 8 ký tự" autocomplete="new-password" />
          </div>
          <button type="submit" class="alm-btn" id="alm-btn-register">Đăng ký</button>
        </form>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  _bindEvents(overlay);
  overlay.querySelector('#alm-username')?.focus();
}

export function hideLoginModal() {
  document.getElementById(MODAL_ID)?.remove();
}

export function onLoginSuccess(user) {
  hideLoginModal();
  document.dispatchEvent(new CustomEvent('auth:login', { detail: { user } }));
}

// ── Private helpers ──────────────────────────────────────────────────────────

function _bindEvents(overlay) {
  overlay.querySelector('#alm-close').addEventListener('click', hideLoginModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) hideLoginModal(); });
  document.addEventListener('keydown', _escHandler);

  overlay.querySelectorAll('.alm-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      overlay.querySelectorAll('.alm-tab').forEach(t => t.classList.remove('active'));
      overlay.querySelectorAll('.alm-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      overlay.querySelector(`#alm-panel-${tab.dataset.tab}`).classList.add('active');
      _clearAlert();
    });
  });

  overlay.querySelector('#alm-form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = overlay.querySelector('#alm-btn-login');
    btn.disabled = true;
    btn.textContent = 'Đang đăng nhập...';
    _clearAlert();
    try {
      const { user } = await authModule.login(
        overlay.querySelector('#alm-username').value.trim(),
        overlay.querySelector('#alm-password').value,
      );
      document.removeEventListener('keydown', _escHandler);
      onLoginSuccess(user);
    } catch (err) {
      _showAlert(err.message || 'Đăng nhập thất bại');
      btn.disabled = false;
      btn.textContent = 'Đăng nhập';
    }
  });

  overlay.querySelector('#alm-form-register').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = overlay.querySelector('#alm-btn-register');
    btn.disabled = true;
    btn.textContent = 'Đang đăng ký...';
    _clearAlert();
    const username = overlay.querySelector('#alm-reg-username').value.trim();
    const password = overlay.querySelector('#alm-reg-password').value;
    try {
      await authModule.register(
        username,
        overlay.querySelector('#alm-reg-email').value.trim(),
        password,
        overlay.querySelector('#alm-reg-fullname').value.trim() || null,
      );
      _showAlert('Đăng ký thành công! Đang đăng nhập...', 'success');
      const { user } = await authModule.login(username, password);
      document.removeEventListener('keydown', _escHandler);
      onLoginSuccess(user);
    } catch (err) {
      _showAlert(err.message || 'Đăng ký thất bại');
      btn.disabled = false;
      btn.textContent = 'Đăng ký';
    }
  });
}

function _escHandler(e) {
  if (e.key === 'Escape') {
    document.removeEventListener('keydown', _escHandler);
    hideLoginModal();
  }
}

function _showAlert(msg, type = 'error') {
  const el = document.getElementById('alm-alert');
  if (!el) return;
  el.textContent = msg;
  el.className = `alm-alert ${type}`;
  el.style.display = 'block';
}

function _clearAlert() {
  const el = document.getElementById('alm-alert');
  if (el) el.style.display = 'none';
}

let _stylesInjected = false;
function _injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
.alm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;animation:alm-fade .15s ease}
@keyframes alm-fade{from{opacity:0}to{opacity:1}}
.alm-card{background:#fff;border-radius:16px;padding:2rem;width:100%;max-width:400px;position:relative;box-shadow:0 20px 60px rgba(0,0,0,.2);animation:alm-up .2s ease}
@keyframes alm-up{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
.alm-close{position:absolute;top:12px;right:16px;background:none;border:none;font-size:1.4rem;cursor:pointer;color:#9ca3af;line-height:1;padding:4px}
.alm-close:hover{color:#374151}
.alm-brand{text-align:center;margin-bottom:1.4rem}
.alm-logo{font-size:2rem}
.alm-brand h2{font-size:1.25rem;margin:.3rem 0 0;color:#1a1a2e;font-weight:700}
.alm-brand p{font-size:.83rem;color:#6b7280;margin:.3rem 0 0}
.alm-tabs{display:flex;border-bottom:2px solid #e5e7eb;margin-bottom:1.2rem}
.alm-tab{flex:1;padding:.5rem;background:none;border:none;cursor:pointer;font-size:.9rem;color:#6b7280;font-family:inherit}
.alm-tab.active{color:#4f46e5;border-bottom:2px solid #4f46e5;margin-bottom:-2px;font-weight:600}
.alm-panel{display:none}
.alm-panel.active{display:block}
.alm-field{margin-bottom:.9rem}
.alm-field label{display:block;font-size:.82rem;font-weight:500;color:#374151;margin-bottom:.3rem}
.alm-field input{width:100%;padding:.6rem .8rem;border:1.5px solid #d1d5db;border-radius:8px;font-size:.9rem;outline:none;font-family:inherit;box-sizing:border-box}
.alm-field input:focus{border-color:#4f46e5}
.alm-btn{width:100%;padding:.7rem;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-size:.95rem;font-weight:600;cursor:pointer;margin-top:.3rem;transition:background .2s;font-family:inherit}
.alm-btn:hover:not(:disabled){background:#4338ca}
.alm-btn:disabled{opacity:.6;cursor:not-allowed}
.alm-alert{padding:.6rem .9rem;border-radius:6px;font-size:.83rem;margin-bottom:.9rem}
.alm-alert.error{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca}
.alm-alert.success{background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0}
  `;
  document.head.appendChild(style);
}
