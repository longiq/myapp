import json
import os
import shutil
import zipfile
from io import BytesIO
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_superuser
from app.auth.service import list_users, update_user
from app.database import get_db
from app.jlpt.models import JlptExamSet, Question
from app.models.user import User

router = APIRouter(prefix="/admin", tags=["admin"])

STATIC_ROOT = Path(__file__).resolve().parent.parent.parent.parent / "static"


# ── Schemas ────────────────────────────────────────────────────────────────


class UserAdminOut(BaseModel):
    id: int
    username: str
    email: str
    full_name: Optional[str] = None
    is_active: bool
    is_superuser: bool
    has_jlpt_exam_access: bool

    model_config = {"from_attributes": True}


class JlptAccessPatch(BaseModel):
    grant: bool


class ExamSetCreate(BaseModel):
    name: str
    year: int
    session: Optional[str] = None
    level: str
    description: Optional[str] = None


class ExamSetOut(BaseModel):
    id: int
    name: str
    year: int
    session: Optional[str] = None
    level: str
    description: Optional[str] = None
    is_active: bool
    question_count: int = 0

    model_config = {"from_attributes": True}


# ── User management ────────────────────────────────────────────────────────


@router.get("/users", response_model=List[UserAdminOut])
def get_users(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_superuser),
):
    return list_users(db, skip=skip, limit=limit)


@router.patch("/users/{user_id}/jlpt-access", response_model=UserAdminOut)
def set_jlpt_access(
    user_id: int,
    body: JlptAccessPatch,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_superuser),
):
    user = update_user(db, user_id, has_jlpt_exam_access=body.grant)
    if not user:
        raise HTTPException(404, "Không tìm thấy người dùng.")
    return user


# ── Exam set management ────────────────────────────────────────────────────


@router.get("/exam-sets", response_model=List[ExamSetOut])
def get_exam_sets(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_superuser),
):
    sets = db.query(JlptExamSet).order_by(JlptExamSet.year.desc(), JlptExamSet.level).all()
    result = []
    for s in sets:
        count = db.query(Question).filter(Question.exam_set_id == s.id).count()
        result.append(ExamSetOut(
            id=s.id, name=s.name, year=s.year, session=s.session,
            level=s.level, description=s.description, is_active=s.is_active,
            question_count=count,
        ))
    return result


@router.post("/exam-sets", response_model=ExamSetOut)
def create_exam_set(
    body: ExamSetCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_superuser),
):
    exam_set = JlptExamSet(**body.model_dump())
    db.add(exam_set)
    db.commit()
    db.refresh(exam_set)
    return ExamSetOut(**{**body.model_dump(), "id": exam_set.id, "is_active": exam_set.is_active, "question_count": 0})


@router.patch("/exam-sets/{exam_set_id}", response_model=ExamSetOut)
def update_exam_set(
    exam_set_id: int,
    body: ExamSetCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_superuser),
):
    exam_set = db.query(JlptExamSet).filter(JlptExamSet.id == exam_set_id).first()
    if not exam_set:
        raise HTTPException(404, "Không tìm thấy bộ đề.")
    for k, v in body.model_dump().items():
        setattr(exam_set, k, v)
    db.commit()
    db.refresh(exam_set)
    count = db.query(Question).filter(Question.exam_set_id == exam_set_id).count()
    return ExamSetOut(
        id=exam_set.id, name=exam_set.name, year=exam_set.year, session=exam_set.session,
        level=exam_set.level, description=exam_set.description, is_active=exam_set.is_active,
        question_count=count,
    )


@router.post("/exam-sets/{exam_set_id}/import")
async def import_questions(
    exam_set_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_superuser),
):
    """Import câu hỏi từ JSON file vào bộ đề.

    JSON format:
    {
      "questions": [
        {
          "question_type": "vocabulary",
          "question_text": "...",
          "option_a": "...", "option_b": "...", "option_c": "...", "option_d": "...",
          "correct_answer": "A",
          "explanation": "...",
          "passage": "",
          "image_file": "images/q001.jpg",   // optional, relative path in zip
          "audio_file": "audio/q001.mp3"     // optional, relative path in zip
        }
      ]
    }
    """
    exam_set = db.query(JlptExamSet).filter(JlptExamSet.id == exam_set_id).first()
    if not exam_set:
        raise HTTPException(404, "Không tìm thấy bộ đề.")

    content = await file.read()
    if not content:
        raise HTTPException(400, "File rỗng.")

    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"JSON không hợp lệ: {e}")

    questions_data = data.get("questions", [])
    if not questions_data:
        raise HTTPException(400, "Không có câu hỏi trong file.")

    added = 0
    skipped = 0
    for q in questions_data:
        required = {"question_type", "question_text", "option_a", "option_b", "option_c", "option_d", "correct_answer"}
        if not required.issubset(q.keys()):
            skipped += 1
            continue

        exists = (
            db.query(Question)
            .filter(
                Question.exam_set_id == exam_set_id,
                Question.question_text == q["question_text"],
            )
            .first()
        )
        if exists:
            skipped += 1
            continue

        question = Question(
            level=exam_set.level,
            question_type=q["question_type"],
            question_text=q["question_text"],
            option_a=q["option_a"],
            option_b=q["option_b"],
            option_c=q["option_c"],
            option_d=q["option_d"],
            correct_answer=q["correct_answer"],
            explanation=q.get("explanation", ""),
            passage=q.get("passage", ""),
            source_url=q.get("source_url", ""),
            image_url=q.get("image_url", ""),
            audio_url=q.get("audio_url", ""),
            is_active=True,
            exam_set_id=exam_set_id,
        )
        db.add(question)
        added += 1

    db.commit()
    return {"added": added, "skipped": skipped, "exam_set_id": exam_set_id}


@router.post("/exam-sets/{exam_set_id}/upload-media")
async def upload_media(
    exam_set_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_superuser),
):
    """Upload zip file chứa images/ và audio/ cho bộ đề.
    Files được giải nén vào static/exam-sets/{exam_set_id}/
    và URL tự động cập nhật theo pattern /exam-sets/{id}/images/... và /audio/...
    """
    exam_set = db.query(JlptExamSet).filter(JlptExamSet.id == exam_set_id).first()
    if not exam_set:
        raise HTTPException(404, "Không tìm thấy bộ đề.")

    if not file.filename or not file.filename.endswith(".zip"):
        raise HTTPException(400, "Chỉ chấp nhận file .zip.")

    content = await file.read()
    dest_dir = STATIC_ROOT / "exam-sets" / str(exam_set_id)
    dest_dir.mkdir(parents=True, exist_ok=True)

    extracted = 0
    try:
        with zipfile.ZipFile(BytesIO(content)) as zf:
            for name in zf.namelist():
                if name.endswith("/"):
                    continue
                target = dest_dir / name
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(name) as src, open(target, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                extracted += 1
    except zipfile.BadZipFile:
        raise HTTPException(400, "File zip không hợp lệ.")

    return {
        "extracted": extracted,
        "base_url": f"/exam-sets/{exam_set_id}/",
        "exam_set_id": exam_set_id,
    }
