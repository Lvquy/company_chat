# Inhouse Chat Suite

Monorepo cho ứng dụng chat nội bộ doanh nghiệp, hỗ trợ:

- Chat 1-1
- Chat nhóm
- Gửi ảnh, tài liệu
- Lưu lịch sử chat vào hạ tầng nội bộ
- Quản trị user, phòng ban
- Cấu hình hệ thống khi triển khai lần đầu

## Stack

- `apps/backend`: NestJS + Socket.IO + Prisma + PostgreSQL + Redis + MinIO
- `apps/admin`: Next.js admin portal
- `apps/flutter_app`: Flutter client starter cho macOS, Windows, iOS, Android

## Chạy hạ tầng local

```bash
docker compose up -d
```

## Cài dependencies JavaScript

```bash
pnpm install
pnpm db:generate
```

## Chạy backend

```bash
pnpm dev:backend
```

## Chạy admin

```bash
pnpm dev:admin
```

## Flutter app

Máy hiện tại chưa có Flutter SDK, nên app client đang ở mức starter source. Sau khi cài Flutter:

```bash
cd apps/flutter_app
flutter pub get
flutter run
```

## Note for local Postgres conflicts

Nếu máy đã có PostgreSQL riêng chạy ở `5432`, project này dùng `5435` để tránh đụng cổng.

## Seed dữ liệu ban đầu

```bash
pnpm --filter backend seed
```

Tài khoản mẫu:

- `username`: `admin`
- `password`: `admin123`

## Luồng thao tác hiện tại

1. Mở `http://localhost:3000`
2. Tạo thêm phòng ban
3. Tạo user và gán vào phòng ban
4. Tạo conversation `GROUP` hoặc `DIRECT`
5. Upload file
6. Gửi tin nhắn vào conversation đang chọn

## Self-host Production

### 1. Chuẩn bị file env

```bash
cp .env.production.example .env.production
```

Sửa lại tối thiểu các biến sau trong `.env.production`:

- `POSTGRES_PASSWORD`
- `MINIO_ROOT_PASSWORD`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `APP_ORIGIN`

### 2. Build và chạy stack production

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Stack production gồm:

- `nginx`: reverse proxy ngoài cùng
- `admin`: Next.js web UI
- `backend`: NestJS API + Socket.IO
- `postgres`
- `redis`
- `minio`

### 3. Chạy migration DB

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec backend pnpm prisma migrate deploy
```

Nếu cần seed dữ liệu mẫu:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec backend pnpm seed
```

### 4. Public URL / domain

Với cấu hình hiện tại:

- Web UI đi qua cùng domain
- REST API đi qua `/api`
- Socket.IO đi cùng domain qua `nginx`

Ví dụ:

- Web: `https://chat.example.com`
- API: `https://chat.example.com/api`

## Desktop App Và Mobile App

Đúng, desktop app và mobile app cần biết `server URL` của hệ thống self-host.

Tối thiểu nên có:

- `SERVER_BASE_URL`: ví dụ `https://chat.example.com`
- hoặc tách riêng:
  - `API_BASE_URL`: `https://chat.example.com/api`
  - `SOCKET_BASE_URL`: `https://chat.example.com`

Khuyến nghị triển khai:

- Desktop app: cho cấu hình `server URL` ở màn hình đăng nhập lần đầu hoặc file config
- Mobile app: để `server URL` trong màn hình setup đầu tiên hoặc build flavor theo từng khách hàng/công ty

Với web hiện tại tôi đã đổi sang env:

- `NEXT_PUBLIC_API_BASE`
- `NEXT_PUBLIC_SOCKET_BASE`

Nên khi self-host chỉ cần map đúng host của anh là chạy được.

## Electron Desktop App

App desktop Electron đã được tách riêng trong repo tại `apps/desktop`.

### Chạy desktop app ở máy dev

```bash
pnpm install
pnpm dev:desktop
```

Lần đầu mở app, nhập `SERVER_BASE_URL` của hệ thống self-host, ví dụ:

- `https://chat.example.com`
- `http://192.168.1.10`

### Build macOS `.dmg`

```bash
pnpm build:desktop:mac
```

### Build Windows `.exe`

```bash
pnpm build:desktop:win
```

### Build cả desktop targets

```bash
pnpm build:desktop
```

File output sẽ nằm trong:

```bash
apps/desktop/dist
```

Lưu ý:

- `.dmg` build trên macOS là chuẩn nhất
- `.exe` nên build trên Windows để tránh lỗi toolchain
- desktop app không cần API key riêng, chỉ cần cấu hình `SERVER_BASE_URL`
