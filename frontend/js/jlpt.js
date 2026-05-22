import { requireAuth, renderUserIcon } from './app.js';
import { showLoginModal } from './auth-ui.js';

// Expose for inline onclick handlers in HTML
window.showLoginModal = showLoginModal;

const API = '/api/v1/jlpt';

// ── Auth helper ────────────────────────────────────────
function getToken() { return localStorage.getItem('access_token'); }

// ── State ──────────────────────────────────────────────
const state = {
  currentPage: 'home',
  quizMode: 'practice',
  quiz: {
    sessionId: null,
    questions: [],
    currentIndex: 0,
    answers: {},
    timer: null,
    timeLeft: 0,
    totalTime: 0,
    timers: {},
    questionStartTime: null,
    audioLoading: {},
    audioLoaded: {},
    passageVisible: {},
    paused: false,
  },
  exam: { level: 'N1', sets: [] },
  stats: null,
};

// Guest state — client-side quiz tracking for unauthenticated users
const guestState = {
  active: false,
  guestToken: null,
  correctMap: {},  // {question_id: shuffled_correct_label}
};

// ── Custom Confirm Modal ───────────────────────────────
function showConfirm(message, confirmText = 'Tiếp tục', cancelText = 'Hủy') {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:2000;';
    overlay.innerHTML = `
      <div style="background:white;border-radius:16px;padding:28px 24px;max-width:380px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.18);animation:almUp .2s ease;">
        <p style="margin:0 0 24px;font-size:0.95rem;line-height:1.6;color:var(--text);">${message}</p>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button id="sc-cancel" class="btn btn-outline">${cancelText}</button>
          <button id="sc-ok" class="btn btn-primary">${confirmText}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#sc-ok').onclick = () => { overlay.remove(); resolve(true); };
    overlay.querySelector('#sc-cancel').onclick = () => { overlay.remove(); resolve(false); };
  });
}

// ── Navigation ─────────────────────────────────────────
function showPage(name) {
  // Auto-pause timer when navigating away from an active quiz
  if (state.currentPage === 'quiz' && name !== 'quiz' && state.quiz.questions.length > 0 && !state.quiz.paused) {
    clearInterval(state.quiz.timer);
    state.quiz.paused = true;
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`page-${name}`)?.classList.add('active');
  document.querySelector(`.nav-tab[data-page="${name}"]`)?.classList.add('active');
  state.currentPage = name;
  if (name === 'home') _updateHomeButtons();
  if (name === 'exam') loadExamPage();
  if (name === 'history' && getToken()) loadHistory();
  if (name === 'admin' && getToken()) { loadStats(); loadUsers(); loadAdminExamSets(); }
}

function _updateHomeButtons() {
  const btnResume = document.getElementById('btn-resume');
  if (btnResume) btnResume.style.display = (state.quiz.paused && state.quiz.questions.length > 0) ? '' : 'none';
}

window.pauseQuiz = function() {
  clearInterval(state.quiz.timer);
  state.quiz.paused = true;
  showPage('home');
};

window.resumeQuiz = function() {
  state.quiz.paused = false;
  showPage('quiz');
  renderQuestion();
  startTimer();
};

window.showPage = showPage;

// ── Auth-aware UI toggle ───────────────────────────────
function _applyAuthState(user) {
  const isGuest = !user;
  const isAdmin = user?.is_superuser;
  const hasExamAccess = user?.has_jlpt_exam_access || isAdmin;

  // Guest banner on home page
  const banner = document.getElementById('guest-banner');
  if (banner) banner.style.display = isGuest ? '' : 'none';

  // History tab
  const histLogin = document.getElementById('history-login-required');
  const histContent = document.getElementById('history-content');
  if (histLogin) histLogin.style.display = isGuest ? '' : 'none';
  if (histContent) histContent.style.display = isGuest ? 'none' : '';

  // Admin tab — only superusers see it
  const adminTab = document.querySelector('.nav-tab[data-page="admin"]');
  if (adminTab) adminTab.style.display = isAdmin ? '' : 'none';
  const adminLogin = document.getElementById('admin-login-required');
  const adminContent = document.getElementById('admin-content');
  if (adminLogin) adminLogin.style.display = isAdmin ? 'none' : '';
  if (adminContent) adminContent.style.display = isAdmin ? '' : 'none';
}

// ── Toast ──────────────────────────────────────────────
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type} show`;
  setTimeout(() => el.classList.remove('show'), 3000);
}

// ── API helpers ────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const token = getToken();
  try {
    const res = await fetch(API + path, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      ...options,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || res.statusText);
    }
    return res.json();
  } catch (e) {
    toast(e.message, 'error');
    throw e;
  }
}

// ── Stats ──────────────────────────────────────────────
async function loadStats() {
  try {
    const data = await apiFetch('/questions/stats/summary');
    state.stats = data;
    renderStats(data);
  } catch {}
}
window.loadStats = loadStats;

