from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from app.database import get_db
from app.core.security import decode_token
from app.auth.service import get_user_by_id
from app.models.user import User

bearer_scheme = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    payload = decode_token(credentials.credentials)
    if not payload or payload.get("type") != "access":
        raise HTTPException(401, "Token không hợp lệ hoặc đã hết hạn")
    user = get_user_by_id(db, int(payload["sub"]))
    if not user:
        raise HTTPException(401, "Người dùng không tồn tại")
    if not user.is_active:
        raise HTTPException(403, "Tài khoản đã bị vô hiệu hóa")
    return user


def get_current_superuser(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_superuser:
        raise HTTPException(403, "Không đủ quyền truy cập")
    return current_user
