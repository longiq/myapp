import sys
from contextlib import asynccontextmanager
from pathlib import Path

# Ensure backend/ is on sys.path so stripe_payment is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.database import Base, engine
from app.auth.router import router as auth_router
from app.payment.router import router as payment_router
from app.payment.exception_handlers import EXCEPTION_HANDLERS
from app.jlpt.routers.questions import router as jlpt_questions_router
from app.jlpt.routers.quiz import router as jlpt_quiz_router
from app.jlpt.routers.crawler import router as jlpt_crawler_router
from app.jlpt.routers.audio import router as jlpt_audio_router
from stripe_payment.client import init_stripe

load_dotenv()

FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    import app.jlpt.models  # noqa: F401 — register JLPT tables with Base
    Base.metadata.create_all(bind=engine)
    if settings.STRIPE_SECRET_KEY:
        init_stripe(settings.STRIPE_SECRET_KEY)
    _auto_seed()
    yield


def _auto_seed() -> None:
    from app.database import SessionLocal
    from app.jlpt.models import Question
    try:
        from crawler.seed_data import get_seed_questions
    except ImportError:
        return
    db = SessionLocal()
    try:
        if db.query(Question).count() == 0:
            questions = get_seed_questions()
            for q in questions:
                db.add(Question(**q))
            db.commit()
            print(f"[startup] Auto-seeded {len(questions)} JLPT questions.")
    except Exception as exc:
        print(f"[startup] Auto-seed failed: {exc}")
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

app.include_router(auth_router,           prefix="/api/v1")
app.include_router(jlpt_questions_router, prefix="/api/v1/jlpt/questions")
app.include_router(jlpt_quiz_router,      prefix="/api/v1/jlpt/quiz")
app.include_router(jlpt_crawler_router,   prefix="/api/v1/jlpt/crawler")
app.include_router(jlpt_audio_router,     prefix="/api/v1/jlpt/audio-api")
app.include_router(payment_router,        prefix="/api/v1")


@app.get("/api/health")
def health():
    return {"status": "ok", "app": settings.APP_NAME}


# Serve JLPT static media (audio / images) — must be before the root frontend mount
_STATIC_ROOT = Path(__file__).resolve().parent.parent.parent / "static"
for _subdir, _mount_path in [("audio", "/audio"), ("images", "/images")]:
    _media_dir = _STATIC_ROOT / _subdir
    _media_dir.mkdir(parents=True, exist_ok=True)
    app.mount(_mount_path, StaticFiles(directory=str(_media_dir)), name=_subdir)

# Serve frontend — must be mounted last
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
