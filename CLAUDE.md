# CLAUDE.md — MyApp Development Guide

## Tech Stack

- **Backend**: FastAPI + SQLAlchemy + SQLite/PostgreSQL
- **Frontend**: Vanilla HTML/JS (ES modules) + CSS
- **Auth**: Custom JWT (HS256), bcrypt passwords
- **Payment**: Stripe Payment Element
- **Deploy**: Render (web service, root: `backend/`, command: `uvicorn app.main:app`)

## Project Structure

```
myapp/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI entry — routers, middleware, lifespan
│   │   ├── database.py          # SQLAlchemy engine + Base + get_db
│   │   ├── core/
│   │   │   ├── config.py        # Settings (Pydantic BaseSettings, reads .env)
│   │   │   └── security.py      # JWT encode/decode, password hashing
│   │   ├── models/
│   │   │   └── user.py          # User SQLAlchemy model
│   │   ├── auth/                # JWT auth module
│   │   │   ├── router.py        # /api/v1/auth (register, login, refresh, me, logout)
│   │   │   ├── service.py       # User CRUD helpers
│   │   │   ├── schemas.py       # Pydantic schemas
│   │   │   └── dependencies.py  # get_current_user, get_current_superuser
│   │   ├── payment/             # Stripe payment module
│   │   │   ├── router.py        # /api/v1/payment
│   │   │   ├── schemas.py
│   │   │   └── exception_handlers.py
│   │   ├── admin/               # Admin management module
│   │   │   └── router.py        # /api/v1/admin (superuser only)
│   │   └── jlpt/                # JLPT learning module (main app)
│   │       ├── models.py        # Question, JlptQuizSession, JlptQuizAnswer, JlptExamSet
│   │       ├── schemas.py       # Pydantic schemas incl. GuestQuizStartResponse, ExamSetOut
│   │       └── routers/
│   │           ├── questions.py # public question listing & stats
│   │           ├── quiz.py      # quiz sessions (guest-start public, rest auth)
│   │           ├── audio.py     # TTS audio generation (edge-tts)
│   │           └── crawler.py   # seed data loading
│   ├── stripe_payment/          # Stripe SDK wrapper library
│   │   ├── client.py            # init_stripe()
│   │   ├── payment.py           # create/confirm/refund PaymentIntent
│   │   ├── customer.py          # create/retrieve/delete Customer
│   │   ├── webhook.py           # webhook signature verification
│   │   ├── models.py            # PaymentResult, CustomerResult dataclasses
│   │   └── exceptions.py        # CardDeclinedError, InvalidCardError, etc.
│   └── crawler/                 # Seed data for JLPT questions (N1-N5)
└── frontend/
    ├── index.html               # Main landing page — JLPT app (no auth required, served at /)
    ├── login.html               # Standalone login/register page
    ├── dashboard.html           # Admin hub (superuser only — redirects others)
    ├── payment.html             # Stripe payment (auth required)
    ├── css/jlpt.css
    └── js/
        ├── auth.js              # Auth API module (token management, API calls)
        ├── auth-ui.js           # Login/register modal UI component (reusable)
        ├── app.js               # Shared: requireAuth, renderNavbar, renderUserIcon
        └── jlpt.js              # JLPT quiz logic (guest + auth modes)
```

