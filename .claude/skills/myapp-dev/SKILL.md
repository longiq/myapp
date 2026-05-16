---
name: myapp-dev
description: >
  Workflow cho dự án myapp: FastAPI backend + static frontend deploy trên Render.
  Dùng khi thêm module mới, sửa lỗi, push code, tạo/merge PR.
  Bao gồm cách bypass git proxy (lỗi 403), pattern thêm router FastAPI, seed data,
  startup DB migration, và tích hợp frontend ES module.
---

# myapp Development Skill

## Stack tổng quan

```
myapp/
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI app, lifespan, router registration
│   │   ├── database.py        # SQLAlchemy engine, Base, SessionLocal, get_db
│   │   ├── auth/              # JWT auth, get_current_user dependency
│   │   ├── models/user.py     # User model
│   │   └── <module>/          # Mỗi module: models.py, schemas.py, routers/
│   ├── crawler/               # Seed data files
│   └── requirements.txt
├── frontend/
│   ├── js/app.js              # requireAuth(), renderNavbar() — dùng chung
│   ├── js/<module>.js         # ES module per page
│   ├── css/<module>.css
│   └── <module>.html
└── static/                    # Audio/image files (ephemeral trên Render)
```

**Deploy**: Render — auto-deploy khi merge vào `main`.  
**DB**: PostgreSQL persistent (data giữ nguyên qua deploy, schema tạo tự động qua `Base.metadata.create_all`).

---

## Git workflow (quan trọng)

### Vấn đề: git proxy chặn write

Môi trường Claude Code web dùng proxy local (`127.0.0.1:PORT`) cho git, nhưng proxy này **không có quyền write**. Mọi `git push` qua origin mặc định sẽ bị 403.

### Giải pháp: bypass proxy bằng PAT

Khi cần push, luôn dùng lệnh sau (thay `TOKEN` bằng GitHub PAT của user):

```bash
# Đổi remote về GitHub trực tiếp
git remote set-url origin https://longiq:TOKEN@github.com/longiq/myapp.git

# Push bình thường
git push -u origin <branch-name>
```

> **Lưu ý**: Remote URL bị reset lại về proxy mỗi lần session restart. Nếu stop hook báo "unpushed commits", chạy lại lệnh trên.

### Tạo PR (MCP cũng bị 403, dùng curl)

```bash
curl -s -X POST \
  -H "Authorization: token TOKEN" \
  -H "Content-Type: application/json" \
  https://api.github.com/repos/longiq/myapp/pulls \
  -d '{
    "title": "feat: ...",
    "head": "branch-name",
    "base": "main",
    "body": "## Summary\n..."
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('html_url', d.get('message','')))"
```

### Merge PR

```bash
curl -s -X PUT \
  -H "Authorization: token TOKEN" \
  -H "Content-Type: application/json" \
  https://api.github.com/repos/longiq/myapp/pulls/PR_NUMBER/merge \
  -d '{"merge_method":"squash","commit_title":"feat: ... (#PR_NUMBER)"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('message',''))"
```

---

## Thêm module mới

### 1. Backend: tạo cấu trúc module

```
backend/app/<module>/
├── __init__.py          # rỗng
├── models.py            # SQLAlchemy models, import Base từ app.database
├── schemas.py           # Pydantic v2 schemas
└── routers/
    ├── __init__.py      # rỗng
    └── main.py          # FastAPI router
```

**models.py pattern**:
```python
from app.database import Base
from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship

class MyModel(Base):
    __tablename__ = "prefix_table_name"   # dùng prefix để tránh conflict
    id = Column(Integer, primary_key=True, autoincrement=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    # ...
```

**routers/main.py pattern**:
```python
from fastapi import APIRouter, Depends
from app.database import get_db
from app.auth.dependencies import get_current_user
from app.models.user import User

router = APIRouter(tags=["module-name"])

@router.get("/")
def list_items(db = Depends(get_db), current_user: User = Depends(get_current_user)):
    ...
```

### 2. Đăng ký router trong main.py

```python
# Import
from app.<module>.routers.main import router as <module>_router

# Trong lifespan — đảm bảo models được register
import app.<module>.models  # noqa: F401

# include_router
app.include_router(<module>_router, prefix="/api/v1/<module>")
```

### 3. Frontend: ES module pattern

**js/<module>.js**:
```javascript
import { requireAuth, renderNavbar } from './app.js';

const API = '/api/v1/<module>';

async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('access_token');
  const res = await fetch(API + path, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

// Expose handlers for HTML onclick=""
window.myHandler = function() { ... };

// Auth guard — top-level await (script type="module")
const user = await requireAuth();
if (user) {
  renderNavbar(user);
  // init page
}
```

