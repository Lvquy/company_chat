# Architecture

## Modules

- `auth`: đăng nhập, refresh token, có thể mở rộng LDAP/AD
- `users`: hồ sơ người dùng
- `departments`: quản lý phòng ban
- `conversations`: chat 1-1 và chat nhóm
- `messages`: text, image, file
- `attachments`: metadata file trên MinIO
- `presence`: online/offline, last seen
- `install`: wizard cấu hình triển khai lần đầu

## Realtime

- Mỗi conversation là một Socket.IO room
- Chat 1-1 dùng conversation type `direct`
- Chat nhóm dùng conversation type `group`
- Tin nhắn được lưu vào DB trước khi emit cho room

## Storage

- `PostgreSQL`: dữ liệu nghiệp vụ và lịch sử chat
- `Redis`: cache, presence, pub/sub khi scale nhiều node
- `MinIO`: ảnh, tài liệu, file đính kèm

## Client surfaces

- `Flutter`: app người dùng đa nền tảng
- `Next.js`: portal quản trị và màn cấu hình ban đầu
