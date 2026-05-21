from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.jlpt.models import Question
from app.jlpt.schemas import QuestionCreate, QuestionOut

router = APIRouter(tags=["jlpt-questions"])


@router.get("/stats/summary")
def question_stats(db: Session = Depends(get_db)):
    total = db.query(func.count(Question.id)).scalar()

    LEVELS = ("N1", "N2", "N3", "N4", "N5")
    TYPES = ("vocabulary", "grammar", "reading", "listening")

    level_rows = db.query(Question.level, func.count(Question.id)).group_by(Question.level).all()
    by_level: dict[str, int] = {row[0]: row[1] for row in level_rows}
    for lvl in LEVELS:
        by_level.setdefault(lvl, 0)

    type_rows = (
        db.query(Question.question_type, func.count(Question.id))
        .group_by(Question.question_type)
        .all()
    )
    by_type: dict[str, int] = {row[0]: row[1] for row in type_rows}
    for qt in TYPES:
        by_type.setdefault(qt, 0)

    detail_rows = (
        db.query(Question.level, Question.question_type, func.count(Question.id))
        .group_by(Question.level, Question.question_type)
        .all()
    )
    by_level_type: dict[str, dict[str, int]] = {lvl: {qt: 0 for qt in TYPES} for lvl in LEVELS}
    for lvl, qt, cnt in detail_rows:
        if lvl in by_level_type and qt in by_level_type[lvl]:
            by_level_type[lvl][qt] = cnt

    return {
        "total": total,
        "by_level": by_level,
        "by_type": by_type,
        "by_level_type": by_level_type,
    }


@router.get("/", response_model=list[QuestionOut])
def list_questions(
    level: str | None = None,
    question_type: str | None = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    query = db.query(Question)
    if level:
        query = query.filter(Question.level == level)
    if question_type:
        query = query.filter(Question.question_type == question_type)
    return query.offset(skip).limit(limit).all()


@router.get("/{question_id}", response_model=QuestionOut)
def get_question(question_id: int, db: Session = Depends(get_db)):
    question = db.get(Question, question_id)
    if not question:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Question {question_id} not found."
        )
    return question


@router.post("/", response_model=QuestionOut, status_code=status.HTTP_201_CREATED)
def create_question(payload: QuestionCreate, db: Session = Depends(get_db)):
    question = Question(**payload.model_dump())
    db.add(question)
    db.commit()
    db.refresh(question)
    return question


@router.delete("/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_question(question_id: int, db: Session = Depends(get_db)):
    question = db.get(Question, question_id)
    if not question:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Question {question_id} not found."
        )
    db.delete(question)
    db.commit()