function renderStats(data) {
  const el = document.getElementById('stats-grid');
  if (!el) return;
  const levels = ['N5','N4','N3','N2','N1'];
  const types = ['vocabulary','grammar','reading','listening'];
  const typeLabels = { vocabulary: 'Từ vựng', grammar: 'Ngữ pháp', reading: 'Đọc hiểu', listening: 'Nghe hiểu' };
  const typeColors = { vocabulary: '#4f8ef7', grammar: '#f7914f', reading: '#4fc78e', listening: '#c44ff7' };
  const blt = data.by_level_type || {};

  const levelCards = levels.map(l => {
    const total = data.by_level[l] || 0;
    const breakdown = types.map(t => {
      const cnt = (blt[l] && blt[l][t]) || 0;
      return `
        <div class="stat-type-row">
          <span class="stat-type-dot" style="background:${typeColors[t]}"></span>
          <span class="stat-type-label">${typeLabels[t]}</span>
          <span class="stat-type-count">${cnt}</span>
        </div>`;
    }).join('');
    return `
      <div class="stat-level-card" onclick="toggleLevelDetail(this)">
        <div class="stat-level-header">
          <span class="badge badge-${l}">${l}</span>
          <span class="stat-level-total">${total} câu</span>
          <span class="stat-expand-icon">▼</span>
        </div>
        <div class="stat-level-detail" style="display:none;">${breakdown}</div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:6px;">Tổng: <strong style="color:var(--text)">${data.total} câu hỏi</strong></div>
    <div class="stat-levels-list">${levelCards}</div>
  `;
}

window.toggleLevelDetail = function(card) {
  const detail = card.querySelector('.stat-level-detail');
  const icon = card.querySelector('.stat-expand-icon');
  const open = detail.style.display === 'none';
  detail.style.display = open ? 'block' : 'none';
  icon.textContent = open ? '▲' : '▼';
  card.classList.toggle('expanded', open);
};

// ── Quiz Mode Toggle ───────────────────────────────────
window.setQuizMode = function(mode) {
  state.quizMode = mode;
  const isPractice = mode === 'practice';
  document.getElementById('practice-options').style.display = isPractice ? '' : 'none';
  document.getElementById('full-exam-options').style.display = isPractice ? 'none' : '';
  document.getElementById('btn-mode-practice').className = `btn btn-sm ${isPractice ? 'btn-primary' : 'btn-outline'}`;
  document.getElementById('btn-mode-full').className = `btn btn-sm ${isPractice ? 'btn-outline' : 'btn-primary'}`;
};

// ── Start Quiz ─────────────────────────────────────────
window.startQuiz = async function() {
  if (state.quiz.paused && state.quiz.questions.length > 0) {
    const ok = await showConfirm('Bạn đang có bài làm chưa hoàn thành.<br>Bắt đầu bài mới sẽ hủy tiến độ hiện tại.', 'Bắt đầu mới', 'Tiếp tục làm');
    if (!ok) return;
    clearInterval(state.quiz.timer);
    state.quiz.paused = false;
    state.quiz.questions = [];
    _updateHomeButtons();
  }
  const isFullExam = state.quizMode === 'full';
  let payload;

  if (isFullExam) {
    const level = document.getElementById('sel-level-full').value;
    if (!level) { toast('Vui lòng chọn cấp độ!', 'error'); return; }
    payload = { level, full_exam: true };
  } else {
    const level = document.getElementById('sel-level').value;
    const qtype = document.getElementById('sel-type').value;
    if (!level) { toast('Vui lòng chọn cấp độ!', 'error'); return; }
    payload = { level, question_type: qtype || null };
  }

  const btn = document.getElementById('btn-start');
  btn.disabled = true;
  btn.textContent = 'Đang chuẩn bị...';

  const isLoggedIn = !!getToken();
  const endpoint = isLoggedIn ? '/quiz/start' : '/quiz/guest-start';

  try {
    const data = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(payload) });
    const totalMins = data.total_minutes || data.questions.length;

    if (isLoggedIn) {
      guestState.active = false;
      guestState.correctMap = {};
      state.quiz.sessionId = data.session_id;
    } else {
      guestState.active = true;
      guestState.guestToken = data.guest_token;
      guestState.correctMap = data.correct_map;
      state.quiz.sessionId = null;
    }

    state.quiz.questions = data.questions;
    state.quiz.currentIndex = 0;
    state.quiz.answers = {};
    state.quiz.timers = {};
    state.quiz.audioLoading = {};
    state.quiz.audioLoaded = {};
    state.quiz.passageVisible = {};
    state.quiz.totalTime = totalMins * 60;
    state.quiz.timeLeft = state.quiz.totalTime;

    showPage('quiz');
    renderQuestion();
    startTimer();
    toast(isLoggedIn ? 'Bắt đầu làm bài!' : 'Chế độ khách — kết quả sẽ không được lưu', isLoggedIn ? 'success' : '');
  } catch {
  } finally {
    btn.disabled = false;
    btn.textContent = '▶ Bắt đầu làm bài';
  }
};

