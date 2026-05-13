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
from app.inventory.router import router as inventory_router
from app.payment.exception_handlers import EXCEPTION_HANDLERS
from stripe_payment.client import init_stripe

load_dotenv()

FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    if settings.STRIPE_SECRET_KEY:
        init_stripe(settings.STRIPE_SECRET_KEY)
    yield


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

app.include_router(auth_router, prefix="/api/v1")
app.include_router(payment_router, prefix="/api/v1")
app.include_router(inventory_router, prefix="/api/v1")


@app.get("/api/health")
def health():
    return {"status": "ok", "app": settings.APP_NAME}


# Serve frontend — must be mounted last
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
