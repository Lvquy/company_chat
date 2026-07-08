# Database Notes

## Core tables

- `users`
- `departments`
- `department_members`
- `conversations`
- `conversation_members`
- `messages`
- `message_reads`
- `attachments`
- `message_attachments`

## Conversation rules

- `direct`: chỉ 2 thành viên
- `group`: nhiều thành viên, có owner/admin/member

## Message rules

- `text`: chỉ text
- `image`: có attachment ảnh
- `file`: có attachment tài liệu
- `mixed`: vừa text vừa attachment