// ── Timer ──────────────────────────────────────────────
function startTimer() {
  clearInterval(state.quiz.timer);
  state.quiz.questionStartTime = Date.now();
  state.quiz.timer = setInterval(() => {
    state.quiz.timeLeft--;
    updateTimerDisplay();
    if (state.quiz.timeLeft <= 0) {
      clearInterval(state.quiz.timer);
      handleTimeUp();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const el = document.getElementById('quiz-timer');
  if (!el) return;
  const t = state.quiz.timeLeft;
  const m = Math.floor(t / 60);
  const s = t % 60;
  el.textContent = `${m}:${String(s).padStart(2,'0')}`;
  el.className = 'timer' + (t < 60 ? ' danger' : t < 120 ? ' warning' : '');
}

function handleTimeUp() {
  toast('Hết giờ!', 'error');
  submitQuiz(true);
}

function getQuestionElapsedTime() {
  return (Date.now() - (state.quiz.questionStartTime || Date.now())) / 1000;
}

// ── Render Question ────────────────────────────────────
function renderQuestion() {
  const q = state.quiz.questions[state.quiz.currentIndex];
  if (!q) return;
  state.quiz.questionStartTime = Date.now();

  const total = state.quiz.questions.length;
  const idx = state.quiz.currentIndex;
  const answered = state.quiz.answers[q.id];

  document.getElementById('quiz-progress-text').textContent = `Câu ${idx + 1} / ${total}`;
  document.getElementById('quiz-progress-bar').style.width = `${((idx + 1) / total) * 100}%`;
  document.getElementById('quiz-level-badge').innerHTML =
    `<span class="badge badge-${q.level}">${q.level}</span> <span class="badge badge-${q.question_type}">${typeLabel(q.question_type)}</span>`;

  const mediaEl = document.getElementById('quiz-listening-media');
  const passageEl = document.getElementById('quiz-passage');

  if (q.question_type === 'listening') {
    const imgHtml = q.image_url ? `<img src="${escHtml(q.image_url)}" alt="Hình minh họa" class="listening-image">` : '';
    const audioUrl = state.quiz.audioLoaded[q.id] || q.audio_url || '';
    const isLoading = !!state.quiz.audioLoading[q.id];
    const passageShown = !!state.quiz.passageVisible[q.id];
    let controlHtml = '';
    if (isLoading) {
      controlHtml = `<div class="audio-loading">⏳ Đang tạo audio...</div>`;
    } else if (audioUrl) {
      controlHtml = `
        <audio controls autoplay class="audio-player" src="${escHtml(audioUrl)}"></audio>
        <button class="btn-listen btn-listen-toggle" onclick="togglePassage(${q.id})">
          ${passageShown ? '📝 Ẩn nội dung' : '📝 Xem nội dung hội thoại'}
        </button>`;
    } else {
      controlHtml = `<button class="btn-listen" onclick="requestAudio(${q.id})">🎧 Nghe và xem nội dung</button>`;
    }
    mediaEl.innerHTML = imgHtml + controlHtml;
    mediaEl.style.display = 'block';
    if (q.passage && passageShown) {
      passageEl.innerHTML = `<div class="listening-label">📝 Nội dung hội thoại</div>${escHtml(q.passage)}`;
      passageEl.className = 'passage-box listening-box';
      passageEl.style.display = 'block';
    } else {
      passageEl.style.display = 'none';
    }
  } else {
    mediaEl.innerHTML = '';
    mediaEl.style.display = 'none';
    if (q.passage) {
      passageEl.textContent = q.passage;
      passageEl.className = 'passage-box';
      passageEl.style.display = 'block';
    } else {
      passageEl.style.display = 'none';
    }
  }

  document.getElementById('quiz-question-text').textContent = q.question_text;

  const opts = document.getElementById('quiz-options');
  opts.innerHTML = Object.entries(q.options).map(([label, text]) => `
    <button class="option-btn ${answered ? getOptionClass(q, label, answered) : ''}"
            data-label="${label}"
            onclick="selectOption(this, '${q.id}', '${label}')"
            ${answered ? 'disabled' : ''}>
      <span class="option-label">${label}</span>
      <span>${escHtml(text)}</span>
    </button>
  `).join('');

  const expEl = document.getElementById('quiz-explanation');
  if (answered?.explanation) {
    expEl.innerHTML = `<div class="exp-label">Giải thích</div>${escHtml(answered.explanation)}`;
    expEl.style.display = 'block';
  } else {
    expEl.style.display = 'none';
  }

  document.getElementById('btn-prev').disabled = idx === 0;
  const isLast = idx === total - 1;
  const btnNext = document.getElementById('btn-next');
  btnNext.textContent = isLast ? 'Xem kết quả' : 'Câu tiếp →';
  btnNext.className = `btn ${isLast ? 'btn-success' : 'btn-primary'}`;
}

function getOptionClass(q, label, answered) {
  if (!answered) return '';
  const correct = answered.shuffledCorrect;
  if (label === correct) return 'correct';
  if (label === answered.userAnswer && label !== correct) return 'wrong';
  return '';
}

function typeLabel(t) {
  return { vocabulary: 'Từ vựng', grammar: 'Ngữ pháp', reading: 'Đọc hiểu', listening: 'Nghe hiểu' }[t] || t;
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Listening: TTS on-demand ───────────────────────────
window.requestAudio = async function(questionId) {
  const q = state.quiz.questions.find(x => x.id === questionId);
  if (!q) return;
  state.quiz.audioLoading[questionId] = true;
  renderQuestion();
  const text = [q.passage, q.question_text].filter(Boolean).join('\n\n');
  try {
    const res = await apiFetch('/audio-api/generate', {
      method: 'POST',
      body: JSON.stringify({ text, question_id: questionId }),
    });
    state.quiz.audioLoaded[questionId] = res.audio_url;
    state.quiz.passageVisible[questionId] = true;
  } catch (e) {
    toast('Không thể tạo audio: ' + e.message, 'error');
  } finally {
    state.quiz.audioLoading[questionId] = false;
    renderQuestion();
  }
};

window.togglePassage = function(questionId) {
  state.quiz.passageVisible[questionId] = !state.quiz.passageVisible[questionId];
  renderQuestion();
};

// ── Select Answer ──────────────────────────────────────
window.selectOption = async function(btnEl, questionId, label) {
  if (state.quiz.answers[questionId]) return;
  const timeTaken = getQuestionElapsedTime();

  if (guestState.active) {
    // Guest mode: score locally using correctMap
    const shuffledCorrect = String(guestState.correctMap[questionId] || '');
    const isCorrect = label.toUpperCase() === shuffledCorrect.toUpperCase();
    state.quiz.answers[questionId] = {
      userAnswer: label,
      isCorrect,
      shuffledCorrect,
      explanation: null,
    };
    btnEl.closest('.options-grid').querySelectorAll('.option-btn').forEach(b => b.disabled = true);
    renderQuestion();
  } else {
    // Authenticated: send to server
    btnEl.classList.add('selected');
    btnEl.closest('.options-grid').querySelectorAll('.option-btn').forEach(b => b.disabled = true);
    try {
      const res = await apiFetch(`/quiz/${state.quiz.sessionId}/answer`, {
        method: 'POST',
        body: JSON.stringify({ question_id: parseInt(questionId), user_answer: label, time_taken: timeTaken }),
      });
      state.quiz.answers[questionId] = {
        userAnswer: label,
        isCorrect: res.is_correct,
        shuffledCorrect: res.correct_answer,
        explanation: res.explanation,
      };
      renderQuestion();
    } catch {
      btnEl.classList.remove('selected');
      btnEl.closest('.options-grid').querySelectorAll('.option-btn').forEach(b => b.disabled = false);
    }
  }
};

// ── Navigation ─────────────────────────────────────────
window.prevQuestion = function() {
  if (state.quiz.currentIndex > 0) { state.quiz.currentIndex--; renderQuestion(); }
};

window.nextQuestion = function() {
  const total = state.quiz.questions.length;
  if (state.quiz.currentIndex < total - 1) { state.quiz.currentIndex++; renderQuestion(); }
  else submitQuiz(false);
};

async function submitQuiz(forced = false) {
  if (!forced) {
    const answered = Object.keys(state.quiz.answers).length;
    const total = state.quiz.questions.length;
    if (answered < total) {
      const ok = await showConfirm(`Còn <strong>${total - answered} câu</strong> chưa trả lời.<br>Bạn có muốn nộp bài và xem kết quả không?`, 'Nộp bài', 'Làm tiếp');
      if (!ok) return;
    }
  }
  clearInterval(state.quiz.timer);

  if (guestState.active) {
    // Build result before clearing state
    const answers = state.quiz.questions.map(q => {
      const ans = state.quiz.answers[q.id];
      return {
        question_id: q.id,
        question_text: q.question_text,
        user_answer: ans?.userAnswer || null,
        correct_answer: String(guestState.correctMap[q.id] || ''),
        is_correct: ans?.isCorrect ?? null,
        explanation: null,
      };
    });
    const correctCount = answers.filter(a => a.is_correct).length;
    const total = state.quiz.questions.length;
    const resultData = {
      session_id: null,
      level: state.quiz.questions[0]?.level || '',
      question_type: null,
      score: total > 0 ? Math.round(correctCount / total * 100) : 0,
      correct_count: correctCount,
      total_questions: total,
      time_summary: {},
      answers,
    };
    state.quiz.paused = false;
    state.quiz.questions = [];
    showPage('result');
    renderResult(resultData, true);
  } else {
    try {
      const result = await apiFetch(`/quiz/${state.quiz.sessionId}/complete`, { method: 'POST' });
      state.quiz.paused = false;
      state.quiz.questions = [];
      showPage('result');
      renderResult(result, false);
    } catch {}
  }
}

// ── Result ─────────────────────────────────────────────
function renderResult(result, isGuest = false) {
  const score = Math.round(result.score);
  const grade = score >= 70 ? 'Đạt 🎉' : score >= 50 ? 'Gần đạt 💪' : 'Cần ôn lại 📖';
  document.getElementById('result-score-num').textContent = `${score}%`;
  document.getElementById('result-grade').textContent = grade;
  document.getElementById('result-summary').textContent =
    `${result.correct_count} / ${result.total_questions} câu đúng · ${result.level}${result.question_type ? ' ' + typeLabel(result.question_type) : ''}`;

  document.getElementById('result-answers').innerHTML = result.answers.map((a, i) => `
    <div class="answer-item ${a.is_correct ? 'correct-item' : 'wrong-item'}">
      <div class="q-text">${i+1}. ${escHtml(a.question_text)}</div>
      <div class="a-row">
        <span>Bạn chọn: <span class="${a.is_correct ? 'a-correct' : 'a-wrong'}">${a.user_answer || 'Chưa trả lời'}</span></span>
        <span>Đáp án đúng: <span class="a-correct">${a.correct_answer}</span></span>
        ${a.explanation ? `<span>Giải thích: ${escHtml(a.explanation)}</span>` : ''}
      </div>
    </div>
  `).join('');

  const savePrompt = document.getElementById('guest-save-prompt');
  if (savePrompt) savePrompt.style.display = isGuest ? '' : 'none';
}

window.retryQuiz = function() { showPage('home'); };

// ── History ────────────────────────────────────────────
async function loadHistory() {
  const el = document.getElementById('history-list');
  if (!el) return;
  try {
    const data = await apiFetch('/quiz/history');
    renderHistory(data);
  } catch {}
}
window.loadHistory = loadHistory;

function renderHistory(sessions) {
  const el = document.getElementById('history-list');
  if (!sessions.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">📋</div><p>Chưa có lịch sử làm bài</p></div>';
    return;
  }
  el.innerHTML = sessions.map(s => {
    const score = s.score != null ? Math.round(s.score) : null;
    const passed = score != null && score >= 70;
    const dt = new Date(s.started_at).toLocaleString('vi-VN');
    return `
      <div class="history-item">
        <div class="history-score ${score == null ? '' : passed ? 'pass' : 'fail'}">
          ${score != null ? score + '%' : '--'}
        </div>
        <div class="history-meta">
          <strong>${s.level} ${s.question_type ? typeLabel(s.question_type) : 'Tất cả loại'}</strong><br>
          ${s.correct_count} / ${s.total_questions} câu đúng · ${dt}
          ${s.completed_at ? '' : ' <em>(Chưa hoàn thành)</em>'}
        </div>
        ${s.completed_at ? `<button class="btn btn-outline btn-sm" onclick="viewResult(${s.id})">Chi tiết</button>` : ''}
      </div>
    `;
  }).join('');
}

window.viewResult = async function(sessionId) {
  try {
    const result = await apiFetch(`/quiz/${sessionId}/result`);
    showPage('result');
    renderResult(result, false);
  } catch {}
};

// ── Exam Sets ──────────────────────────────────────────

async function loadExamSets() {
  const wrap = document.getElementById('exam-sets-list');
  if (!wrap) return;
  wrap.innerHTML = '<div class="empty-state"><div class="icon">📚</div><p>Đang tải...</p></div>';
  try {
    const sets = await apiFetch('/quiz/exam-sets');
    if (!sets.length) {
      wrap.innerHTML = '<div class="empty-state"><div class="icon">📚</div><p>Chưa có bộ đề nào.</p></div>';
      return;
    }
    wrap.innerHTML = sets.map(s => `
      <div class="history-item" style="cursor:default;">
        <div>
          <strong>${escHtml(s.name)}</strong>
          <div style="font-size:0.82rem;color:var(--text-muted);">
            <span class="badge badge-${escHtml(s.level)}">${escHtml(s.level)}</span>
            ${s.year} · ${s.session === 'july' ? 'Tháng 7' : s.session === 'december' ? 'Tháng 12' : ''}
            · ${s.question_count} câu
          </div>
          ${s.description ? `<div style="font-size:0.82rem;color:var(--text-muted);margin-top:4px;">${escHtml(s.description)}</div>` : ''}
        </div>
        <button class="btn btn-primary btn-sm" onclick="startExamQuiz(${s.id})">▶ Thi thử</button>
      </div>
    `).join('');
  } catch (e) {
    wrap.innerHTML = `<div class="empty-state"><p>Lỗi: ${escHtml(e.message)}</p></div>`;
  }
}

window.loadExamSets = loadExamSets;

// ── Exam Catalog (sidebar + year/session grid) ─────────

async function loadExamPage() {
  const grid = document.getElementById('exam-year-grid');
  if (!getToken()) {
    if (grid) grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:32px 16px;color:var(--text-muted);">
      <div style="font-size:2rem;margin-bottom:8px;">🔒</div>
      <p>Đăng nhập để xem bộ đề thi.</p>
      <button class="btn btn-primary btn-sm" style="margin-top:12px;" onclick="window.showLoginModal && window.showLoginModal()">Đăng nhập</button>
    </div>`;
    return;
  }
  try {
    state.exam.sets = await apiFetch('/quiz/exam-sets');
  } catch (e) {
    state.exam.sets = [];
    if (e?.status === 403 && grid) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:32px 16px;color:var(--text-muted);">
        <div style="font-size:2rem;margin-bottom:8px;">🔒</div>
        <p>Bạn chưa được cấp quyền truy cập bộ đề thi.</p>
        <p style="font-size:0.82rem;margin-top:6px;">Liên hệ quản trị viên để được cấp quyền.</p>
      </div>`;
      return;
    }
  }
  renderExamGrid(state.exam.level);
}

window.selectExamLevel = function(level) {
  state.exam.level = level;
  document.querySelectorAll('.exam-sidebar-item').forEach(el => {
    el.classList.toggle('active', el.dataset.level === level);
  });
  const title = document.getElementById('exam-main-title');
  if (title) title.textContent = `📋 Đề thi ${level}`;
  renderExamGrid(level);
};

function renderExamGrid(level) {
  const grid = document.getElementById('exam-year-grid');
  if (!grid) return;
  const currentYear = new Date().getFullYear();
  const SESSION_LABEL = { july: '7', december: '12' };
  const SESSION_ORDER = ['december', 'july'];
  // Show 20 years to cover data back to 2006
  const years = Array.from({ length: 20 }, (_, i) => currentYear - 1 - i);

  grid.innerHTML = years.flatMap(year =>
    SESSION_ORDER.map(session => {
      const match = state.exam.sets.find(
        s => s.year === year && s.session === session && s.level === level && s.question_count > 0
      );
      const label = `${year}/${SESSION_LABEL[session]}`;
      if (match) {
        return `<button class="exam-year-btn available" onclick="openExamSet(${match.id})">
          <div>${label}</div><div class="exam-btn-sub">${match.question_count} câu</div></button>`;
      }
      return `<button class="exam-year-btn unavailable" disabled>
        <div>${label}</div><div class="exam-btn-sub">Sắp có</div></button>`;
    })
  ).join('');
}

window.openExamSet = async function(examSetId) {
  if (!getToken()) { showLoginModal(); return; }
  if (state.quiz.paused && state.quiz.questions.length > 0) {
    const ok = await showConfirm('Bạn đang có bài làm chưa hoàn thành.<br>Bắt đầu đề thi sẽ hủy tiến độ đó.', 'Bắt đầu đề thi', 'Tiếp tục làm');
    if (!ok) return;
    clearInterval(state.quiz.timer);
    state.quiz.paused = false;
    state.quiz.questions = [];
    _updateHomeButtons();
  }
  await startExamQuiz(examSetId);
};

window.startExamQuiz = async function(examSetId) {
  try {
    const res = await apiFetch('/quiz/exam-start', {
      method: 'POST',
      body: JSON.stringify({ exam_set_id: examSetId }),
    });
    state.quiz.sessionId = res.session_id;
    state.quiz.questions = res.questions;
    state.quiz.currentIndex = 0;
    state.quiz.answers = {};
    state.quiz.timers = {};
    state.quiz.audioLoading = {};
    state.quiz.audioLoaded = {};
    state.quiz.passageVisible = {};
    guestState.active = false;
    if (res.total_minutes) {
      state.quiz.timeLeft = res.total_minutes * 60;
      state.quiz.totalTime = res.total_minutes * 60;
    } else {
      state.quiz.timeLeft = 0;
    }
    showPage('quiz');
    renderQuestion();
    if (res.total_minutes) startTimer();
    toast('Bắt đầu thi thử bộ đề!', 'success');
  } catch (e) {
    toast(e.message || 'Không thể bắt đầu bài thi', 'error');
  }
};

// ── Admin / User Management ────────────────────────────

async function loadUsers() {
  const wrap = document.getElementById('users-table-wrap');
  if (!wrap) return;
  try {
    const users = await fetch('/api/v1/admin/users', {
      headers: { 'Authorization': `Bearer ${getToken()}` },
    }).then(r => r.json());
    if (!Array.isArray(users) || !users.length) {
      wrap.innerHTML = '<div class="empty-state"><p>Chưa có người dùng.</p></div>';
      return;
    }
    wrap.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
        <thead>
          <tr style="background:var(--bg);">
            <th style="padding:8px;text-align:left;border-bottom:2px solid var(--border);">Tài khoản</th>
            <th style="padding:8px;text-align:left;border-bottom:2px solid var(--border);">Email</th>
            <th style="padding:8px;text-align:center;border-bottom:2px solid var(--border);">Admin</th>
            <th style="padding:8px;text-align:center;border-bottom:2px solid var(--border);">Quyền đề thi</th>
            <th style="padding:8px;text-align:center;border-bottom:2px solid var(--border);">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          ${users.map(u => `
            <tr>
              <td style="padding:8px;border-bottom:1px solid var(--border);">${escHtml(u.username)}</td>
              <td style="padding:8px;border-bottom:1px solid var(--border);">${escHtml(u.email)}</td>
              <td style="padding:8px;text-align:center;border-bottom:1px solid var(--border);">${u.is_superuser ? '✅' : ''}</td>
              <td style="padding:8px;text-align:center;border-bottom:1px solid var(--border);">
                <span id="exam-access-badge-${u.id}">${u.has_jlpt_exam_access ? '✅ Có' : '—'}</span>
              </td>
              <td style="padding:8px;text-align:center;border-bottom:1px solid var(--border);">
                ${!u.is_superuser ? `
                  <button class="btn btn-sm ${u.has_jlpt_exam_access ? 'btn-outline' : 'btn-success'}"
                    onclick="toggleJlptAccess(${u.id}, ${!u.has_jlpt_exam_access})">
                    ${u.has_jlpt_exam_access ? 'Thu hồi' : 'Cấp quyền'}
                  </button>
                ` : '<span style="color:var(--text-muted);font-size:0.8rem;">—</span>'}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch {
    wrap.innerHTML = '<div class="empty-state"><p>Lỗi tải danh sách.</p></div>';
  }
}

window.loadUsers = loadUsers;

window.toggleJlptAccess = async function(userId, grant) {
  try {
    await fetch(`/api/v1/admin/users/${userId}/jlpt-access`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`,
      },
      body: JSON.stringify({ grant }),
    }).then(r => { if (!r.ok) throw new Error('Lỗi'); return r.json(); });
    toast(grant ? 'Đã cấp quyền đề thi.' : 'Đã thu hồi quyền đề thi.', 'success');
    loadUsers();
  } catch {
    toast('Không thể thay đổi quyền.', 'error');
  }
};

// ── Admin / Exam Set CRUD ──────────────────────────────

async function loadAdminExamSets() {
  const wrap = document.getElementById('admin-exam-sets-list');
  if (!wrap) return;
  try {
    const sets = await fetch('/api/v1/admin/exam-sets', {
      headers: { 'Authorization': `Bearer ${getToken()}` },
    }).then(r => r.json());
    if (!Array.isArray(sets) || !sets.length) {
      wrap.innerHTML = '<div class="empty-state"><p>Chưa có bộ đề nào.</p></div>';
      return;
    }
    wrap.innerHTML = sets.map(s => `
      <div class="history-item" style="cursor:default;">
        <div>
          <strong>${escHtml(s.name)}</strong>
          <div style="font-size:0.82rem;color:var(--text-muted);">
            <span class="badge badge-${escHtml(s.level)}">${escHtml(s.level)}</span>
            ${s.year} · ${s.question_count} câu · ${s.is_active ? '✅ Hiển thị' : '🚫 Ẩn'}
          </div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <label class="btn btn-outline btn-sm" style="cursor:pointer;position:relative;overflow:hidden;">
            📥 Import JSON
            <input type="file" accept=".json" style="position:absolute;opacity:0;width:100%;height:100%;top:0;left:0;cursor:pointer;"
              onchange="importExamJson(${s.id}, this)">
          </label>
          <label class="btn btn-outline btn-sm" style="cursor:pointer;position:relative;overflow:hidden;">
            🗜 Upload Media
            <input type="file" accept=".zip" style="position:absolute;opacity:0;width:100%;height:100%;top:0;left:0;cursor:pointer;"
              onchange="uploadExamMedia(${s.id}, this)">
          </label>
        </div>
      </div>
    `).join('');
  } catch {
    wrap.innerHTML = '<div class="empty-state"><p>Lỗi tải danh sách.</p></div>';
  }
}

window.loadAdminExamSets = loadAdminExamSets;

window.createExamSet = async function() {
  const name = document.getElementById('es-name').value.trim();
  const year = parseInt(document.getElementById('es-year').value);
  const level = document.getElementById('es-level').value;
  const session = document.getElementById('es-session').value || null;
  const description = document.getElementById('es-desc').value.trim() || null;
  if (!name || !year || !level) { toast('Vui lòng điền đầy đủ tên, năm và cấp độ.', 'error'); return; }
  try {
    await fetch('/api/v1/admin/exam-sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
      body: JSON.stringify({ name, year, level, session, description }),
    }).then(r => { if (!r.ok) throw new Error('Lỗi'); return r.json(); });
    toast('Đã tạo bộ đề!', 'success');
    ['es-name','es-year','es-desc'].forEach(id => document.getElementById(id).value = '');
    loadAdminExamSets();
  } catch {
    toast('Không thể tạo bộ đề.', 'error');
  }
};

window.importExamJson = async function(examSetId, input) {
  const file = input.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch(`/api/v1/admin/exam-sets/${examSetId}/import`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getToken()}` },
      body: formData,
    }).then(r => { if (!r.ok) throw new Error('Lỗi'); return r.json(); });
    toast(`Import thành công: +${res.added} câu, bỏ qua ${res.skipped}.`, 'success');
    loadAdminExamSets();
  } catch {
    toast('Không thể import JSON.', 'error');
  }
  input.value = '';
};

window.uploadExamMedia = async function(examSetId, input) {
  const file = input.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch(`/api/v1/admin/exam-sets/${examSetId}/upload-media`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getToken()}` },
      body: formData,
    }).then(r => { if (!r.ok) throw new Error('Lỗi'); return r.json(); });
    toast(`Upload thành công: ${res.extracted} file.`, 'success');
  } catch {
    toast('Không thể upload media.', 'error');
  }
  input.value = '';
};

