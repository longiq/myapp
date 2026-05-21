# MyApp — Luyện thi JLPT

Ứng dụng web học tiếng Nhật theo format JLPT (N5–N1), tích hợp xác thực JWT và thanh toán Stripe.

## Tính năng chính

### 🎌 JLPT Learning (trang chủ)
- Truy cập ngay không cần đăng nhập (chế độ khách)
- Luyện tập nhanh hoặc thi thử đầy đủ theo cấu trúc JLPT thực tế
- 4 loại câu hỏi: từ vựng, ngữ pháp, đọc hiểu, nghe hiểu (TTS tự động)
- Cấp độ N5 → N1
- Icon người góc phải: click để đăng nhập / xem thông tin tài khoản

### 🔒 Tính năng sau khi đăng nhập
- Lưu lịch sử làm bài và xem lại kết quả
- Tiến độ học được theo dõi theo session
- Truy cập trang quản trị (admin)
- Thanh toán Stripe

### 💳 Thanh toán (Stripe)
- Tạo Payment Intent, xác nhận thanh toán
- Quản lý Customer và Payment Method
- Hoàn tiền (refund), webhook xử lý sự kiện

## Kiến trúc

```
myapp/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI app entry
│   │   ├── database.py      # SQLAlchemy engine + session
│   │   ├── core/            # Config, JWT security
│   │   ├── models/          # User model
│   │   ├── auth/            # JWT auth module (register, login, refresh)
│   │   ├── payment/         # Stripe payment module
│   │   └── jlpt/            # JLPT learning module (main feature)
│   │       ├── models.py    # Question, QuizSession, QuizAnswer
│   │       └── routers/     # questions, quiz (guest+auth), audio, crawler
│   └── stripe_payment/      # Stripe SDK wrapper
└── frontend/
    ├── jlpt.html            # Landing page (JLPT app, no auth needed)
    ├── index.html           # Login/register page
    ├── dashboard.html       # User hub
    ├── payment.html         # Stripe payment
    └── js/
        ├── auth.js          # Token management + API calls
        ├── auth-ui.js       # Login modal component (reusable)
        ├── app.js           # requireAuth, renderNavbar, renderUserIcon
        └── jlpt.js          # Quiz logic (guest + auth modes)
```

## Cài đặt & Chạy

### Yêu cầu
- Python 3.10+

### Backend

```bash
cd backend
pip install -r requirements.txt
```

Tạo file `backend/.env`:

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
```

```bash
uvicorn app.main:app --reload
```

Server + Frontend chạy tại `http://localhost:8000`.
API docs: `http://localhost:8000/api/docs`

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
| POST | `/audio-api/generate` | - | Tạo audio TTS cho câu hỏi nghe |
| POST | `/crawler/seed` | - | Nạp dữ liệu mẫu (admin) |

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
