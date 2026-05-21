from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, computed_field

# ---------------------------------------------------------------------------
# Question schemas
# ---------------------------------------------------------------------------


class QuestionBase(BaseModel):
    level: str
    question_type: str
    passage: str | None = None
    question_text: str
    option_a: str
    option_b: str
    option_c: str
    option_d: str
    correct_answer: str  # "A" | "B" | "C" | "D"
    explanation: str | None = None
    source_url: str | None = None
    audio_url: str | None = None
    image_url: str | None = None
    is_active: bool = True


class QuestionCreate(QuestionBase):
    """Schema for creating a new question — identical to QuestionBase."""

    pass


class QuestionOut(QuestionBase):
    """Full question representation returned from the API (correct_answer visible)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime

    @computed_field
    @property
    def options(self) -> dict[str, str]:
        return {
            "A": self.option_a,
            "B": self.option_b,
            "C": self.option_c,
            "D": self.option_d,
        }


class QuestionForQuiz(BaseModel):
    """Question as seen by a quiz taker — correct_answer is intentionally omitted."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    level: str
    question_type: str
    passage: str | None = None
    question_text: str
    options: dict[str, str]  # {"A": "...", "B": "...", "C": "...", "D": "..."} — already shuffled
    audio_url: str | None = None
    image_url: str | None = None


# ---------------------------------------------------------------------------
# Quiz session schemas
# ---------------------------------------------------------------------------


class QuizSessionCreate(BaseModel):
    level: str
    question_type: str | None = None  # None means all types
    num_questions: int = 10
    full_exam: bool = False  # True = use real JLPT question counts


class QuizSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    level: str
    question_type: str | None = None
    num_questions: int
    started_at: datetime
    completed_at: datetime | None = None
    score: float | None = None
    total_questions: int
    correct_count: int


# ---------------------------------------------------------------------------
# Quiz answer / result schemas
# ---------------------------------------------------------------------------


class QuizAnswerSubmit(BaseModel):
    question_id: int
    user_answer: str  # "A" | "B" | "C" | "D"
    time_taken: float | None = None


class QuizResultItem(BaseModel):
    question_id: int
    question_text: str
    user_answer: str | None
    correct_answer: str  # shuffled-correct label (what the user sees)
    is_correct: bool | None
    explanation: str | None = None


class QuizResult(BaseModel):
    session_id: int
    level: str
    question_type: str | None
    score: float  # 0 – 100
    correct_count: int
    total_questions: int
    time_summary: dict[str, Any]
    answers: list[QuizResultItem]


# ---------------------------------------------------------------------------
# Session start response
# ---------------------------------------------------------------------------


class QuizStartResponse(BaseModel):
    session_id: int
    questions: list[QuestionForQuiz]
    total_minutes: int | None = None  # set when full_exam=True


class GuestQuizStartResponse(BaseModel):
    """Response for unauthenticated guest quiz — no DB session, client scores locally."""

    guest_token: str  # UUID4, used as sessionStorage key
    questions: list[QuestionForQuiz]
    total_minutes: int | None = None
    correct_map: dict[int, str]  # {question_id: shuffled_correct_label}


# ---------------------------------------------------------------------------
# Exam set schemas
# ---------------------------------------------------------------------------


class ExamSetOut(BaseModel):
    id: int
    name: str
    year: int
    session: str | None = None
    level: str
    description: str | None = None
    question_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class ExamQuizCreate(BaseModel):
    exam_set_id: int


class ExamQuizStartResponse(BaseModel):
    session_id: int
    exam_set_id: int
    questions: list[QuestionForQuiz]
    total_minutes: int | None = None