// ── Admin / Crawler ────────────────────────────────────
function resetAdminLog() {
  const log = document.getElementById('crawl-log');
  if (log) log.innerHTML = '<span class="log-info">Nhật ký sẽ hiển thị ở đây...</span>';
}

function addLog(msg, type = '') {
  const log = document.getElementById('crawl-log');
  if (!log) return;
  const cls = type === 'ok' ? 'log-ok' : type === 'err' ? 'log-err' : 'log-info';
  log.innerHTML += `\n<span class="${cls}">[${new Date().toLocaleTimeString()}] ${escHtml(msg)}</span>`;
  log.scrollTop = log.scrollHeight;
}

window.startCrawl = async function() {
  const source = document.getElementById('crawl-source').value;
  const level = document.getElementById('crawl-level').value;
  const qtype = document.getElementById('crawl-type').value;
  const pages = document.getElementById('crawl-pages').value || 3;
  if (!level) { toast('Vui lòng chọn cấp độ!', 'error'); return; }
  const btn = document.getElementById('btn-crawl');
  btn.disabled = true;
  addLog(`Bắt đầu thu thập: ${source} · ${level} · ${qtype || 'Tất cả loại'} · tối đa ${pages} trang`, 'info');
  try {
    const res = await apiFetch('/crawler/run', {
      method: 'POST',
      body: JSON.stringify({ source, level, question_type: qtype || null, max_pages: parseInt(pages) }),
    });
    addLog(`Hoàn thành: thêm ${res.added} câu, bỏ qua ${res.skipped} câu`, 'ok');
    if (res.errors?.length) res.errors.forEach(e => addLog(`Lỗi: ${e}`, 'err'));
    loadStats();
    toast(`Đã thêm ${res.added} câu hỏi`, 'success');
  } catch (e) {
    addLog(`Thu thập thất bại: ${e.message}`, 'err');
  } finally {
    btn.disabled = false;
  }
};

window.loadSeedData = async function() {
  const btn = document.getElementById('btn-seed');
  btn.disabled = true;
  addLog('Đang nạp dữ liệu mẫu...', 'info');
  try {
    const res = await apiFetch('/crawler/seed', { method: 'POST' });
    addLog(`Hoàn thành: đã thêm ${res.added} câu hỏi`, 'ok');
    loadStats();
    toast(`Đã thêm ${res.added} câu hỏi`, 'success');
  } catch {
  } finally {
    btn.disabled = false;
  }
};

// ── Init ───────────────────────────────────────────────
const user = await requireAuth();
renderUserIcon(user);
_applyAuthState(user);

document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => showPage(tab.dataset.page));
});

// Admin link from user dropdown dispatches this event
document.addEventListener('uib:go-admin', () => showPage('admin'));

// Re-apply auth state after login via modal
document.addEventListener('auth:login', async (e) => {
  const loggedInUser = e.detail.user;
  renderUserIcon(loggedInUser);
  _applyAuthState(loggedInUser);
  if (state.currentPage === 'history') loadHistory();
  if (state.currentPage === 'admin' && loggedInUser.is_superuser) {
    loadStats(); loadUsers(); loadAdminExamSets();
  }
});

showPage('home');
