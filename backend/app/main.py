import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

# Ensure backend/ is on sys.path so stripe_payment is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.admin.router import router as admin_router
from app.auth.router import router as auth_router
from app.core.config import settings
from app.database import Base, engine
from app.jlpt.routers.audio import router as jlpt_audio_router
from app.jlpt.routers.crawler import router as jlpt_crawler_router
from app.jlpt.routers.questions import router as jlpt_questions_router
from app.jlpt.routers.quiz import router as jlpt_quiz_router
from app.payment.exception_handlers import EXCEPTION_HANDLERS
from app.payment.router import router as payment_router
from stripe_payment.client import init_stripe

load_dotenv()

FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    import app.jlpt.models  # noqa: F401 — register JLPT tables with Base

    Base.metadata.create_all(bind=engine)
    _run_migrations()
    if settings.STRIPE_SECRET_KEY:
        init_stripe(settings.STRIPE_SECRET_KEY)
    _startup_db_fixes()
    yield


def _run_migrations() -> None:
    """Add missing columns to existing tables (safe to run on every startup)."""
    from sqlalchemy import inspect, text

    from app.database import SessionLocal

    db = SessionLocal()
    try:
        insp = inspect(engine)

        # users.has_jlpt_exam_access
        if "users" in insp.get_table_names():
            user_cols = {c["name"] for c in insp.get_columns("users")}
            if "has_jlpt_exam_access" not in user_cols:
                db.execute(
                    text(
                        "ALTER TABLE users ADD COLUMN has_jlpt_exam_access BOOLEAN NOT NULL DEFAULT FALSE"
                    )
                )
                db.commit()
                print("[migration] Added has_jlpt_exam_access to users.")

        # jlpt_questions.exam_set_id
        if "jlpt_questions" in insp.get_table_names():
            q_cols = {c["name"] for c in insp.get_columns("jlpt_questions")}
            if "exam_set_id" not in q_cols:
                db.execute(
                    text("ALTER TABLE jlpt_questions ADD COLUMN exam_set_id INTEGER")
                )
                db.commit()
                print("[migration] Added exam_set_id to jlpt_questions.")
    except Exception as exc:
        print(f"[migration] Failed: {exc}")
        db.rollback()
    finally:
        db.close()


def _startup_db_fixes() -> None:
    """Run on every startup: fix existing records and seed any missing questions."""
    from app.database import SessionLocal
    from app.jlpt.models import Question
    from app.models.user import User

    db = SessionLocal()

    # 0. Grant superuser to the configured admin account
    try:
        admin_username = os.environ.get("ADMIN_USERNAME", "")
        if not admin_username:
            print("[startup] ADMIN_USERNAME not set — skipping admin grant.")
        else:
            admin = db.query(User).filter(User.username == admin_username).first()
            if not admin:
                print(f"[startup] Admin account '{admin_username}' not found in DB.")
            elif admin.is_superuser:
                print(f"[startup] Admin '{admin_username}' already has superuser.")
            else:
                admin.is_superuser = True
                db.commit()
                print(f"[startup] Granted superuser to admin account.")
    except Exception as exc:
        print(f"[startup] Admin grant failed: {exc}")
        db.rollback()

    # 1. Activate any listening questions seeded with is_active=False
    try:
        updated = (
            db.query(Question)
            .filter(Question.question_type == "listening", Question.is_active == False)
            .update({"is_active": True})
        )
        if updated:
            db.commit()
            print(f"[startup] Activated {updated} listening questions.")
    except Exception as exc:
        print(f"[startup] Listening activation failed: {exc}")
        db.rollback()

    # 2. Seed missing questions (duplicate-safe)
    try:
        from crawler.seed_data import get_seed_questions

        questions = get_seed_questions()
        added = 0
        for q in questions:
            exists = (
                db.query(Question)
                .filter(Question.level == q["level"], Question.question_text == q["question_text"])
                .first()
            )
            if not exists:
                db.add(Question(**q))
                added += 1
        if added:
            db.commit()
            print(f"[startup] Seeded {added} new questions.")
        else:
            print("[startup] DB up-to-date, no new questions added.")
    except ImportError:
        pass
    except Exception as exc:
        print(f"[startup] Seed failed: {exc}")
        db.rollback()

    # 3. Import official exam data from exam.zip (idempotent)
    try:
        from app.jlpt.seed_exams import seed_exam_data

        n = seed_exam_data(db)
        if n:
            print(f"[startup] Imported {n} exam questions from exam.zip.")
        else:
            print("[startup] Exam data already up-to-date.")
    except Exception as exc:
        print(f"[startup] Exam import skipped: {exc}")
        db.rollback()
    finally:
        db.close()


app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for exc_class, handler in EXCEPTION_HANDLERS.items():
    app.add_exception_handler(exc_class, handler)

app.include_router(admin_router, prefix="/api/v1")
app.include_router(auth_router, prefix="/api/v1")
app.include_router(jlpt_questions_router, prefix="/api/v1/jlpt/questions")
app.include_router(jlpt_quiz_router, prefix="/api/v1/jlpt/quiz")
app.include_router(jlpt_crawler_router, prefix="/api/v1/jlpt/crawler")
app.include_router(jlpt_audio_router, prefix="/api/v1/jlpt/audio-api")
app.include_router(payment_router, prefix="/api/v1")


@app.get("/api/health")
def health():
    return {"status": "ok", "app": settings.APP_NAME}


# Serve JLPT static media (audio / images / exam-sets) — must be before the root frontend mount
_STATIC_ROOT = Path(__file__).resolve().parent.parent.parent / "static"
for _subdir, _mount_path in [
    ("audio", "/audio"),
    ("images", "/images"),
    ("exam-sets", "/exam-sets"),
]:
    _media_dir = _STATIC_ROOT / _subdir
    _media_dir.mkdir(parents=True, exist_ok=True)
    app.mount(_mount_path, StaticFiles(directory=str(_media_dir)), name=_subdir)

# Serve frontend — must be mounted last
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
