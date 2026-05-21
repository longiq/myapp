from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.jlpt.models import Question

router = APIRouter(tags=["jlpt-crawler"])


class CrawlRequest(BaseModel):
    level: str
    question_type: str | None = None
    max_pages: int = 3
    source: str = "dethitiengnhat"


class CrawlResponse(BaseModel):
    added: int
    skipped: int
    errors: list[str] = []


class SeedResponse(BaseModel):
    added: int
    message: str


@router.post("/run", response_model=CrawlResponse)
def run_crawler(payload: CrawlRequest, db: Session = Depends(get_db)):
    try:
        if payload.source == "lophoctiengnhat":
            from crawler.lophoctiengnhat import LophoctiengnhatCrawler

            crawler = LophoctiengnhatCrawler()
        else:
            from crawler.dethitiengnhat import DethitiengnhatCrawler

            crawler = DethitiengnhatCrawler()
    except ImportError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Crawler module not available."
        )

    question_types = (
        [payload.question_type] if payload.question_type else ["vocabulary", "grammar", "reading"]
    )
    added = 0
    skipped = 0
    errors: list[str] = []

    for qtype in question_types:
        try:
            raw_questions = crawler.crawl(payload.level, qtype, max_pages=payload.max_pages)
        except Exception as e:
            errors.append(f"{qtype}: {str(e)}")
            continue
        for q in raw_questions:
            if not q.get("question_text") or not q.get("option_a"):
                skipped += 1
                continue
            exists = (
                db.query(Question)
                .filter(
                    Question.level == payload.level, Question.question_text == q["question_text"]
                )
                .first()
            )
            if exists:
                skipped += 1
                continue
            db.add(
                Question(
                    level=payload.level,
                    question_type=qtype,
                    question_text=q.get("question_text", ""),
                    passage=q.get("passage"),
                    option_a=q.get("option_a", ""),
                    option_b=q.get("option_b", ""),
                    option_c=q.get("option_c", ""),
                    option_d=q.get("option_d", ""),
                    correct_answer=q.get("correct_answer", "A"),
                    explanation=q.get("explanation"),
                    source_url=q.get("source_url"),
                    audio_url=q.get("audio_url"),
                )
            )
            added += 1

    if added:
        db.commit()
    return CrawlResponse(added=added, skipped=skipped, errors=errors)


@router.post("/seed", response_model=SeedResponse)
def load_seed_data(db: Session = Depends(get_db)):
    try:
        from crawler.seed_data import get_seed_questions
    except ImportError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Seed data module not available.",
        )

    questions = get_seed_questions()
    added = 0
    for q in questions:
        exists = (
            db.query(Question)
            .filter(Question.level == q["level"], Question.question_text == q["question_text"])
            .first()
        )
        if exists:
            continue
        db.add(Question(**q))
        added += 1

    if added:
        db.commit()
    return SeedResponse(
        added=added, message=f"Đã thêm {added} câu hỏi." if added else "Không có câu hỏi mới."
    )
