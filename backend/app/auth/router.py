from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.auth import schemas, service
from app.auth.dependencies import get_current_user
from app.core.security import create_access_token, create_refresh_token, decode_token
from app.core.config import settings
from app.models.user import User

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=schemas.UserResponse, status_code=201)
def register(data: schemas.UserRegister, db: Session = Depends(get_db)):
    if service.get_user_by_username(db, data.username):
        raise HTTPException(400, "Tên đăng nhập đã tồn tại")
    if service.get_user_by_email(db, data.email):
        raise HTTPException(400, "Email đã được sử dụng")
    return service.create_user(db, data)


@router.post("/login", response_model=schemas.TokenResponse)
def login(data: schemas.UserLogin, db: Session = Depends(get_db)):
    user = service.authenticate_user(db, data.username, data.password)
    if not user:
        raise HTTPException(401, "Tên đăng nhập hoặc mật khẩu không đúng")
    if not user.is_active:
        raise HTTPException(403, "Tài khoản đã bị vô hiệu hóa")
    return schemas.TokenResponse(
        access_token=create_access_token({"sub": str(user.id)}),
        refresh_token=create_refresh_token({"sub": str(user.id)}),
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/refresh", response_model=schemas.AccessTokenResponse)
def refresh(data: schemas.RefreshRequest, db: Session = Depends(get_db)):
    payload = decode_token(data.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(401, "Refresh token không hợp lệ")
    user = service.get_user_by_id(db, int(payload["sub"]))
    if not user or not user.is_active:
        raise HTTPException(403, "Tài khoản không hợp lệ")
    return schemas.AccessTokenResponse(
        access_token=create_access_token({"sub": str(user.id)}),
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.get("/me", response_model=schemas.UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/logout", response_model=schemas.MessageResponse)
def logout(current_user: User = Depends(get_current_user)):
    return schemas.MessageResponse(message="Đăng xuất thành công")