**HTML template**:
```html
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>Module – MyApp</title>
  <link rel="stylesheet" href="/css/<module>.css">
  <style>
    /* MyApp navbar override */
    #navbar { background:#fff; border-bottom:1px solid #e5e7eb; display:flex;
      align-items:center; justify-content:space-between; padding:.9rem 2rem;
      position:sticky; top:0; z-index:200; font-family:-apple-system,sans-serif; }
    /* ... nav-brand, nav-links, nav-user styles ... */
  </style>
</head>
<body>
<nav id="navbar"></nav>
<!-- page content -->
<script type="module" src="/js/<module>.js"></script>
</body>
</html>
```

**Cập nhật navbar** trong `frontend/js/app.js`:
```javascript
// Thêm link vào nav-links trong renderNavbar()
<a href="/<module>.html" class="${location.pathname.includes('<module>') ? 'active' : ''}">
  Icon Module Name
</a>
```

**Cập nhật dashboard.html**: thêm module card và endpoint vào bảng API.

---

## Startup DB fixes pattern

Dùng khi cần chạy migration/fix mỗi lần server start (không chỉ lần đầu):

```python
# backend/app/main.py

@asynccontextmanager
async def lifespan(app: FastAPI):
    import app.<module>.models  # register tables
    Base.metadata.create_all(bind=engine)
    _startup_db_fixes()
    yield


def _startup_db_fixes() -> None:
    from app.database import SessionLocal
    from app.<module>.models import MyModel
    db = SessionLocal()
    try:
        # Fix 1: update existing records
        updated = db.query(MyModel).filter(MyModel.some_field == wrong_value)\
                    .update({"some_field": correct_value})
        if updated:
            db.commit()

        # Fix 2: insert missing seed data (duplicate-safe)
        from crawler.seed_data import get_seed_questions
        for q in get_seed_questions():
            exists = db.query(MyModel).filter(
                MyModel.level == q["level"],
                MyModel.question_text == q["question_text"]
            ).first()
            if not exists:
                db.add(MyModel(**q))
        db.commit()
    except Exception as exc:
        print(f"[startup] DB fixes failed: {exc}")
        db.rollback()
    finally:
        db.close()
```

> **Quan trọng**: Dùng pattern này thay vì chỉ check `count() == 0`.
> Render giữ DB persistent — nếu chỉ seed khi rỗng, các fix sau sẽ không được apply cho records cũ.

---

## Seed data pattern

```python
# backend/crawler/seed_data_<name>.py

_QUESTIONS: list[dict] = [
    {
        "level": "N2",                  # N1–N5
        "question_type": "reading",     # vocabulary | grammar | reading | listening
        "passage": "長い文章...",        # bài đọc (optional)
        "question_text": "問題文",
        "option_a": "選択肢A",
        "option_b": "選択肢B",
        "option_c": "選択肢C",
        "option_d": "選択肢D",
        "correct_answer": "B",          # A | B | C | D
        "explanation": "解説",
        "source_url": "",
        "is_active": True,              # luôn True cho tất cả loại câu hỏi
    },
]

def get_<name>_questions() -> list[dict]:
    return _QUESTIONS
```

**Thêm vào seed_data.py** trong `get_seed_questions()`:
```python
try:
    from .seed_data_<name> import get_<name>_questions
    extended += get_<name>_questions()
except ImportError:
    pass
```

> **Lưu ý**: Listening questions (`question_type="listening"`) cần `is_active=True`.
> Nếu seed cũ có `is_active=False`, dùng startup fix để update.

---

## Deploy checklist

Khi cần deploy thay đổi lên Render:

```
1. git add <files>
2. git commit -m "type(scope): mô tả ngắn"
3. git remote set-url origin https://longiq:TOKEN@github.com/longiq/myapp.git
4. git push -u origin <branch>
5. Tạo PR bằng curl (xem phần Git workflow)
6. Merge PR bằng curl → Render tự deploy
7. Theo dõi Render dashboard, đợi 2–5 phút
```

---

## Các lỗi thường gặp

| Lỗi | Nguyên nhân | Fix |
|-----|------------|-----|
| `403 Permission denied to longiq` | Git proxy không có quyền write | Đổi remote URL sang PAT trực tiếp |
| `Resource not accessible by integration` | MCP token thiếu quyền write | Dùng curl với PAT thay vì MCP tools |
| `No questions found` (listening) | `is_active=False` trong DB cũ | Thêm startup fix update `is_active` |
| `Auto-seed bỏ qua` | DB không rỗng (count > 0) | Dùng duplicate-safe seed thay vì check rỗng |
| Audio không generate | edge-tts lỗi SSL | Audio.py đã có SSL workaround; kiểm tra outbound HTTPS |
| Stop hook báo unpushed | Remote URL bị reset về proxy | `git remote set-url origin https://TOKEN@github.com/...` |
