import json
import random
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.auth.dependencies import get_current_user
from app.models.user import User
from app.jlpt.models import Question, JlptQuizSession, JlptQuizAnswer
from app.jlpt.schemas import (
    GuestQuizStartResponse,
    QuestionForQuiz,
    QuizAnswerSubmit,
    QuizResult,
    QuizResultItem,
    QuizSessionCreate,
    QuizSessionOut,
    QuizStartResponse,
)

router = APIRouter(tags=["jlpt-quiz"])

JLPT_STRUCTURE: dict[str, dict] = {
    "N5": {"vocabulary": 25, "grammar": 16, "reading": 9,  "listening": 12, "minutes": 105},
    "N4": {"vocabulary": 25, "grammar": 16, "reading": 12, "listening": 14, "minutes": 115},
    "N3": {"vocabulary": 25, "grammar": 24, "reading": 19, "listening": 22, "minutes": 140},
    "N2": {"vocabulary": 28, "grammar": 12, "reading": 32, "listening": 29, "minutes": 155},
    "N1": {"vocabulary": 25, "grammar": 10, "reading": 34, "listening": 29, "minutes": 170},
}


def _shuffle_options(question: Question) -> tuple[dict[str, str], str]:
    pairs: list[tuple[str, str]] = [
        ("A", question.option_a),
        ("B", question.option_b),
        ("C", question.option_c),
        ("D", question.option_d),
    ]
    correct_text: str = dict(pairs)[question.correct_answer]
    random.shuffle(pairs)
    new_labels = ["A", "B", "C", "D"]
    shuffled: dict[str, str] = {}
    new_correct: Optional[str] = None
    for new_label, (_, text) in zip(new_labels, pairs):
        shuffled[new_label] = text
        if text == correct_text:
            new_correct = new_label
    assert new_correct is not None
    return shuffled, new_correct


def _build_question_for_quiz(question: Question, shuffled_options: dict[str, str]) -> QuestionForQuiz:
    return QuestionForQuiz(
        id=question.id,
        level=question.level,
        question_type=question.question_type,
        passage=question.passage,
        question_text=question.question_text,
        options=shuffled_options,
        audio_url=question.audio_url,
    )


def _get_session_or_404(session_id: int, db: Session) -> JlptQuizSession:
    session = db.get(JlptQuizSession, session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Quiz session {session_id} not found.")
    return session


def _build_result(session: JlptQuizSession, db: Session) -> QuizResult:
    answer_rows = db.query(JlptQuizAnswer).filter(JlptQuizAnswer.session_id == session.id).all()
    result_items: list[QuizResultItem] = []
    total_time = 0.0
    answered_count = 0

    for ar in answer_rows:
        question = db.get(Question, ar.question_id)
        if ar.time_taken is not None:
            total_time += ar.time_taken
            answered_count += 1
        result_items.append(QuizResultItem(
            question_id=ar.question_id,
            question_text=question.question_text if question else "",
            user_answer=ar.user_answer,
            correct_answer=ar.shuffled_correct or "",
            is_correct=ar.is_correct,
            explanation=question.explanation if question else None,
        ))

    avg_time = round(total_time / answered_count, 2) if answered_count else 0.0
    time_summary = {
        "total_seconds": round(total_time, 2),
        "average_seconds_per_question": avg_time,
        "answered_count": answered_count,
    }
    total = session.total_questions or 0
    correct = session.correct_count or 0
    score = session.score if session.score is not None else (round(correct / total * 100, 2) if total else 0.0)

    return QuizResult(
        session_id=session.id,
        level=session.level,
        question_type=session.question_type,
        score=score,
        correct_count=correct,
        total_questions=total,
        time_summary=time_summary,
        answers=result_items,
    )


@router.get("/history", response_model=list[QuizSessionOut])
def quiz_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(JlptQuizSession)
        .filter(JlptQuizSession.user_id == current_user.id)
        .order_by(JlptQuizSession.started_at.desc())
        .limit(20)
        .all()
    )


@router.post("/guest-start", response_model=GuestQuizStartResponse, status_code=status.HTTP_200_OK)
def start_guest_quiz(
    payload: QuizSessionCreate,
    db: Session = Depends(get_db),
):
    """Public quiz — no auth required. Correct answers are returned so the client can score locally."""
    TYPE_ORDER = {"vocabulary": 0, "grammar": 1, "reading": 2, "listening": 3}
    total_minutes: Optional[int] = None

    if payload.level in JLPT_STRUCTURE:
        structure = JLPT_STRUCTURE[payload.level]
        if payload.full_exam:
            total_minutes = structure["minutes"]
        selected: list[Question] = []
        for qtype, count in structure.items():
            if qtype == "minutes":
                continue
            if payload.question_type and qtype != payload.question_type:
                continue
            pool = (
                db.query(Question)
                .filter(Question.level == payload.level, Question.question_type == qtype, Question.is_active == True)
                .all()
            )
            if not pool:
                continue
            selected.extend(random.sample(pool, min(count, len(pool))))
        if not selected:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No questions found.")
        selected = sorted(selected, key=lambda q: TYPE_ORDER.get(q.question_type, 9))
    else:
        query = db.query(Question).filter(Question.level == payload.level, Question.is_active == True)
        if payload.question_type:
            query = query.filter(Question.question_type == payload.question_type)
        all_matching = query.all()
        if not all_matching:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No questions found.")
        selected = sorted(random.sample(all_matching, len(all_matching)), key=lambda q: TYPE_ORDER.get(q.question_type, 9))

    quiz_questions: list[QuestionForQuiz] = []
    correct_map: dict[int, str] = {}
    for question in selected:
        shuffled_opts, new_correct = _shuffle_options(question)
        quiz_questions.append(_build_question_for_quiz(question, shuffled_opts))
        correct_map[question.id] = new_correct

    return GuestQuizStartResponse(
        guest_token=str(uuid.uuid4()),
        questions=quiz_questions,
        total_minutes=total_minutes,
        correct_map=correct_map,
    )


