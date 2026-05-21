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
│   │   └── jlpt/                # JLPT learning module (main app)
│   │       ├── models.py        # Question, JlptQuizSession, JlptQuizAnswer
│   │       ├── schemas.py       # Pydantic schemas incl. GuestQuizStartResponse
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
    ├── jlpt.html                # Main landing page (no auth required)
    ├── index.html               # Standalone login/register page
    ├── dashboard.html           # User hub (auth required)
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
```

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
