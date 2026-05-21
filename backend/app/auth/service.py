from typing import Optional
from sqlalchemy.orm import Session
from app.models.user import User
from app.core.security import hash_password, verify_password
from app.auth.schemas import UserRegister


def get_user_by_username(db: Session, username: str) -> Optional[User]:
    return db.query(User).filter(User.username == username).first()


def get_user_by_email(db: Session, email: str) -> Optional[User]:
    return db.query(User).filter(User.email == email).first()


def get_user_by_id(db: Session, user_id: int) -> Optional[User]:
    return db.query(User).filter(User.id == user_id).first()


def create_user(db: Session, data: UserRegister) -> User:
    user = User(
        username=data.username,
        email=data.email,
        hashed_password=hash_password(data.password),
        full_name=data.full_name,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def authenticate_user(db: Session, username: str, password: str) -> Optional[User]:
    user = get_user_by_username(db, username)
    if not user or not verify_password(password, user.hashed_password):
        return None
    return user


def update_user(db: Session, user_id: int, **fields) -> Optional[User]:
    user = get_user_by_id(db, user_id)
    if not user:
        return None
    for k, v in fields.items():
        setattr(user, k, v)
    db.commit()
    db.refresh(user)
    return user


def list_users(db: Session, skip: int = 0, limit: int = 100) -> list[User]:
    return db.query(User).order_by(User.id).offset(skip).limit(limit).all()
