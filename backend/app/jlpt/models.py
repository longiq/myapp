from datetime import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey,
    Integer, String, Text,
)
from sqlalchemy.orm import relationship

from app.database import Base


class Question(Base):
    __tablename__ = "jlpt_questions"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    level = Column(String, nullable=False, index=True)
    question_type = Column(String, nullable=False, index=True)
    passage = Column(Text, nullable=True)
    question_text = Column(Text, nullable=False)
    option_a = Column(String, nullable=False)
    option_b = Column(String, nullable=False)
    option_c = Column(String, nullable=False)
    option_d = Column(String, nullable=False)
    correct_answer = Column(String, nullable=False)
    explanation = Column(Text, nullable=True)
    source_url = Column(String, nullable=True)
    audio_url = Column(String, nullable=True)
    image_url = Column(String, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False, server_default="1")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    quiz_answers = relationship("JlptQuizAnswer", back_populates="question")


class JlptQuizSession(Base):
    __tablename__ = "jlpt_quiz_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    level = Column(String, nullable=False)
    question_type = Column(String, nullable=True)
    num_questions = Column(Integer, default=10, nullable=False)
    started_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime, nullable=True)
    score = Column(Float, nullable=True)
    total_questions = Column(Integer, nullable=False)
    correct_count = Column(Integer, default=0, nullable=False)
    session_questions = Column(Text, nullable=True)

    answers = relationship(
        "JlptQuizAnswer",
        back_populates="session",
        cascade="all, delete-orphan",
    )


class JlptQuizAnswer(Base):
    __tablename__ = "jlpt_quiz_answers"

    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    session_id = Column(Integer, ForeignKey("jlpt_quiz_sessions.id"), nullable=False, index=True)
    question_id = Column(Integer, ForeignKey("jlpt_questions.id"), nullable=False, index=True)
    user_answer = Column(String, nullable=True)
    is_correct = Column(Boolean, nullable=True)
    time_taken = Column(Float, nullable=True)
    answered_at = Column(DateTime, nullable=True)
    shuffled_correct = Column(String, nullable=True)

    session = relationship("JlptQuizSession", back_populates="answers")
    question = relationship("Question", back_populates="quiz_answers")