## Development

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env   # fill in SECRET_KEY, STRIPE_* keys
uvicorn app.main:app --reload
# App: http://localhost:8000
# API docs: http://localhost:8000/api/docs
```

## .env variables

```
APP_NAME=MyApp
SECRET_KEY=<minimum-32-chars>
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7
DATABASE_URL=sqlite:///./myapp.db
CORS_ORIGINS=["*"]
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_VERIFY_SSL=true
ADMIN_USERNAME=<admin-account-username>
```

## Admin & Permissions

### User roles
- `is_superuser = True` — full admin access: dashboard, admin panel, all exam sets
- `has_jlpt_exam_access = True` — can view/take restricted JLPT exam sets
- Default user — public practice questions only

### Admin account setup
On every startup, `_startup_db_fixes()` reads `ADMIN_USERNAME` env var and grants `is_superuser=True`
to that account if not already set. Set this in `.env` (not hardcoded in source).

### Dashboard protection
`dashboard.html` requires `is_superuser=True`. Non-admin users are redirected to `/` (JLPT page).
Guests are redirected to `/login.html`.

### Admin API (`/api/v1/admin/*`) — superuser only
```
GET  /admin/users                       — list all users
PATCH /admin/users/{id}/jlpt-access     — {grant: bool} toggle exam access
GET  /admin/exam-sets                   — list all exam sets (incl. inactive)
POST /admin/exam-sets                   — create exam set
PATCH /admin/exam-sets/{id}             — update exam set info
POST /admin/exam-sets/{id}/import       — import questions from JSON file
POST /admin/exam-sets/{id}/upload-media — upload zip with images/audio
```

### JLPT Exam Set API (`/api/v1/jlpt/quiz/*`) — requires auth + has_jlpt_exam_access
```
GET  /jlpt/quiz/exam-sets               — list active exam sets
POST /jlpt/quiz/exam-start              — {exam_set_id: int} start exam session
```
Superusers bypass the `has_jlpt_exam_access` check automatically.

### Exam Set data import format (JSON)
```json
{
  "questions": [
    {
      "question_type": "vocabulary",
      "question_text": "問題文...",
      "option_a": "...", "option_b": "...", "option_c": "...", "option_d": "...",
      "correct_answer": "A",
      "explanation": "Giải thích...",
      "passage": "",
      "image_url": "/exam-sets/1/images/q001.jpg",
      "audio_url": "/exam-sets/1/audio/q001.mp3"
    }
  ]
}
```
Upload images/audio first via `/admin/exam-sets/{id}/upload-media` (zip file),
then reference paths in the JSON import. Media stored at `static/exam-sets/{id}/`.

### Question segregation
- Practice questions: `exam_set_id IS NULL` — used by `/quiz/start` and `/quiz/guest-start`
- Exam set questions: `exam_set_id = <id>` — used by `/quiz/exam-start` (restricted)

## Adding a new FastAPI router

```python
# 1. Create backend/app/yourmodule/router.py
from fastapi import APIRouter
router = APIRouter(tags=["yourmodule"])

@router.get("/")
def list_items(): ...

# 2. Register in backend/app/main.py
from app.yourmodule.router import router as yourmodule_router
app.include_router(yourmodule_router, prefix="/api/v1/yourmodule")
```

## Frontend conventions

- **Confirm dialogs**: Dùng `showConfirm(message, confirmText, cancelText)` trong `jlpt.js` — trả về `Promise<boolean>`. **Không dùng** `window.confirm()` hoặc `window.alert()`.
- **Login page**: `/login.html` (standalone). Trang chủ là `/` → `index.html` (JLPT app).
- **requireAuthStrict()**: redirect về `/login.html?next=<path>` nếu chưa đăng nhập.

## Auth flow

- Public endpoints: `/api/v1/auth/register`, `/login`, `/refresh`
- Protected endpoints: add `current_user: User = Depends(get_current_user)`
- Frontend (auth required page): `const user = await requireAuthStrict()` — redirects to login
- Frontend (optional auth): `const user = await requireAuth()` — returns null for guests

## Guest quiz vs. authenticated quiz

- `POST /api/v1/jlpt/quiz/guest-start` — no auth, returns questions + `correct_map`
  (client scores locally, no DB session created)
- `POST /api/v1/jlpt/quiz/start` — requires auth, creates DB session, server scores answers
- After login, `auth:login` custom event fires so jlpt.js updates the UI in-place

---

## JLPT Module — Chi tiết

### Database models (`backend/app/jlpt/models.py`)

**`Question`** — bảng `jlpt_questions`
```
id, level (N1–N5), question_type (vocabulary|grammar|reading|listening)
passage (Text, nullable)    — đoạn văn đọc hiểu hoặc hội thoại nghe
question_text               — câu hỏi (tiếng Nhật)
option_a, option_b, option_c, option_d
correct_answer              — "A" | "B" | "C" | "D" (stored as-is, shuffled at quiz time)
explanation (Text)          — giải thích đáp án
audio_url                   — path /audio/jlpt_<hash>.mp3 (tự động điền sau khi TTS)
image_url                   — hình ảnh câu hỏi (optional)
is_active (bool, default True) — câu không active không xuất hiện trong quiz
```

**`JlptQuizSession`** — bảng `jlpt_quiz_sessions`
```
id, user_id (FK users.id, nullable), level, question_type (nullable = all types)
num_questions, total_questions, correct_count
started_at, completed_at (nullable — null = chưa hoàn thành)
score (float 0–100, nullable — tính khi complete)
session_questions (Text) — JSON list các question_id theo thứ tự
```

**`JlptQuizAnswer`** — bảng `jlpt_quiz_answers`
```
id, session_id (FK), question_id (FK)
user_answer (nullable — null = chưa trả lời)
shuffled_correct — label đúng SAU KHI shuffle (có thể khác correct_answer gốc)
is_correct (bool nullable), time_taken (float giây), answered_at
```

> **Quan trọng**: option shuffle xảy ra khi tạo quiz. `shuffled_correct` lưu label mới (A/B/C/D) sau shuffle, không phải label gốc. Frontend dùng `shuffled_correct` để highlight đáp án đúng.

### JLPT Structure (`quiz.py` — `JLPT_STRUCTURE`)

Số câu và thời gian đúng chuẩn JLPT:
```python
JLPT_STRUCTURE = {
    "N5": {"vocabulary": 25, "grammar": 16, "reading":  9, "listening": 12, "minutes": 105},
    "N4": {"vocabulary": 25, "grammar": 16, "reading": 12, "listening": 14, "minutes": 115},
    "N3": {"vocabulary": 25, "grammar": 24, "reading": 19, "listening": 22, "minutes": 140},
    "N2": {"vocabulary": 28, "grammar": 12, "reading": 32, "listening": 29, "minutes": 155},
    "N1": {"vocabulary": 25, "grammar": 10, "reading": 34, "listening": 29, "minutes": 170},
}
```
Thứ tự câu hỏi: vocabulary → grammar → reading → listening (sort theo `TYPE_ORDER`).

### API Endpoints (`backend/app/jlpt/routers/`)

**Questions** (`/api/v1/jlpt/questions`, public):
```
GET  /stats/summary           — thống kê {total, by_level, by_type, by_level_type}
GET  /?level=N3&question_type=grammar&skip=0&limit=50
GET  /{id}
POST /                        — tạo câu hỏi mới
DELETE /{id}
```

**Quiz** (`/api/v1/jlpt/quiz`):
```
GET  /history                 — [auth] 20 session gần nhất của user
POST /guest-start             — [public] quiz không lưu DB; trả về correct_map cho client tự chấm
POST /start                   — [auth] tạo JlptQuizSession + JlptQuizAnswer rows
POST /{session_id}/answer     — [auth] nộp 1 câu; trả về {is_correct, correct_answer, explanation}
POST /{session_id}/complete   — [auth] tính score, set completed_at; trả về QuizResult
GET  /{session_id}/result     — [auth] xem lại kết quả đã hoàn thành
```

**Audio** (`/api/v1/jlpt/audio-api`, public):
```
POST /generate  — body: {text, question_id, voice?}
                  cache bằng SHA1 hash của text → /static/audio/jlpt_<hash>.mp3
                  voice default: "ja-JP-NanamiNeural" (edge-tts)
                  sau khi tạo: cập nhật question.audio_url và bật is_active=True
                  trả về: {audio_url, cached}
```

**Crawler** (`/api/v1/jlpt/crawler`, public):
```
POST /seed  — nạp dữ liệu mẫu từ backend/crawler/seed_data.py (duplicate-safe)
POST /run   — web crawler (chưa enable trên UI)
```

### Seed data (`backend/crawler/`)

```
seed_data.py              — aggregator, gọi get_seed_questions() → list[dict]
seed_data_n5_n4.py        — từ vựng + ngữ pháp N5, N4
seed_data_n3.py           — N3
seed_data_n2.py           — N2
seed_data_n1.py           — N1
seed_data_listening_demo.py — demo câu nghe (có passage)
seed_data_reading_long.py  — đọc hiểu đoạn dài
```

Mỗi question dict có schema:
```python
{
  "level": "N3",
  "question_type": "grammar",       # vocabulary | grammar | reading | listening
  "question_text": "...",
  "option_a": "...", "option_b": "...", "option_c": "...", "option_d": "...",
  "correct_answer": "A",            # A | B | C | D
  "explanation": "...",
  "passage": "",                    # bắt buộc với reading/listening, "" nếu không có
  "source_url": "",
}
```

App tự động seed khi startup (`main.py` → `_startup_db_fixes()`). Chỉ thêm câu chưa tồn tại (check theo `level + question_text`).

### Thêm câu hỏi mới

**Cách 1 — Seed data** (tốt nhất cho batch):
```python
# backend/crawler/seed_data_mydata.py
_MY_QUESTIONS = [
    {"level": "N3", "question_type": "vocabulary", "question_text": "...", ...}
]
def get_my_questions(): return _MY_QUESTIONS

# backend/crawler/seed_data.py — thêm vào get_seed_questions():
from crawler.seed_data_mydata import get_my_questions
questions += get_my_questions()
```

**Cách 2 — API trực tiếp**:
```bash
POST /api/v1/jlpt/questions
Content-Type: application/json
{"level":"N3","question_type":"grammar","question_text":"...","option_a":"...","option_b":"...","option_c":"...","option_d":"...","correct_answer":"A","explanation":"..."}
```

### Frontend JLPT (`frontend/js/jlpt.js`)

**State chính:**
```javascript
state.quiz.sessionId    // null khi guest mode
state.quiz.questions    // list QuestionForQuiz
state.quiz.answers      // {question_id: {userAnswer, isCorrect, shuffledCorrect, explanation}}
state.quiz.timeLeft     // giây còn lại

guestState.active       // true = đang ở chế độ khách
guestState.correctMap   // {question_id: shuffled_correct_label} — từ /guest-start response
```

**Luồng Guest Quiz:**
1. `startQuiz()` → `POST /quiz/guest-start` → lưu `correctMap` vào `guestState`
2. `selectOption()` → tự chấm bằng `correctMap[questionId]`, không gọi API
3. `submitQuiz()` → tính kết quả local, hiện `#guest-save-prompt`
4. User click "Đăng nhập" → `showLoginModal()` → sau login: `auth:login` event → `_applyAuthState(user)`

**Luồng Auth Quiz:**
1. `startQuiz()` → `POST /quiz/start` → nhận `session_id`
2. `selectOption()` → `POST /quiz/{session_id}/answer` → server trả `{is_correct, correct_answer, explanation}`
3. `submitQuiz()` → `POST /quiz/{session_id}/complete` → server tính score

**Auth-aware UI** — `_applyAuthState(user)` toggle các element:
- `#guest-banner` — hiện khi guest (home tab)
- `#history-login-required` / `#history-content` — toggle theo auth
- `#admin-login-required` / `#admin-content` — toggle theo `user.is_superuser`
- `#guest-save-prompt` — hiện sau khi guest hoàn thành quiz

### Audio TTS (câu nghe hiểu)

Audio được tạo on-demand khi user click "🎧 Nghe và xem nội dung":
1. Frontend gọi `requestAudio(questionId)` → `POST /audio-api/generate`
2. Backend dùng `edge-tts` tạo MP3, cache tại `/static/audio/jlpt_<sha1>.mp3`
3. Question record được update `audio_url` + `is_active=True`
4. Frontend render `<audio controls autoplay>` + nút "Xem nội dung hội thoại"

Voice mặc định: `ja-JP-NanamiNeural`. Có thể đổi bằng param `voice` trong request.

---

## Future: Extracting auth module to another repo

To reuse the `auth` module in a new FastAPI project:

**Step 1 — Move User model into auth/**
```
# Create backend/app/auth/models.py (copy from models/user.py)
# Update 5 import sites: auth/router.py, service.py, dependencies.py,
#   payment/router.py, jlpt/routers/quiz.py
#   Change: from app.models.user import User
#       To: from app.auth.models import User
# In main.py lifespan: add  import app.auth.models  before create_all
```

**Step 2 — Publish auth module interface**
```python
# backend/app/auth/__init__.py
from .models import User
from .schemas import UserRegister, UserLogin, TokenResponse, UserResponse
from .dependencies import get_current_user, get_current_superuser
from .router import router
```

**Step 3 — Copy to new repo**
Copy: `auth/`, `core/security.py`, `core/config.py` (settings for JWT), `database.py`

**Step 4 — Wire in new project**
```python
from app.auth import router as auth_router, get_current_user
app.include_router(auth_router, prefix="/api/v1")
```

---

## Future: Extracting payment module to another repo

The `stripe_payment/` library and `app/payment/` module should be merged first:

**Step 1 — Move stripe_payment inside payment/**
```
# Create backend/app/payment/stripe/ directory
# Move all files from backend/stripe_payment/ → backend/app/payment/stripe/
# Fix import in payment/stripe/client.py: remove "from app.core.config import settings"
#   (pass verify_ssl as parameter instead)
# Update payment/router.py: from stripe_payment.X → from app.payment.stripe.X
# Update payment/exception_handlers.py: same
# Update main.py:
#   - Remove sys.path.insert lines
#   - Change import: from stripe_payment.client → from app.payment.stripe.client
#   - Change call: init_stripe(settings.STRIPE_SECRET_KEY, verify_ssl=settings.STRIPE_VERIFY_SSL)
# Delete backend/stripe_payment/
```

**Step 2 — Publish payment module interface**
```python
# backend/app/payment/__init__.py
from .router import router
from .exception_handlers import EXCEPTION_HANDLERS
from . import stripe as stripe_client
```

**Step 3 — Copy to new repo**
Copy: `payment/` (includes `stripe/` subdir), `core/config.py` (for Stripe settings)

**Step 4 — Wire in new project**
```python
from app.payment import router as payment_router, EXCEPTION_HANDLERS
app.include_router(payment_router, prefix="/api/v1")
for exc, handler in EXCEPTION_HANDLERS.items():
    app.add_exception_handler(exc, handler)
```

---

## Frontend auth-ui.js (reusable)

The login modal lives in `frontend/js/auth-ui.js`. It has zero HTML dependencies — 
injects its own CSS and builds the DOM dynamically. To reuse in another project:

```javascript
// Copy auth.js + auth-ui.js to the new project
import { showLoginModal, hideLoginModal, onLoginSuccess } from './auth-ui.js';

// Listen for successful login:
document.addEventListener('auth:login', (e) => {
  const user = e.detail.user;
  // update your UI here
});

// Trigger login:
showLoginModal();
```

## Render deployment

- Service: `myapp-backend` (web)
- Root dir: `backend`
- Build: `pip install -r requirements.txt`
- Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Frontend: served as static files from `uvicorn` via `app.mount("/")`
- DB: set `DATABASE_URL` env var to PostgreSQL URL on Render
