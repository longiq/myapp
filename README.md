# MyApp — Luyện thi JLPT

Ứng dụng web học tiếng Nhật theo format JLPT (N5–N1), tích hợp xác thực JWT và thanh toán Stripe.

## Tính năng chính

### 🎌 Luyện tập JLPT (trang chủ `/`)
- Truy cập ngay không cần đăng nhập (chế độ khách)
- Luyện tập nhanh hoặc thi thử đầy đủ theo cấu trúc JLPT thực tế
- 4 loại câu hỏi: từ vựng, ngữ pháp, đọc hiểu, nghe hiểu (TTS tự động)
- Cấp độ N5 → N1

### 🔒 Tính năng sau khi đăng nhập
- Lưu lịch sử làm bài và xem lại kết quả
- Tiến độ học được theo dõi theo session

### 💳 Thanh toán (Stripe)
- Tạo Payment Intent, xác nhận thanh toán
- Quản lý Customer, hoàn tiền, webhook

## Kiến trúc

```
myapp/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI entry, startup DB migration + seeding
│   │   ├── database.py      # SQLAlchemy engine + session
│   │   ├── core/            # Config (Pydantic BaseSettings), JWT security
│   │   ├── models/          # User model
│   │   ├── auth/            # JWT auth (register, login, refresh, me, logout)
│   │   ├── payment/         # Stripe payment module
│   │   ├── admin/           # Admin API (superuser only)
│   │   └── jlpt/            # JLPT learning module (main feature)
│   └── stripe_payment/      # Stripe SDK wrapper
└── frontend/
    ├── index.html           # Landing page (JLPT app, no auth needed)
    ├── login.html           # Standalone login/register page
    ├── dashboard.html       # Admin hub (superuser only)
    ├── payment.html         # Stripe payment
    ├── css/jlpt.css
    └── js/
        ├── auth.js          # Token management + API calls
        ├── auth-ui.js       # Login modal component (reusable)
        ├── app.js           # requireAuth, renderNavbar, renderUserIcon
        └── jlpt.js          # Quiz logic
```

## Cài đặt & Chạy

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env   # điền SECRET_KEY, STRIPE_* keys, ADMIN_USERNAME
uvicorn app.main:app --reload
# App:      http://localhost:8000
# API docs: http://localhost:8000/api/docs
```

### Biến môi trường (`.env`)

```env
APP_NAME=MyApp
SECRET_KEY=your-secret-key-minimum-32-chars
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7
DATABASE_URL=sqlite:///./myapp.db
CORS_ORIGINS=["*"]
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_VERIFY_SSL=true
ADMIN_USERNAME=<tên_tài_khoản_admin>
```

`ADMIN_USERNAME`: mỗi lần startup, hệ thống tự cấp `is_superuser=True` cho tài khoản này.

## API

### Auth — `/api/v1/auth`

| Method | Endpoint | Auth | Mô tả |
|--------|----------|------|-------|
| POST | `/register` | - | Đăng ký tài khoản |
| POST | `/login` | - | Đăng nhập, nhận JWT |
| POST | `/refresh` | - | Làm mới access token |
| GET | `/me` | ✓ | Thông tin user hiện tại |
| POST | `/logout` | ✓ | Đăng xuất |

### JLPT — `/api/v1/jlpt`

| Method | Endpoint | Auth | Mô tả |
|--------|----------|------|-------|
| GET | `/questions/stats/summary` | - | Thống kê câu hỏi theo cấp/loại |
| GET | `/questions/` | - | Danh sách câu hỏi |
| POST | `/quiz/guest-start` | - | Bắt đầu quiz không cần đăng nhập |
| POST | `/quiz/start` | ✓ | Bắt đầu quiz (lưu lịch sử) |
| POST | `/quiz/{id}/answer` | ✓ | Nộp câu trả lời |
| POST | `/quiz/{id}/complete` | ✓ | Hoàn thành bài thi |
| GET | `/quiz/{id}/result` | ✓ | Xem kết quả |
| GET | `/quiz/history` | ✓ | Lịch sử làm bài |
| POST | `/audio-api/generate` | - | Tạo audio TTS cho câu nghe |
| POST | `/crawler/seed` | - | Nạp dữ liệu mẫu |

### Payment — `/api/v1/payment`

| Method | Endpoint | Auth | Mô tả |
|--------|----------|------|-------|
| POST | `/create-payment-intent` | ✓ | Tạo payment intent |
| POST | `/customers` | - | Tạo customer |
| GET | `/customers/{id}` | - | Lấy thông tin customer |
| DELETE | `/customers/{id}` | - | Xoá customer |
| POST | `/intents/{id}/confirm` | - | Xác nhận thanh toán |
| POST | `/refunds` | - | Hoàn tiền |
| POST | `/webhooks/stripe` | - | Nhận webhook từ Stripe |

## Test thanh toán

| Thẻ | Số thẻ |
|-----|--------|
| Thành công | `4242 4242 4242 4242` |
| Bị từ chối | `4000 0000 0000 0002` |
| Yêu cầu 3D Secure | `4000 0025 0000 3155` |

Ngày hết hạn: bất kỳ ngày trong tương lai. CVC: bất kỳ 3 số.

## Health Check

```
GET /api/health
→ {"status": "ok", "app": "MyApp"}
```

## Tách module (tương lai)

Xem `CLAUDE.md` để biết hướng dẫn tách module `auth` và `payment` sang repo khác.
