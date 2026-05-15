import { requireAuth, renderNavbar } from './app.js';

const API = '/api/v1/jlpt';

// ── Auth ───────────────────────────────────────────────
let _token = null;

function getToken() {
  return localStorage.getItem('access_token');
}

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
  },
  stats: null,
};

// ── Navigation ─────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`page-${name}`)?.classList.add('active');
  document.querySelector(`.nav-tab[data-page="${name}"]`)?.classList.add('active');
  state.currentPage = name;
  if (name === 'history') loadHistory();
  if (name === 'admin') { resetAdminLog(); loadStats(); }
}

window.showPage = showPage;

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

// ── Home / Stats ───────────────────────────────────────
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

  try {
    const data = await apiFetch('/quiz/start', { method: 'POST', body: JSON.stringify(payload) });
    const totalQ = data.questions.length;
    const totalMins = data.total_minutes || totalQ;

    state.quiz.sessionId = data.session_id;
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
    toast('Bắt đầu làm bài!', 'success');
  } catch {
  } finally {
    btn.disabled = false;
    btn.textContent = 'Bắt đầu làm bài';
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
    if (answered < total && !confirm(`Còn ${total - answered} câu chưa trả lời. Xem kết quả?`)) return;
  }
  clearInterval(state.quiz.timer);
  try {
    const result = await apiFetch(`/quiz/${state.quiz.sessionId}/complete`, { method: 'POST' });
    showPage('result');
    renderResult(result);
  } catch {}
}

// ── Result ─────────────────────────────────────────────
function renderResult(result) {
  const score = Math.round(result.score);
  const grade = score >= 70 ? 'Đạt 🎉' : score >= 50 ? 'Gần đạt 💪' : 'Cần ôn lại 📖';
  document.getElementById('result-score-num').textContent = `${score}%`;
  document.getElementById('result-grade').textContent = grade;
  document.getElementById('result-summary').textContent =
    `${result.correct_count} / ${result.total_questions} câu đúng · ${result.level} ${result.question_type ? typeLabel(result.question_type) : 'Tất cả loại'}`;

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
}

window.retryQuiz = function() { showPage('home'); };

// ── History ────────────────────────────────────────────
async function loadHistory() {
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
    renderResult(result);
  } catch {}
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
if (user) {
  renderNavbar(user);
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => showPage(tab.dataset.page));
  });
  showPage('home');
}
