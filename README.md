# MyApp

Ứng dụng web full-stack tích hợp xác thực người dùng, thanh toán Stripe và quản lý hàng tồn kho.

## Kiến trúc

```
myapp/
├── backend/          # FastAPI
│   ├── app/
│   │   ├── auth/         # Đăng ký, đăng nhập, JWT
│   │   ├── payment/      # Tích hợp Stripe
│   │   ├── inventory/    # Quản lý kho (đang phát triển)
│   │   ├── models/       # SQLAlchemy models
│   │   └── core/         # Config, security
│   └── stripe_payment/   # Stripe SDK wrapper
└── frontend/         # HTML/JS thuần
    ├── index.html        # Trang đăng nhập / đăng ký
    ├── dashboard.html    # Trang chính sau khi đăng nhập
    ├── payment.html      # Thanh toán qua Stripe
    ├── inventory.html    # Quản lý kho
    └── js/app.js         # Auth module, navbar, API helper
```

## Tính năng

### Xác thực
- Đăng ký / đăng nhập bằng username + password
- JWT Access Token (30 phút) + Refresh Token (7 ngày)
- Mã hoá mật khẩu bằng bcrypt
- Tự động refresh token phía frontend

### Thanh toán (Stripe)
- Tạo Payment Intent và xác nhận thanh toán
- Quản lý Customer và Payment Method
- Hoàn tiền (refund)
- Webhook nhận sự kiện từ Stripe

### Inventory
- API endpoint bảo vệ bằng JWT (đang phát triển)

## Cài đặt & Chạy

### Yêu cầu
- Python 3.10+

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Server chạy tại `http://localhost:8000`.  
Frontend được serve tự động tại cùng địa chỉ.

### Cấu hình `.env`

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

## API

Tài liệu tự động: `http://localhost:8000/api/docs`

### Auth — `/api/v1/auth`

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| POST | `/register` | Đăng ký tài khoản |
| POST | `/login` | Đăng nhập, nhận JWT |
| POST | `/refresh` | Làm mới access token |
| GET | `/me` | Thông tin user hiện tại |
| POST | `/logout` | Đăng xuất |

### Payment — `/api/v1/payment`

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| POST | `/create-payment-intent` | Tạo payment intent (yêu cầu đăng nhập) |
| POST | `/customers` | Tạo customer |
| GET | `/customers/{id}` | Lấy thông tin customer |
| DELETE | `/customers/{id}` | Xoá customer |
| POST | `/customers/{id}/payment-methods` | Gắn thẻ vào customer |
| POST | `/intents` | Tạo payment intent |
| GET | `/intents/{id}` | Lấy trạng thái payment |
| POST | `/intents/{id}/confirm` | Xác nhận thanh toán |
| POST | `/intents/{id}/cancel` | Huỷ thanh toán |
| POST | `/charge` | Charge trực tiếp customer |
| POST | `/refunds` | Hoàn tiền |
| POST | `/webhooks/stripe` | Nhận webhook từ Stripe |

### Inventory — `/api/v1/inventory`

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/` | Danh sách hàng tồn kho |
| GET | `/stats` | Thống kê tổng quan |

## Test thanh toán

Dùng thẻ test của Stripe:

| Thẻ | Số thẻ |
|-----|--------|
| Thành công | `4242 4242 4242 4242` |
| Bị từ chối | `4000 0000 0000 0002` |
| Yêu cầu xác thực 3D | `4000 0025 0000 3155` |

Ngày hết hạn: bất kỳ ngày trong tương lai. CVC: bất kỳ 3 số.

## Health Check

```
GET /api/health
→ {"status": "ok", "app": "MyApp"}
```