@router.post("/start", response_model=QuizStartResponse, status_code=status.HTTP_201_CREATED)
def start_quiz(
    payload: QuizSessionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    TYPE_ORDER = {"vocabulary": 0, "grammar": 1, "reading": 2, "listening": 3}
    total_minutes: Optional[int] = None

    # Both practice and full-exam use JLPT structure counts.
    # Full-exam additionally sets total_minutes for the timer.
    if payload.level in JLPT_STRUCTURE:
        structure = JLPT_STRUCTURE[payload.level]
        if payload.full_exam:
            total_minutes = structure["minutes"]
        selected: list[Question] = []
        for qtype, count in structure.items():
            if qtype == "minutes":
                continue
            if payload.question_type and qtype != payload.question_type:
                continue
            pool = (
                db.query(Question)
                .filter(Question.level == payload.level, Question.question_type == qtype, Question.is_active == True)
                .all()
            )
            if not pool:
                continue
            selected.extend(random.sample(pool, min(count, len(pool))))
        if not selected:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No questions found.")
        selected = sorted(selected, key=lambda q: TYPE_ORDER.get(q.question_type, 9))
        num = len(selected)
    else:
        query = db.query(Question).filter(Question.level == payload.level, Question.is_active == True)
        if payload.question_type:
            query = query.filter(Question.question_type == payload.question_type)
        all_matching = query.all()
        if not all_matching:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No questions found.")
        num = len(all_matching)
        selected = sorted(random.sample(all_matching, num), key=lambda q: TYPE_ORDER.get(q.question_type, 9))

    session = JlptQuizSession(
        user_id=current_user.id,
        level=payload.level,
        question_type=payload.question_type,
        num_questions=num,
        total_questions=num,
        correct_count=0,
        session_questions=json.dumps([q.id for q in selected]),
    )
    db.add(session)
    db.flush()

    quiz_questions: list[QuestionForQuiz] = []
    for question in selected:
        shuffled_opts, new_correct = _shuffle_options(question)
        db.add(JlptQuizAnswer(
            session_id=session.id,
            question_id=question.id,
            user_answer=None,
            is_correct=None,
            shuffled_correct=new_correct,
        ))
        quiz_questions.append(_build_question_for_quiz(question, shuffled_opts))

    db.commit()
    return QuizStartResponse(session_id=session.id, questions=quiz_questions, total_minutes=total_minutes)


@router.post("/{session_id}/answer")
def submit_answer(
    session_id: int,
    payload: QuizAnswerSubmit,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = _get_session_or_404(session_id, db)
    if session.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your session.")
    if session.completed_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session already completed.")

    answer_row = (
        db.query(JlptQuizAnswer)
        .filter(JlptQuizAnswer.session_id == session_id, JlptQuizAnswer.question_id == payload.question_id)
        .first()
    )
    if not answer_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not in this session.")
    if answer_row.user_answer is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Already answered.")

    submitted = payload.user_answer.upper()
    is_correct = submitted == (answer_row.shuffled_correct or "").upper()
    answer_row.user_answer = submitted
    answer_row.is_correct = is_correct
    answer_row.time_taken = payload.time_taken
    answer_row.answered_at = datetime.utcnow()
    if is_correct:
        session.correct_count = (session.correct_count or 0) + 1
    db.commit()

    question = db.get(Question, payload.question_id)
    return {
        "is_correct": is_correct,
        "correct_answer": answer_row.shuffled_correct,
        "explanation": question.explanation if question else None,
    }


@router.post("/{session_id}/complete", response_model=QuizResult)
def complete_quiz(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = _get_session_or_404(session_id, db)
    if session.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your session.")
    if session.completed_at is None:
        total = session.total_questions or 1
        session.score = round((session.correct_count or 0) / total * 100, 2)
        session.completed_at = datetime.utcnow()
        db.commit()
    return _build_result(session, db)


@router.get("/{session_id}/result", response_model=QuizResult)
def get_result(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = _get_session_or_404(session_id, db)
    if session.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your session.")
    if session.completed_at is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session not completed yet.")
    return _build_result(session, db)
