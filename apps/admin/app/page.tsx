'use client';

import {
  ChangeEvent,
  FormEvent,
  KeyboardEvent,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { io, Socket } from 'socket.io-client';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';
const SOCKET_BASE = process.env.NEXT_PUBLIC_SOCKET_BASE ?? API_BASE;
const TOKEN_KEY = 'inhouse-chat-token';
const MUTED_CONVERSATIONS_KEY = 'inhouse-chat-muted-conversations';
const EMOJIS = ['👍', '😀', '😂', '❤️', '🎉', '🔥'];
const REACTION_PICKER_OPEN_DELAY_MS = 1000;

type DesktopConfig = {
  serverUrl: string;
  companyName: string;
  logoDataUrl: string;
};

declare global {
  interface Window {
    desktopApp?: {
      getConfig: () => Promise<DesktopConfig>;
      quitApp?: () => Promise<{ ok: boolean }>;
    };
  }
}

type Department = {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
  members?: Array<{
    id: string;
    userId: string;
    title?: string | null;
    createdAt: string;
    user: {
      id: string;
      username: string;
      fullName: string;
      avatarUrl?: string | null;
      status: string;
    };
  }>;
};

type User = {
  id: string;
  username: string;
  fullName: string;
  avatarUrl?: string | null;
  status: string;
  isAdmin?: boolean;
  departments: Department[];
};

type DirectoryUser = {
  id: string;
  username: string;
  fullName: string;
  avatarUrl?: string | null;
  status: string;
  departments: Array<{ department: Department }>;
};

type Conversation = {
  id: string;
  type: 'DIRECT' | 'GROUP';
  title?: string | null;
  createdById: string;
  createdAt: string;
  lastMessageAt?: string | null;
  members: Array<{
    role: 'OWNER' | 'ADMIN' | 'MEMBER';
    user: {
      id: string;
      fullName: string;
      username: string;
      avatarUrl?: string | null;
    };
  }>;
  messages: Array<{
    body?: string | null;
    createdAt: string;
  }>;
};

type Message = {
  id: string;
  conversationId: string;
  type: 'TEXT' | 'IMAGE' | 'FILE' | 'MIXED' | 'SYSTEM';
  body?: string | null;
  createdAt: string;
  replyTo?: {
    id: string;
    body?: string | null;
    createdAt: string;
    sender: {
      id: string;
      fullName: string;
      username: string;
      avatarUrl?: string | null;
    };
  } | null;
  sender: {
    id: string;
    fullName: string;
    username: string;
    avatarUrl?: string | null;
  };
  reactions: Array<{
    id: string;
    emoji: string;
    user: {
      id: string;
      fullName: string;
    };
  }>;
  attachments: Array<{
    attachment: {
      id: string;
      originalName: string;
      mimeType: string;
      downloadUrl: string;
    };
  }>;
};

type AttachmentResponse = {
  id: string;
  originalName: string;
  downloadUrl: string;
};

type IncomingToast = {
  conversationId: string;
  title: string;
  body: string;
  avatarUrl?: string | null;
};

type AdminUser = {
  id: string;
  username: string;
  fullName: string;
  avatarUrl?: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string | null;
  lastLoginIp?: string | null;
  departments: Array<{
    id: string;
    departmentId: string;
    userId: string;
    title?: string | null;
    createdAt: string;
    department: Department;
  }>;
};

type LoginActivity = {
  id: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  loggedInAt: string;
  user: {
    id: string;
    username: string;
    fullName: string;
    avatarUrl?: string | null;
    status: string;
  };
};

type AttendanceRecord = {
  id: string;
  workDate: string;
  checkInAt: string;
  checkOutAt?: string | null;
  checkInIp?: string | null;
  checkOutIp?: string | null;
  user: {
    id: string;
    username: string;
    fullName: string;
    avatarUrl?: string | null;
    status: string;
  };
};

type AdminOverview = {
  users: number;
  departments: number;
  conversations: number;
  messages: number;
  loginsToday: number;
  attendanceToday: number;
  activeAttendance: number;
  recentLogins: LoginActivity[];
  recentAttendance: AttendanceRecord[];
};

type LoginResponse = {
  accessToken: string;
  user: User;
};

type MainMode = 'chats' | 'contacts' | 'settings' | 'admin';

async function api<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return response.json();
}

function getInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((item) => item[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function getConversationTitle(conversation: Conversation, currentUserId: string) {
  if (conversation.title) {
    return conversation.title;
  }

  const peers = conversation.members.filter((member) => member.user.id !== currentUserId);
  return peers.map((member) => member.user.fullName).join(', ') || 'Chỉ mình bạn';
}

function getMentionQuery(text: string) {
  const match = text.match(/(?:^|\s)@([^\s@]*)$/);
  return match ? match[1].toLowerCase() : null;
}

function formatMessageTime(value: string) {
  return new Date(value).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMessageDate(value: string) {
  return new Date(value).toLocaleDateString('vi-VN', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatMessageDateTime(value: string) {
  return new Date(value).toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function getLocalDateInputValue(value: string) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isImageAttachment(mimeType: string) {
  return mimeType.startsWith('image/');
}

function Avatar({
  name,
  avatarUrl,
  size = 'md',
}: {
  name: string;
  avatarUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  return avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={name} className={`avatar avatar-${size}`} src={avatarUrl} />
  ) : (
    <div className={`avatar avatar-${size}`}>{getInitials(name)}</div>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13Zm0 0L20 19.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6 18.5V6.5A2.5 2.5 0 0 1 8.5 4h7A2.5 2.5 0 0 1 18 6.5v6A2.5 2.5 0 0 1 15.5 15H10l-4 3.5Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function ContactsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M8 10a2.5 2.5 0 1 0 0-5a2.5 2.5 0 0 0 0 5Zm8 1.5a2 2 0 1 0 0-4a2 2 0 0 0 0 4ZM4.5 18a3.5 3.5 0 0 1 7 0M13 18a3 3 0 0 1 6 0"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 8.7a3.3 3.3 0 1 0 0 6.6a3.3 3.3 0 0 0 0-6.6Zm7.2 3.3-.9-.3a6.9 6.9 0 0 0-.5-1.3l.5-.8a1 1 0 0 0-.1-1.2l-1.2-1.2a1 1 0 0 0-1.2-.1l-.8.5a6.9 6.9 0 0 0-1.3-.5l-.3-.9a1 1 0 0 0-1-.7h-1.8a1 1 0 0 0-1 .7l-.3.9a6.9 6.9 0 0 0-1.3.5l-.8-.5a1 1 0 0 0-1.2.1L5.3 8a1 1 0 0 0-.1 1.2l.5.8a6.9 6.9 0 0 0-.5 1.3l-.9.3a1 1 0 0 0-.7 1v1.8a1 1 0 0 0 .7 1l.9.3c.1.4.3.9.5 1.3l-.5.8a1 1 0 0 0 .1 1.2l1.2 1.2a1 1 0 0 0 1.2.1l.8-.5c.4.2.9.4 1.3.5l.3.9a1 1 0 0 0 1 .7h1.8a1 1 0 0 0 1-.7l.3-.9c.4-.1.9-.3 1.3-.5l.8.5a1 1 0 0 0 1.2-.1l1.2-1.2a1 1 0 0 0 .1-1.2l-.5-.8c.2-.4.4-.9.5-1.3l.9-.3a1 1 0 0 0 .7-1V13a1 1 0 0 0-.7-1Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 5h5v6H5zm9 0h5v10h-5zM5 15h5v4H5zm9 0h5v4h-5z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 5v14M5 12h14"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m4 20 4.2-1 9.3-9.3a2 2 0 1 0-2.8-2.8L5.4 16.2 4 20Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M9 4.75h6m-8.5 3h11m-9 3.25v5.5m4-5.5v5.5m-5 3.75h6.5a1.5 1.5 0 0 0 1.49-1.3L17.5 7.75h-11l1.01 11.2a1.5 1.5 0 0 0 1.49 1.3Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5.75 12.5 10 16.75 18.25 8.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M18.5 8.75A7 7 0 0 0 7.36 7.2M5.5 8.5v-3h3M5.5 15.25A7 7 0 0 0 16.64 16.8m1.86-1.3v3h-3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function GroupAddIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M8 10a2.5 2.5 0 1 0 0-5a2.5 2.5 0 0 0 0 5Zm8 0a2.5 2.5 0 1 0 0-5a2.5 2.5 0 0 0 0 5ZM3.5 18a4.5 4.5 0 0 1 9 0m3-2.5h5m-2.5-2.5v5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function AttachIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M8 12.5 13.8 6.7a3.2 3.2 0 1 1 4.5 4.6L10.5 19a5 5 0 0 1-7-7.1L11.7 3.7"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-11A1.5 1.5 0 0 1 5.5 5Zm1.8 10.5 3.3-3.3 2.6 2.6 2.8-2.8 2 2"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <circle cx="9" cy="9" r="1.2" fill="currentColor" />
    </svg>
  );
}

function SmileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18Zm-3.5-8a4.6 4.6 0 0 0 7 0M9 10h.01M15 10h.01"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function BellOffIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7.7 7.7A6 6 0 0 1 18 12.2V16l1.2 2H6.8m.9-8.4L4 6m6.6 14a1.8 1.8 0 0 0 2.8 0"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function BellOnIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 20.5a1.9 1.9 0 0 0 1.85-1.45M7.5 9.25a4.5 4.5 0 1 1 9 0V13l1.5 2.5h-12L7.5 13Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 19 20 12 4 5l3.6 7L4 19Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

function LikeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M10 10.5 12.7 5a1.7 1.7 0 0 1 3.2.9v4.6h2.4a1.7 1.7 0 0 1 1.7 1.9l-.8 5.6a2 2 0 0 1-2 1.7H10m0-9v9m0-9H6.7A1.7 1.7 0 0 0 5 12.2v6.1A1.7 1.7 0 0 0 6.7 20H10"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function ReplyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M10 8 5 12l5 4m-4.5-4H15a4.5 4.5 0 0 1 4.5 4.5V18"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6 12h.01M12 12h.01M18 12h.01"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.2"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 4.5v3m10-3v3M5.5 8.5h13A1.5 1.5 0 0 1 20 10v8.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5V10A1.5 1.5 0 0 1 5.5 8.5Zm-1.5 4h16"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m7 7 10 10M17 7 7 17"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="m10 7 5 5-5 5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function UserCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 12.25a3.25 3.25 0 1 0 0-6.5a3.25 3.25 0 0 0 0 6.5Zm-6 6a6 6 0 0 1 12 0"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M14 7.5V5.8A1.8 1.8 0 0 0 12.2 4H7.8A1.8 1.8 0 0 0 6 5.8v12.4A1.8 1.8 0 0 0 7.8 20h4.4a1.8 1.8 0 0 0 1.8-1.8v-1.7M11 12h9m-3-3 3 3-3 3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function QuitIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M8 8l8 8m0-8-8 8M5.8 4h12.4A1.8 1.8 0 0 1 20 5.8v12.4A1.8 1.8 0 0 1 18.2 20H5.8A1.8 1.8 0 0 1 4 18.2V5.8A1.8 1.8 0 0 1 5.8 4Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export default function HomePage() {
  const socketRef = useRef<Socket | null>(null);
  const messageStreamRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const messageItemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const reactionHoverTimeoutRef = useRef<number | null>(null);
  const actionHoverTimeoutRef = useRef<number | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const selectedConversationRef = useRef('');
  const conversationsRef = useRef<Conversation[]>([]);
  const [token, setToken] = useState('');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState('');
  const [mode, setMode] = useState<MainMode>('chats');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [conversationSearch, setConversationSearch] = useState('');
  const deferredConversationSearch = useDeferredValue(conversationSearch);
  const [conversationDateFilter, setConversationDateFilter] = useState('');
  const [activeConversationSearchIndex, setActiveConversationSearchIndex] = useState(0);
  const [pendingAttachment, setPendingAttachment] = useState<AttachmentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminNotice, setAdminNotice] = useState<string | null>(null);
  const [departmentModalError, setDepartmentModalError] = useState<string | null>(null);
  const [userModalError, setUserModalError] = useState<string | null>(null);
  const [resetPasswordModalError, setResetPasswordModalError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showEmojiMenu, setShowEmojiMenu] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [mutedConversationIds, setMutedConversationIds] = useState<string[]>([]);
  const [incomingToast, setIncomingToast] = useState<IncomingToast | null>(null);
  const [activeReactionPickerId, setActiveReactionPickerId] = useState<string | null>(null);
  const [detailMessage, setDetailMessage] = useState<Message | null>(null);
  const [activeMessageActionsId, setActiveMessageActionsId] = useState<string | null>(null);
  const [detailMenuMessageId, setDetailMenuMessageId] = useState<string | null>(null);
  const [adminSection, setAdminSection] = useState<'departments' | 'users'>('departments');
  const [editingDepartmentId, setEditingDepartmentId] = useState<string | null>(null);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [showDepartmentCreateModal, setShowDepartmentCreateModal] = useState(false);
  const [showUserCreateModal, setShowUserCreateModal] = useState(false);
  const [resetPasswordUser, setResetPasswordUser] = useState<AdminUser | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [deleteUserTarget, setDeleteUserTarget] = useState<AdminUser | null>(null);
  const [showAddMembersModal, setShowAddMembersModal] = useState(false);
  const [groupMemberSelection, setGroupMemberSelection] = useState<string[]>([]);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [isDesktopApp, setIsDesktopApp] = useState(false);
  const [desktopBranding, setDesktopBranding] = useState<DesktopConfig>({
    serverUrl: '',
    companyName: 'Company Chat',
    logoDataUrl: '',
  });

  const [loginForm, setLoginForm] = useState({
    username: '',
    password: '',
  });
  const [messageBody, setMessageBody] = useState('');
  const [groupForm, setGroupForm] = useState({
    title: '',
    memberIds: [] as string[],
  });
  const [departmentForm, setDepartmentForm] = useState({
    name: '',
  });
  const [userForm, setUserForm] = useState({
    username: '',
    fullName: '',
    avatarUrl: '',
    password: '',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
    departmentIds: [] as string[],
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
  });
  const [profileForm, setProfileForm] = useState({
    fullName: '',
    avatarUrl: '',
  });

  useEffect(() => {
    setIsDesktopApp(Boolean(window.desktopApp));
    if (!window.desktopApp?.getConfig) {
      return;
    }

    window.desktopApp
      .getConfig()
      .then((config) => {
        setDesktopBranding({
          serverUrl: config.serverUrl || '',
          companyName: config.companyName || 'Company Chat',
          logoDataUrl: config.logoDataUrl || '',
        });
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const storedToken = window.localStorage.getItem(TOKEN_KEY);
    const storedMutedConversations = window.localStorage.getItem(MUTED_CONVERSATIONS_KEY);
    if (storedMutedConversations) {
      try {
        setMutedConversationIds(JSON.parse(storedMutedConversations));
      } catch {
        window.localStorage.removeItem(MUTED_CONVERSATIONS_KEY);
      }
    }
    if (!storedToken) {
      return;
    }
    const sessionToken = storedToken;

    async function hydrateSession() {
      try {
        const profile = await api<User>('/auth/me', sessionToken);
        setCurrentUser(profile);
        setToken(sessionToken);
        await refreshData(sessionToken, profile.isAdmin);
      } catch (err) {
        void clearSession(false);
        setError((err as Error).message);
      }
    }

    void hydrateSession();
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    setProfileForm({
      fullName: currentUser.fullName,
      avatarUrl: currentUser.avatarUrl ?? '',
    });
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser || typeof window === 'undefined' || !('Notification' in window)) {
      return;
    }

    if (Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }, [currentUser]);

  useEffect(() => {
    selectedConversationRef.current = selectedConversationId;
  }, [selectedConversationId]);

  useEffect(() => {
    setConversationSearch('');
    setConversationDateFilter('');
    setActiveConversationSearchIndex(0);
  }, [selectedConversationId]);

  useEffect(() => {
    if (!showSettingsMenu) return;

    function handlePointerDown(event: MouseEvent) {
      if (!settingsMenuRef.current?.contains(event.target as Node)) {
        setShowSettingsMenu(false);
      }
    }

    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [showSettingsMenu]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(MUTED_CONVERSATIONS_KEY, JSON.stringify(mutedConversationIds));
  }, [mutedConversationIds]);

  useEffect(() => {
    if (!notice) return;
    const timeoutId = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  useEffect(() => {
    if (!incomingToast) return;
    const timeoutId = window.setTimeout(() => setIncomingToast(null), 4200);
    return () => window.clearTimeout(timeoutId);
  }, [incomingToast]);

  useEffect(() => {
    setNotice(null);
  }, [mode, adminSection, selectedConversationId]);

  useEffect(() => {
    setError(null);
    setAdminError(null);
    setAdminNotice(null);
    setDepartmentModalError(null);
    setUserModalError(null);
    setResetPasswordModalError(null);
    setShowSettingsMenu(false);
  }, [mode]);

  useEffect(() => {
    setAdminError(null);
    setAdminNotice(null);
    setDepartmentModalError(null);
    setUserModalError(null);
    setResetPasswordModalError(null);
  }, [adminSection]);

  useEffect(() => {
    setGroupMemberSelection([]);
    setShowAddMembersModal(false);
  }, [selectedConversationId]);

  useEffect(() => {
    return () => {
      if (reactionHoverTimeoutRef.current) {
        window.clearTimeout(reactionHoverTimeoutRef.current);
      }
      if (actionHoverTimeoutRef.current) {
        window.clearTimeout(actionHoverTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedConversationId) return;
    setUnreadCounts((prev) => {
      if (!prev[selectedConversationId]) return prev;
      const next = { ...prev };
      delete next[selectedConversationId];
      return next;
    });
  }, [selectedConversationId]);

  useEffect(() => {
    if (!token || !selectedConversationId || mode === 'settings' || mode === 'admin') {
      setMessages([]);
      setReplyTarget(null);
      return;
    }

    async function fetchMessages() {
      try {
      const data = await api<Message[]>(`/conversations/messages?conversationId=${selectedConversationId}`, token);
      startTransition(() => setMessages(data));
    } catch (err) {
      handleGlobalApiError(err);
    }
    }

    void fetchMessages();
  }, [mode, selectedConversationId, token]);

  useEffect(() => {
    if (!currentUser) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }

    const socket = io(`${SOCKET_BASE}/chat`, {
      transports: ['websocket'],
      auth: {
        token,
      },
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      conversationsRef.current.forEach((conversation) => {
        socket.emit('conversation:join', { conversationId: conversation.id });
      });
    });

    socket.on('message:new', (message: Message) => {
      startTransition(() => {
        setConversations((prev) =>
          prev
            .map((conversation) =>
              conversation.id === message.conversationId
                ? {
                    ...conversation,
                    lastMessageAt: message.createdAt,
                    messages: [{ body: message.body, createdAt: message.createdAt }],
                  }
                : conversation,
            )
            .toSorted((left, right) => {
              const leftTime = left.lastMessageAt ?? left.createdAt;
              const rightTime = right.lastMessageAt ?? right.createdAt;
              return rightTime.localeCompare(leftTime);
            }),
        );

        if (message.conversationId === selectedConversationRef.current) {
          setMessages((prev) => (prev.some((item) => item.id === message.id) ? prev : [...prev, message]));
        }
      });

      if (message.sender.id === currentUser.id) {
        return;
      }

      if (mutedConversationIds.includes(message.conversationId)) {
        return;
      }

      const isActiveConversation = message.conversationId === selectedConversationRef.current;
      const isVisible = typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus();
      const conversation = conversationsRef.current.find((item) => item.id === message.conversationId);
      const title = conversation
        ? getConversationTitle(conversation, currentUser.id)
        : message.sender.fullName;
      const body = message.body?.trim() || 'Đã gửi một file đính kèm';

      setIncomingToast({
        conversationId: message.conversationId,
        title,
        body,
        avatarUrl: message.sender.avatarUrl ?? null,
      });
      playIncomingNotificationSound();

      if (!isActiveConversation || !isVisible) {
        setUnreadCounts((prev) => ({
          ...prev,
          [message.conversationId]: (prev[message.conversationId] ?? 0) + 1,
        }));
      }

      if (
        typeof window !== 'undefined' &&
        'Notification' in window &&
        Notification.permission === 'granted' &&
        (!isActiveConversation || !isVisible)
      ) {
        const notification = new Notification(title, {
          body,
          icon: message.sender.avatarUrl ?? undefined,
          tag: message.conversationId,
        });
        notification.onclick = () => {
          window.focus();
          openConversation(message.conversationId);
        };
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [currentUser, mutedConversationIds, token]);

  useEffect(() => {
    if (!socketRef.current) return;
    conversations.forEach((conversation) => {
      socketRef.current?.emit('conversation:join', { conversationId: conversation.id });
    });
  }, [conversations]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const container = messageStreamRef.current;
      if (!container) return;
      container.scrollTop = container.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [messages, selectedConversationId]);

  useEffect(() => {
    const totalUnread = Object.values(unreadCounts).reduce((sum, count) => sum + count, 0);
    const appTitle = desktopBranding.companyName || 'Company Chat';
    document.title = totalUnread > 0 ? `(${totalUnread}) ${appTitle}` : appTitle;
  }, [desktopBranding.companyName, unreadCounts]);

  const selectedConversation = useMemo(
    () => conversations.find((item) => item.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );

  const isGroupOwner = useMemo(
    () => !!selectedConversation && selectedConversation.type === 'GROUP' && selectedConversation.createdById === currentUser?.id,
    [currentUser?.id, selectedConversation],
  );

  const isConversationMuted = useMemo(
    () => !!selectedConversationId && mutedConversationIds.includes(selectedConversationId),
    [mutedConversationIds, selectedConversationId],
  );

  const filteredChats = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    if (!query) return conversations;
    return conversations.filter((conversation) =>
      `${getConversationTitle(conversation, currentUser?.id ?? '')} ${conversation.messages[0]?.body ?? ''}`
        .toLowerCase()
        .includes(query),
    );
  }, [conversations, currentUser?.id, deferredSearch]);

  const filteredContacts = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    if (!query) return directory;
    return directory.filter((user) => {
      const dept = user.departments.map((item) => item.department.name).join(' ');
      return `${user.fullName} ${user.username} ${dept}`.toLowerCase().includes(query);
    });
  }, [deferredSearch, directory]);

  const recentAttachments = useMemo(
    () => messages.flatMap((message) => message.attachments).slice(-6).reverse(),
    [messages],
  );

  const mentionCandidates = useMemo(() => {
    const query = getMentionQuery(messageBody);
    if (!query || !selectedConversation) return [];
    const candidates =
      selectedConversation.type === 'GROUP'
        ? selectedConversation.members
            .map((member) => member.user)
            .filter((member) => member.id !== currentUser?.id)
        : directory.filter(
            (user) =>
              selectedConversation.members.some((member) => member.user.id === user.id) ||
              user.id !== currentUser?.id,
          );
    return candidates
      .filter((user) => user.fullName.toLowerCase().includes(query) || user.username.toLowerCase().includes(query))
      .slice(0, 5);
  }, [currentUser?.id, directory, messageBody, selectedConversation]);

  const sharedGroupCount = useMemo(() => {
    if (!selectedConversation || selectedConversation.type !== 'DIRECT') return 0;
    const peerId = selectedConversation.members.find((member) => member.user.id !== currentUser?.id)?.user.id;
    if (!peerId) return 0;
    return conversations.filter(
      (conversation) =>
        conversation.type === 'GROUP' &&
        conversation.members.some((member) => member.user.id === peerId),
    ).length;
  }, [conversations, currentUser?.id, selectedConversation]);

  const groupCandidates = useMemo(() => {
    const query = groupSearch.trim().toLowerCase();
    return directory
      .filter((user) => user.id !== currentUser?.id)
      .filter((user) => {
        if (!query) return true;
        const dept = user.departments.map((item) => item.department.name).join(' ');
        return `${user.fullName} ${user.username} ${dept}`.toLowerCase().includes(query);
      });
  }, [currentUser?.id, directory, groupSearch]);

  const availableGroupMembers = useMemo(() => {
    if (!selectedConversation || selectedConversation.type !== 'GROUP') return [];
    const existingMemberIds = new Set(selectedConversation.members.map((member) => member.user.id));
    return directory.filter((user) => !existingMemberIds.has(user.id));
  }, [directory, selectedConversation]);

  function getConversationDepartmentLabel(conversation: Conversation) {
    if (conversation.type === 'GROUP') {
      return `${conversation.members.length} thành viên`;
    }

    const peerId = conversation.members.find((member) => member.user.id !== currentUser?.id)?.user.id;
    if (!peerId) {
      return 'Chưa có phòng ban';
    }

    const peer = directory.find((user) => user.id === peerId);
    if (!peer?.departments.length) {
      return 'Chưa có phòng ban';
    }

    return peer.departments.map((item) => item.department.name).join(', ');
  }

  const filteredMessages = useMemo(
    () =>
      messages.filter(
        (message) => !conversationDateFilter || getLocalDateInputValue(message.createdAt) === conversationDateFilter,
      ),
    [conversationDateFilter, messages],
  );

  const matchedMessageIds = useMemo(() => {
    const query = deferredConversationSearch.trim().toLowerCase();
    if (!query) return [];

    return filteredMessages
      .filter((message) =>
        [
          message.body ?? '',
          message.sender.fullName,
          message.sender.username,
          message.replyTo?.body ?? '',
          ...message.attachments.map((item) => item.attachment.originalName),
        ]
          .join(' ')
          .toLowerCase()
          .includes(query),
      )
      .map((message) => message.id);
  }, [deferredConversationSearch, filteredMessages]);

  useEffect(() => {
    setActiveConversationSearchIndex(0);
  }, [deferredConversationSearch, conversationDateFilter, selectedConversationId]);

  useEffect(() => {
    if (!matchedMessageIds.length) {
      setActiveConversationSearchIndex(0);
      return;
    }

    setActiveConversationSearchIndex((current) => Math.min(current, matchedMessageIds.length - 1));
  }, [matchedMessageIds]);

  const activeMatchedMessageId = matchedMessageIds[activeConversationSearchIndex] ?? null;

  useEffect(() => {
    if (!activeMatchedMessageId) return;
    const node = messageItemRefs.current[activeMatchedMessageId];
    if (!node) return;

    node.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, [activeMatchedMessageId]);

  const messageTimeline = useMemo(() => {
    const items: Array<{ type: 'date'; key: string; label: string } | { type: 'message'; key: string; message: Message }> = [];
    let currentDate = '';

    for (const message of filteredMessages) {
      const dateKey = new Date(message.createdAt).toDateString();
      if (dateKey !== currentDate) {
        currentDate = dateKey;
        items.push({
          type: 'date',
          key: `date-${dateKey}`,
          label: formatMessageDate(message.createdAt),
        });
      }

      items.push({
        type: 'message',
        key: message.id,
        message,
      });
    }

    return items;
  }, [filteredMessages]);

  function gotoNextSearchResult() {
    if (!matchedMessageIds.length) return;
    setActiveConversationSearchIndex((current) => (current + 1) % matchedMessageIds.length);
  }

  async function refreshSelectedMessages(conversationId = selectedConversationId, sessionToken = token) {
    if (!sessionToken || !conversationId) {
      setMessages([]);
      return;
    }

    const data = await api<Message[]>(`/conversations/messages?conversationId=${conversationId}`, sessionToken);
    startTransition(() => setMessages(data));
  }

  async function refreshData(sessionToken = token, isAdmin = currentUser?.isAdmin) {
    if (!sessionToken) return;
    const requests: Promise<unknown>[] = [
      api<Conversation[]>('/conversations', sessionToken),
      api<DirectoryUser[]>('/users/directory', sessionToken),
    ];

    if (isAdmin) {
      requests.push(api<Department[]>('/departments', sessionToken));
      requests.push(api<AdminUser[]>('/users', sessionToken));
      requests.push(api<AdminOverview>('/admin/overview', sessionToken));
    }

    const [conversationData, directoryData, adminDepartments, usersData, overviewData] = await Promise.all(
      requests,
    );
    const nextConversations = conversationData as Conversation[];
    setConversations(nextConversations);
    setDirectory(directoryData as DirectoryUser[]);
    if (isAdmin) {
      setDepartments((adminDepartments as Department[]) ?? []);
      setAdminUsers((usersData as AdminUser[]) ?? []);
      setAdminOverview((overviewData as AdminOverview) ?? null);
    }
    if (!selectedConversationId && nextConversations[0]) {
      setSelectedConversationId(nextConversations[0].id);
      return;
    }

    if (selectedConversationId && !nextConversations.some((conversation) => conversation.id === selectedConversationId)) {
      setSelectedConversationId(nextConversations[0]?.id ?? '');
    }
  }

  async function clearSession(notifyServer = true) {
    if (notifyServer && token) {
      try {
        await api('/auth/logout', token, {
          method: 'POST',
        });
      } catch {
        // ignore logout audit failures during local clear
      }
    }
    window.localStorage.removeItem(TOKEN_KEY);
    setToken('');
    setCurrentUser(null);
    setConversations([]);
    setDirectory([]);
    setDepartments([]);
    setAdminUsers([]);
    setAdminOverview(null);
    setMessages([]);
    setUnreadCounts({});
    setSelectedConversationId('');
    setMode('chats');
  }

  function getApiErrorMessage(err: unknown) {
    return err instanceof Error ? err.message : 'Unexpected error';
  }

  function handleApiError(err: unknown) {
    const message = getApiErrorMessage(err);
    if (message.includes('Invalid or expired token') || message.includes('Missing bearer token')) {
      void clearSession(false);
    }
    return message;
  }

  function handleGlobalApiError(err: unknown) {
    const message = handleApiError(err);
    setNotice(null);
    setError(message);
  }

  function pushAdminNotice(message: string) {
    setAdminError(null);
    setAdminNotice(message);
  }

  function pushScopedAdminError(
    err: unknown,
    scope: 'admin' | 'department-modal' | 'user-modal' | 'reset-password-modal',
  ) {
    const message = handleApiError(err);
    if (scope === 'admin') {
      setAdminNotice(null);
      setAdminError(message);
      return;
    }
    if (scope === 'department-modal') {
      setDepartmentModalError(message);
      return;
    }
    if (scope === 'user-modal') {
      setUserModalError(message);
      return;
    }
    setResetPasswordModalError(message);
  }

  function clearAdminFeedback() {
    setAdminError(null);
    setAdminNotice(null);
    setDepartmentModalError(null);
    setUserModalError(null);
    setResetPasswordModalError(null);
  }

  function openSettingsScreen() {
    setShowSettingsMenu(false);
    setError(null);
    setNotice(null);
    setMode('settings');
  }

  async function handleQuitDesktopApp() {
    try {
      await window.desktopApp?.quitApp?.();
    } catch {
      // ignore desktop quit bridge failures
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('login');
    setError(null);
    try {
      const result = await api<LoginResponse>('/auth/login', undefined, {
        method: 'POST',
        body: JSON.stringify(loginForm),
      });
      window.localStorage.setItem(TOKEN_KEY, result.accessToken);
      setToken(result.accessToken);
      setCurrentUser(result.user);
      await refreshData(result.accessToken, result.user.isAdmin);
    } catch (err) {
      handleGlobalApiError(err);
    } finally {
      setBusy(null);
    }
  }

  async function handleOpenDirect(targetUserId: string) {
    setBusy(`direct-${targetUserId}`);
    try {
      const conversation = await api<Conversation>('/conversations/direct', token, {
        method: 'POST',
        body: JSON.stringify({ targetUserId }),
      });
      await refreshData();
      openConversation(conversation.id);
    } catch (err) {
      handleGlobalApiError(err);
    } finally {
      setBusy(null);
    }
  }

  async function handleCreateGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('group');
    try {
      const conversation = await api<Conversation>('/conversations', token, {
        method: 'POST',
        body: JSON.stringify({
          type: 'GROUP',
          title: groupForm.title,
          memberIds: groupForm.memberIds,
        }),
      });
      setGroupForm({ title: '', memberIds: [] });
      setGroupSearch('');
      setShowGroupModal(false);
      await refreshData();
      openConversation(conversation.id);
      setNotice('Đã tạo nhóm mới.');
    } catch (err) {
      handleGlobalApiError(err);
    } finally {
      setBusy(null);
    }
  }

  async function handleAddMembersToGroup() {
    if (!selectedConversation || selectedConversation.type !== 'GROUP' || !groupMemberSelection.length) return;
    setBusy('group-members-add');
    try {
      await api(`/conversations/${selectedConversation.id}/members`, token, {
        method: 'POST',
        body: JSON.stringify({ memberIds: groupMemberSelection }),
      });
      setGroupMemberSelection([]);
      setShowAddMembersModal(false);
      await refreshData();
      await refreshSelectedMessages(selectedConversation.id);
      setNotice('Đã thêm thành viên vào nhóm.');
    } catch (err) {
      handleGlobalApiError(err);
    } finally {
      setBusy(null);
    }
  }

  async function handleRemoveMemberFromGroup(memberId: string) {
    if (!selectedConversation || selectedConversation.type !== 'GROUP') return;
    setBusy(`group-member-remove-${memberId}`);
    try {
      await api(`/conversations/${selectedConversation.id}/members/${memberId}`, token, {
        method: 'DELETE',
      });
      await refreshData();
      await refreshSelectedMessages(selectedConversation.id);
      setNotice('Đã xóa thành viên khỏi nhóm.');
    } catch (err) {
      handleGlobalApiError(err);
    } finally {
      setBusy(null);
    }
  }

  async function handleDissolveGroup() {
    if (!selectedConversation || selectedConversation.type !== 'GROUP') return;
    const confirmed = window.confirm(`Giải tán nhóm "${getConversationTitle(selectedConversation, currentUser?.id ?? '')}"?`);
    if (!confirmed) return;
    setBusy('group-dissolve');
    try {
      await api(`/conversations/${selectedConversation.id}`, token, {
        method: 'DELETE',
      });
      await refreshData();
      setMessages([]);
      setNotice('Đã giải tán nhóm.');
    } catch (err) {
      handleGlobalApiError(err);
    } finally {
      setBusy(null);
    }
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>, kind: 'image' | 'file') {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(kind === 'image' ? 'upload-image' : 'upload-file');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const uploaded = await api<AttachmentResponse>('/attachments', token, {
        method: 'POST',
        body: formData,
      });
      setPendingAttachment(uploaded);
      setNotice(`Đã thêm ${uploaded.originalName}.`);
    } catch (err) {
      handleGlobalApiError(err);
    } finally {
      setBusy(null);
      event.target.value = '';
    }
  }

  async function handleSendMessage(
    event?: FormEvent<HTMLFormElement>,
    options?: { body?: string; attachment?: AttachmentResponse | null; replyToId?: string | null },
  ) {
    event?.preventDefault();
    if (!selectedConversationId || !socketRef.current) return;
    const outgoingBody = options?.body ?? messageBody;
    const outgoingAttachment = options?.attachment ?? pendingAttachment;
    const outgoingReplyToId = options?.replyToId ?? replyTarget?.id ?? null;
    if (!outgoingBody.trim() && !outgoingAttachment) return;
    setBusy('message');
    try {
      const sent = await new Promise<Message>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timed out while sending message')), 5000);
        socketRef.current?.once('message:ack', (message: Message) => {
          clearTimeout(timeout);
          resolve(message);
        });
        socketRef.current?.emit('message:send', {
          conversationId: selectedConversationId,
          body: outgoingBody,
          attachmentIds: outgoingAttachment ? [outgoingAttachment.id] : [],
          replyToId: outgoingReplyToId,
        });
      });
      setMessageBody('');
      setPendingAttachment(null);
      setReplyTarget(null);
      setMessages((prev) => (prev.some((item) => item.id === sent.id) ? prev : [...prev, sent]));
      setConversations((prev) =>
        prev
          .map((conversation) =>
            conversation.id === selectedConversationId
              ? {
                  ...conversation,
                  lastMessageAt: sent.createdAt,
                  messages: [{ body: sent.body, createdAt: sent.createdAt }],
                }
              : conversation,
          )
          .toSorted((left, right) => {
            const leftTime = left.lastMessageAt ?? left.createdAt;
            const rightTime = right.lastMessageAt ?? right.createdAt;
            return rightTime.localeCompare(leftTime);
          }),
      );
    } catch (err) {
      handleGlobalApiError(err);
    } finally {
      setBusy(null);
    }
  }

  async function handleQuickLike() {
    if (messageBody.trim() || pendingAttachment) {
      await handleSendMessage();
      return;
    }

    await handleSendMessage(undefined, { body: '👍', attachment: null });
  }

  async function handleReact(messageId: string, emoji: string) {
    try {
      const updated = await api<Message>(`/conversations/messages/${messageId}/reactions`, token, {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      });
      setMessages((prev) => prev.map((message) => (message.id === messageId ? updated : message)));
      setActiveReactionPickerId(null);
    } catch (err) {
      handleGlobalApiError(err);
    }
  }

  function openReactionPicker(messageId: string) {
    if (reactionHoverTimeoutRef.current) {
      window.clearTimeout(reactionHoverTimeoutRef.current);
      reactionHoverTimeoutRef.current = null;
    }
    if (activeReactionPickerId === messageId) {
      return;
    }
    reactionHoverTimeoutRef.current = window.setTimeout(() => {
      setActiveReactionPickerId(messageId);
      reactionHoverTimeoutRef.current = null;
    }, REACTION_PICKER_OPEN_DELAY_MS);
  }

  function scheduleCloseReactionPicker(messageId: string) {
    if (reactionHoverTimeoutRef.current) {
      window.clearTimeout(reactionHoverTimeoutRef.current);
    }
    reactionHoverTimeoutRef.current = window.setTimeout(() => {
      setActiveReactionPickerId((current) => (current === messageId ? null : current));
      reactionHoverTimeoutRef.current = null;
    }, 2000);
  }

  function openMessageActions(messageId: string) {
    if (actionHoverTimeoutRef.current) {
      window.clearTimeout(actionHoverTimeoutRef.current);
      actionHoverTimeoutRef.current = null;
    }
    setActiveMessageActionsId(messageId);
  }

  function focusComposer() {
    window.setTimeout(() => {
      composerInputRef.current?.focus();
      const currentLength = composerInputRef.current?.value.length ?? 0;
      composerInputRef.current?.setSelectionRange(currentLength, currentLength);
    }, 0);
  }

  function handleReplyToMessage(message: Message) {
    setReplyTarget(message);
    focusComposer();
  }

  function toggleConversationNotifications() {
    if (!selectedConversationId) return;
    setMutedConversationIds((prev) => {
      const isMuted = prev.includes(selectedConversationId);
      return isMuted ? prev.filter((id) => id !== selectedConversationId) : [...prev, selectedConversationId];
    });
  }

  function playIncomingNotificationSound() {
    if (typeof window === 'undefined') return;
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;

    const audioContext = new AudioContextCtor();
    const masterGain = audioContext.createGain();
    masterGain.gain.setValueAtTime(0.08, audioContext.currentTime);
    masterGain.connect(audioContext.destination);

    const firstTone = audioContext.createOscillator();
    const firstGain = audioContext.createGain();
    firstTone.type = 'triangle';
    firstTone.frequency.setValueAtTime(740, audioContext.currentTime);
    firstGain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    firstGain.gain.exponentialRampToValueAtTime(1, audioContext.currentTime + 0.015);
    firstGain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.11);
    firstTone.connect(firstGain);
    firstGain.connect(masterGain);
    firstTone.start(audioContext.currentTime);
    firstTone.stop(audioContext.currentTime + 0.12);

    const secondTone = audioContext.createOscillator();
    const secondGain = audioContext.createGain();
    secondTone.type = 'triangle';
    secondTone.frequency.setValueAtTime(988, audioContext.currentTime + 0.14);
    secondGain.gain.setValueAtTime(0.0001, audioContext.currentTime + 0.14);
    secondGain.gain.exponentialRampToValueAtTime(1, audioContext.currentTime + 0.16);
    secondGain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.26);
    secondTone.connect(secondGain);
    secondGain.connect(masterGain);
    secondTone.start(audioContext.currentTime + 0.14);
    secondTone.stop(audioContext.currentTime + 0.28);

    secondTone.onended = () => {
      void audioContext.close();
    };
  }

  function openConversation(conversationId: string) {
    setSelectedConversationId(conversationId);
    setMode('chats');
    setIncomingToast(null);
    setUnreadCounts((prev) => {
      if (!prev[conversationId]) return prev;
      const next = { ...prev };
      delete next[conversationId];
      return next;
    });
  }

  function scheduleCloseMessageActions(messageId: string) {
    if (actionHoverTimeoutRef.current) {
      window.clearTimeout(actionHoverTimeoutRef.current);
    }
    actionHoverTimeoutRef.current = window.setTimeout(() => {
      setActiveMessageActionsId((current) => (current === messageId ? null : current));
      setDetailMenuMessageId((current) => (current === messageId ? null : current));
      actionHoverTimeoutRef.current = null;
    }, 600);
  }

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('profile');
    try {
      const updated = await api<User>('/auth/profile', token, {
        method: 'POST',
        body: JSON.stringify(profileForm),
      });
      setCurrentUser(updated);
      setNotice('Đã cập nhật tài khoản.');
    } catch (err) {
      handleGlobalApiError(err);
    } finally {
      setBusy(null);
    }
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('password');
    try {
      await api('/auth/change-password', token, {
        method: 'POST',
        body: JSON.stringify(passwordForm),
      });
      setPasswordForm({ currentPassword: '', newPassword: '' });
      setNotice('Đổi mật khẩu thành công.');
    } catch (err) {
      handleGlobalApiError(err);
    } finally {
      setBusy(null);
    }
  }

  async function submitDepartment() {
    setBusy('department');
    setDepartmentModalError(null);
    try {
      await api(editingDepartmentId ? `/departments/${editingDepartmentId}` : '/departments', token, {
        method: editingDepartmentId ? 'PATCH' : 'POST',
        body: JSON.stringify(departmentForm),
      });
      resetDepartmentEditor();
      setShowDepartmentCreateModal(false);
      setEditingDepartmentId(null);
      await refreshData();
      pushAdminNotice(editingDepartmentId ? 'Đã cập nhật phòng ban.' : 'Đã tạo phòng ban.');
    } catch (err) {
      pushScopedAdminError(err, 'department-modal');
    } finally {
      setBusy(null);
    }
  }

  async function submitUser() {
    setBusy('user');
    setUserModalError(null);
    try {
      const payload = {
        ...userForm,
        password: userForm.password.trim() ? userForm.password : undefined,
      };
      await api(editingUserId ? `/users/${editingUserId}` : '/users', token, {
        method: editingUserId ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      });
      resetUserEditor();
      setShowUserCreateModal(false);
      await refreshData();
      pushAdminNotice(editingUserId ? 'Đã cập nhật user.' : 'Đã tạo user.');
    } catch (err) {
      pushScopedAdminError(err, 'user-modal');
    } finally {
      setBusy(null);
    }
  }

  async function handleResetUserPassword() {
    if (!resetPasswordUser || resetPasswordValue.trim().length < 6) return;
    setBusy('reset-password');
    setResetPasswordModalError(null);
    try {
      await api(`/users/${resetPasswordUser.id}/reset-password`, token, {
        method: 'POST',
        body: JSON.stringify({ password: resetPasswordValue }),
      });
      setResetPasswordUser(null);
      setResetPasswordValue('');
      pushAdminNotice('Đã cấp lại mật khẩu.');
    } catch (err) {
      pushScopedAdminError(err, 'reset-password-modal');
    } finally {
      setBusy(null);
    }
  }

  function resetDepartmentEditor() {
    setEditingDepartmentId(null);
    setDepartmentForm({ name: '' });
  }

  function resetUserEditor() {
    setEditingUserId(null);
    setUserForm({
      username: '',
      fullName: '',
      avatarUrl: '',
      password: '',
      status: 'ACTIVE',
      departmentIds: [],
    });
  }

  function handleEditDepartment(department: Department) {
    setShowDepartmentCreateModal(false);
    clearAdminFeedback();
    setEditingDepartmentId(department.id);
    setDepartmentForm({
      name: department.name,
    });
    setMode('admin');
  }

  async function handleDeleteDepartment(id: string) {
    setBusy('department-delete');
    try {
      await api(`/departments/${id}`, token, { method: 'DELETE' });
      if (editingDepartmentId === id) {
        resetDepartmentEditor();
      }
      await refreshData();
      pushAdminNotice('Đã xóa phòng ban.');
    } catch (err) {
      pushScopedAdminError(err, 'admin');
    } finally {
      setBusy(null);
    }
  }

  function handleEditUser(user: AdminUser) {
    setShowUserCreateModal(false);
    clearAdminFeedback();
    setEditingUserId(user.id);
    setUserForm({
      username: user.username,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl ?? '',
      password: '',
      status: user.status,
      departmentIds: user.departments[0]?.departmentId ? [user.departments[0].departmentId] : [],
    });
    setMode('admin');
  }

  async function handleDeleteUser(id: string) {
    setBusy('user-delete');
    try {
      await api(`/users/${id}`, token, { method: 'DELETE' });
      if (editingUserId === id) {
        resetUserEditor();
      }
      await refreshData();
      pushAdminNotice('Đã xóa user.');
    } catch (err) {
      pushScopedAdminError(err, 'admin');
    } finally {
      setBusy(null);
    }
  }

  function isSameDepartmentSelection(left: string[], right: string[]) {
    const normalizedLeft = [...left].sort();
    const normalizedRight = [...right].sort();
    return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((value, index) => value === normalizedRight[index]);
  }

  async function handleAvatarUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy('avatar');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const uploaded = await api<AttachmentResponse>('/attachments', token, {
        method: 'POST',
        body: formData,
      });
      setProfileForm((prev) => ({ ...prev, avatarUrl: uploaded.downloadUrl }));
    } catch (err) {
      handleGlobalApiError(err);
    } finally {
      setBusy(null);
      event.target.value = '';
    }
  }

  function insertEmoji(emoji: string) {
    setMessageBody((prev) => `${prev}${emoji}`);
    setShowEmojiMenu(false);
  }

  function insertMention(user: { fullName: string }) {
    setMessageBody((prev) => prev.replace(/(?:^|\s)@([^\s@]*)$/, ` @${user.fullName} `));
  }

  function toggleGroupMember(userId: string) {
    setGroupForm((prev) => ({
      ...prev,
      memberIds: prev.memberIds.includes(userId)
        ? prev.memberIds.filter((id) => id !== userId)
        : [...prev.memberIds, userId],
    }));
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSendMessage();
    }
  }

  if (!currentUser) {
    return (
      <main className="login-screen">
        <div className="login-shell">
          <section className="login-card">
            <div className="login-brand">
              {desktopBranding.logoDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={desktopBranding.companyName}
                  className="brand-mark brand-mark-image"
                  src={desktopBranding.logoDataUrl}
                />
              ) : (
                <div className="brand-mark">
                  {getInitials(desktopBranding.companyName || 'Company Chat').slice(0, 1)}
                </div>
              )}
              <div>
                <strong>{desktopBranding.companyName || 'Company Chat'}</strong>
                <span>Trao đổi nội bộ</span>
              </div>
            </div>
            <form className="stack" onSubmit={handleLogin}>
              <input
                placeholder="Username"
                value={loginForm.username}
                onChange={(event) => setLoginForm((prev) => ({ ...prev, username: event.target.value }))}
              />
              <input
                type="password"
                placeholder="Password"
                value={loginForm.password}
                onChange={(event) => setLoginForm((prev) => ({ ...prev, password: event.target.value }))}
              />
              <button type="submit" disabled={busy === 'login'}>
                {busy === 'login' ? 'Đang đăng nhập...' : 'Đăng nhập'}
              </button>
            </form>
            {error ? <p className="error-banner">{error}</p> : null}
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="app-screen">
      {incomingToast ? (
        <button
          type="button"
          className="incoming-toast"
          onClick={() => {
            openConversation(incomingToast.conversationId);
          }}
        >
          <Avatar avatarUrl={incomingToast.avatarUrl} name={incomingToast.title} size="sm" />
          <div className="incoming-toast-copy">
            <strong>{incomingToast.title}</strong>
            <span>{incomingToast.body}</span>
          </div>
        </button>
      ) : null}

      {showGroupModal ? (
        <div className="modal-backdrop" onClick={() => setShowGroupModal(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <strong>Tạo nhóm mới</strong>
              <span>Chọn thành viên nội bộ và đặt tên nhóm.</span>
            </div>
            <form className="stack" onSubmit={handleCreateGroup}>
              <input
                placeholder="Tên nhóm"
                value={groupForm.title}
                onChange={(event) => setGroupForm((prev) => ({ ...prev, title: event.target.value }))}
              />
              <div className="modal-inline-search zalo-search-box">
                <SearchIcon />
                <input
                  placeholder="Tìm thành viên"
                  value={groupSearch}
                  onChange={(event) => setGroupSearch(event.target.value)}
                />
              </div>
              <div className="selected-members">
                {groupForm.memberIds.length ? (
                  groupForm.memberIds.map((memberId) => {
                    const member = directory.find((user) => user.id === memberId);
                    if (!member) return null;
                    return (
                      <button
                        key={memberId}
                        type="button"
                        className="selected-chip"
                        onClick={() => toggleGroupMember(memberId)}
                      >
                        {member.fullName}
                      </button>
                    );
                  })
                ) : (
                  <span className="selected-hint">Chưa chọn thành viên</span>
                )}
              </div>
              <div className="group-member-list">
                {groupCandidates.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    className={groupForm.memberIds.includes(user.id) ? 'group-member selected' : 'group-member'}
                    onClick={() => toggleGroupMember(user.id)}
                  >
                    <Avatar avatarUrl={user.avatarUrl} name={user.fullName} size="sm" />
                    <div className="group-member-copy">
                      <strong>{user.fullName}</strong>
                      <span>
                        {user.departments.length
                          ? user.departments.map((item) => item.department.name).join(', ')
                          : '@' + user.username}
                      </span>
                    </div>
                    <span className="group-member-check">{groupForm.memberIds.includes(user.id) ? 'Da chon' : ''}</span>
                  </button>
                ))}
              </div>
              <div className="modal-actions">
                <button type="button" className="ghost-action" onClick={() => setShowGroupModal(false)}>
                  Hủy
                </button>
                <button type="submit" disabled={busy === 'group' || groupForm.memberIds.length === 0 || !groupForm.title.trim()}>
                  OK
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showAddMembersModal ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            setShowAddMembersModal(false);
            setGroupMemberSelection([]);
          }}
        >
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <strong>Thêm thành viên vào nhóm</strong>
              <span>Chọn nhân viên nội bộ để thêm vào nhóm hiện tại.</span>
            </div>
            <div className="selected-members">
              {groupMemberSelection.length ? (
                groupMemberSelection.map((memberId) => {
                  const member = availableGroupMembers.find((user) => user.id === memberId);
                  if (!member) return null;
                  return (
                    <button
                      key={memberId}
                      type="button"
                      className="selected-chip"
                      onClick={() =>
                        setGroupMemberSelection((prev) => prev.filter((currentId) => currentId !== memberId))
                      }
                    >
                      {member.fullName}
                    </button>
                  );
                })
              ) : (
                <span className="selected-hint">Chưa chọn thành viên</span>
              )}
            </div>
            <div className="group-member-list">
              {availableGroupMembers.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  className={groupMemberSelection.includes(user.id) ? 'group-member selected' : 'group-member'}
                  onClick={() =>
                    setGroupMemberSelection((prev) =>
                      prev.includes(user.id) ? prev.filter((currentId) => currentId !== user.id) : [...prev, user.id],
                    )
                  }
                >
                  <Avatar avatarUrl={user.avatarUrl} name={user.fullName} size="sm" />
                  <div className="group-member-copy">
                    <strong>{user.fullName}</strong>
                    <span>
                      {user.departments.length
                        ? user.departments.map((item) => item.department.name).join(', ')
                        : '@' + user.username}
                    </span>
                  </div>
                  <span className="group-member-check">{groupMemberSelection.includes(user.id) ? 'Da chon' : ''}</span>
                </button>
              ))}
              {!availableGroupMembers.length ? <div className="attachment-empty">Không còn thành viên để thêm</div> : null}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="ghost-action"
                onClick={() => {
                  setShowAddMembersModal(false);
                  setGroupMemberSelection([]);
                }}
              >
                Hủy
              </button>
              <button type="button" disabled={busy === 'group-members-add' || !groupMemberSelection.length} onClick={() => void handleAddMembersToGroup()}>
                Thêm vào nhóm
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {detailMessage ? (
        <div className="modal-backdrop" onClick={() => setDetailMessage(null)}>
          <div className="modal-card detail-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <strong>Chi tiết tin nhắn</strong>
              <span>Thông tin đầy đủ về nội dung, thời gian và cảm xúc.</span>
            </div>
            <div className="stack detail-modal-body">
              <div className="detail-card detail-card-dark">
                <h3>Nội dung</h3>
                <p>{detailMessage.body || '(file đính kèm)'}</p>
              </div>
              <div className="detail-card detail-card-dark">
                <h3>Người gửi</h3>
                <p>{detailMessage.sender.fullName}</p>
              </div>
              <div className="detail-card detail-card-dark">
                <h3>Thời gian gửi</h3>
                <p>{formatMessageDateTime(detailMessage.createdAt)}</p>
              </div>
              <div className="detail-card detail-card-dark">
                <h3>Cảm xúc</h3>
                {detailMessage.reactions.length ? (
                  <div className="reaction-detail-list">
                    {detailMessage.reactions.map((reaction) => (
                      <div key={reaction.id} className="reaction-detail-row">
                        <strong>{reaction.emoji}</strong>
                        <span>{reaction.user.fullName}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p>Chưa có cảm xúc.</p>
                )}
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost-action" onClick={() => setDetailMessage(null)}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showDepartmentCreateModal ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            setShowDepartmentCreateModal(false);
            setDepartmentModalError(null);
            resetDepartmentEditor();
          }}
        >
          <div className="modal-card detail-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <strong>Tạo phòng ban</strong>
              <span>Nhập thông tin phòng ban mới.</span>
            </div>
            <div className="stack detail-modal-body">
              {departmentModalError ? <div className="error-banner inline">{departmentModalError}</div> : null}
              <input value={departmentForm.name} placeholder="Tên phòng ban" onChange={(event) => setDepartmentForm((prev) => ({ ...prev, name: event.target.value }))} />
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost-action" onClick={() => { setShowDepartmentCreateModal(false); setDepartmentModalError(null); resetDepartmentEditor(); }}>
                Hủy
              </button>
              <button type="button" disabled={busy === 'department' || !departmentForm.name.trim()} onClick={() => void submitDepartment()}>
                Tạo mới
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showUserCreateModal ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            setShowUserCreateModal(false);
            setUserModalError(null);
            resetUserEditor();
          }}
        >
          <div className="modal-card detail-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <strong>Tạo user</strong>
              <span>Nhập thông tin đăng nhập và hiển thị.</span>
            </div>
            <div className="stack detail-modal-body">
              {userModalError ? <div className="error-banner inline">{userModalError}</div> : null}
              <input value={userForm.fullName} placeholder="Tên hiển thị" onChange={(event) => setUserForm((prev) => ({ ...prev, fullName: event.target.value }))} />
              <input value={userForm.username} placeholder="Username" onChange={(event) => setUserForm((prev) => ({ ...prev, username: event.target.value }))} />
              <input type="password" value={userForm.password} placeholder="Mật khẩu" onChange={(event) => setUserForm((prev) => ({ ...prev, password: event.target.value }))} />
              <select value={userForm.status} onChange={(event) => setUserForm((prev) => ({ ...prev, status: event.target.value as 'ACTIVE' | 'INACTIVE' }))}>
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
              </select>
              <select
                value={userForm.departmentIds[0] ?? ''}
                onChange={(event) =>
                  setUserForm((prev) => ({
                    ...prev,
                    departmentIds: event.target.value ? [event.target.value] : [],
                  }))
                }
              >
                <option value="">Chọn phòng ban</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost-action" onClick={() => { setShowUserCreateModal(false); setUserModalError(null); resetUserEditor(); }}>
                Hủy
              </button>
              <button type="button" disabled={busy === 'user' || !userForm.fullName.trim() || !userForm.username.trim() || userForm.password.trim().length < 6} onClick={() => void submitUser()}>
                Tạo mới
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {resetPasswordUser ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            setResetPasswordUser(null);
            setResetPasswordValue('');
            setResetPasswordModalError(null);
          }}
        >
          <div className="modal-card detail-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <strong>Cấp lại mật khẩu</strong>
              <span>{resetPasswordUser.fullName}</span>
            </div>
            <div className="stack detail-modal-body">
              {resetPasswordModalError ? <div className="error-banner inline">{resetPasswordModalError}</div> : null}
              <input
                type="password"
                placeholder="Mật khẩu mới"
                value={resetPasswordValue}
                onChange={(event) => setResetPasswordValue(event.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="ghost-action"
                onClick={() => {
                  setResetPasswordUser(null);
                  setResetPasswordValue('');
                  setResetPasswordModalError(null);
                }}
              >
                Hủy
              </button>
              <button type="button" disabled={busy === 'reset-password' || resetPasswordValue.trim().length < 6} onClick={() => void handleResetUserPassword()}>
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteUserTarget ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            setDeleteUserTarget(null);
          }}
        >
          <div className="modal-card detail-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <strong>Xác nhận xóa user</strong>
              <span>{deleteUserTarget.fullName}</span>
            </div>
            <div className="stack detail-modal-body">
              <p>Bạn có chắc muốn xóa user này không?</p>
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost-action" onClick={() => setDeleteUserTarget(null)}>
                Hủy
              </button>
              <button
                type="button"
                disabled={busy === 'user-delete'}
                onClick={() => {
                  const targetId = deleteUserTarget.id;
                  setDeleteUserTarget(null);
                  void handleDeleteUser(targetId);
                }}
              >
                Xóa
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className={`messenger-shell ${mode === 'settings' || mode === 'admin' ? 'shell-settings' : ''}`}>
        <aside className="nav-rail">
          <div className="rail-top">
            <button type="button" className="avatar-rail-button" onClick={openSettingsScreen}>
              <Avatar avatarUrl={currentUser.avatarUrl} name={currentUser.fullName} size="md" />
            </button>
            <button
              type="button"
              className={mode === 'chats' ? 'rail-button active' : 'rail-button'}
              onClick={() => {
                setShowSettingsMenu(false);
                setMode('chats');
              }}
              aria-label="Tin nhắn"
            >
              <ChatIcon />
            </button>
            <button
              type="button"
              className={mode === 'contacts' ? 'rail-button active' : 'rail-button'}
              onClick={() => {
                setShowSettingsMenu(false);
                setMode('contacts');
              }}
              aria-label="Danh bạ"
            >
              <ContactsIcon />
            </button>
          </div>
          <div className="rail-bottom">
            {currentUser.isAdmin ? (
              <button
                type="button"
                className={mode === 'admin' ? 'rail-button active' : 'rail-button'}
                onClick={() => {
                  setShowSettingsMenu(false);
                  setMode('admin');
                }}
                aria-label="Quản trị"
              >
                <DashboardIcon />
              </button>
            ) : null}
            <div className="settings-menu-anchor" ref={settingsMenuRef}>
              {showSettingsMenu ? (
                <div className="settings-popover">
                  <button type="button" className="settings-popover-profile" onClick={openSettingsScreen}>
                    <Avatar avatarUrl={currentUser.avatarUrl} name={currentUser.fullName} size="md" />
                    <span className="settings-popover-profile-copy">
                      <strong>{currentUser.fullName}</strong>
                      <small>@{currentUser.username}</small>
                    </span>
                  </button>
                  <div className="settings-popover-section">
                    <button type="button" className="settings-popover-item" onClick={openSettingsScreen}>
                      <UserCircleIcon />
                      <span>Thông tin tài khoản</span>
                    </button>
                    <button type="button" className="settings-popover-item" onClick={openSettingsScreen}>
                      <SettingsIcon />
                      <span>Cài đặt</span>
                    </button>
                  </div>
                  <div className="settings-popover-section settings-popover-section-danger">
                    <button
                      type="button"
                      className="settings-popover-item settings-popover-item-danger"
                      onClick={() => {
                        setShowSettingsMenu(false);
                        void clearSession();
                      }}
                    >
                      <LogoutIcon />
                      <span>Đăng xuất</span>
                    </button>
                    {isDesktopApp ? (
                      <button type="button" className="settings-popover-item" onClick={() => void handleQuitDesktopApp()}>
                        <QuitIcon />
                        <span>Thoát</span>
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <button
                type="button"
                className={mode === 'settings' || showSettingsMenu ? 'rail-button active' : 'rail-button'}
                onClick={() => setShowSettingsMenu((prev) => !prev)}
                aria-label="Cài đặt"
              >
                <SettingsIcon />
              </button>
            </div>
          </div>
        </aside>

        {mode === 'admin' && currentUser.isAdmin ? (
          <section className="settings-screen admin-screen">
            <div className="settings-card admin-card">
              <div className="settings-header">
                <div>
                  <h2>Quản trị hệ thống</h2>
                  <p className="chat-subtitle">Dashboard nội bộ, quản lý phòng ban, user và nhật ký đăng nhập/chấm công.</p>
                </div>
                <button type="button" className="ghost-action" onClick={() => setMode('settings')}>
                  Về cài đặt
                </button>
              </div>
              {adminError ? <div className="error-banner inline">{adminError}</div> : null}
              {adminNotice ? <div className="notice-banner">{adminNotice}</div> : null}

              <div className="admin-overview-grid">
                <div className="detail-card detail-card-dark admin-overview-card">
                  <span>User</span>
                  <strong>{adminOverview?.users ?? adminUsers.length}</strong>
                </div>
                <div className="detail-card detail-card-dark admin-overview-card">
                  <span>Phòng ban</span>
                  <strong>{adminOverview?.departments ?? departments.length}</strong>
                </div>
                <div className="detail-card detail-card-dark admin-overview-card">
                  <span>Login hôm nay</span>
                  <strong>{adminOverview?.loginsToday ?? 0}</strong>
                </div>
                <div className="detail-card detail-card-dark admin-overview-card">
                  <span>Đang checkin</span>
                  <strong>{adminOverview?.activeAttendance ?? 0}</strong>
                </div>
              </div>

              <div className="admin-subnav">
                <button
                  type="button"
                  className={adminSection === 'departments' ? 'admin-subnav-button active' : 'admin-subnav-button'}
                  onClick={() => setAdminSection('departments')}
                >
                  Phòng ban
                </button>
                <button
                  type="button"
                  className={adminSection === 'users' ? 'admin-subnav-button active' : 'admin-subnav-button'}
                  onClick={() => setAdminSection('users')}
                >
                  User
                </button>
              </div>

              {adminSection === 'departments' ? (
                <section className="detail-card detail-card-dark admin-list-card">
                  <div className="admin-card-header admin-toolbar">
                    <div>
                      <h3>Danh sách phòng ban</h3>
                      <p>{departments.length} dòng dữ liệu</p>
                    </div>
                    <div className="admin-toolbar-actions">
                      <button
                        type="button"
                        className="admin-icon-button admin-icon-button-accent"
                        aria-label="Tạo mới phòng ban"
                        title="Tạo mới"
                        onClick={() => {
                          resetDepartmentEditor();
                          setShowDepartmentCreateModal(true);
                        }}
                      >
                        <PlusIcon />
                      </button>
                    </div>
                  </div>
                  <div className="admin-list-view">
                    <div className="admin-table-head admin-table-head-department">
                      <span>Tên phòng ban</span>
                      <span>Số nhân viên</span>
                      <span />
                    </div>
                    <div className="admin-table-body">
                      {departments.map((department) =>
                        editingDepartmentId === department.id ? (
                          <div key={department.id} className="admin-table-row admin-table-row-department admin-table-row-editing active">
                            <input
                              value={departmentForm.name}
                              placeholder="Tên phòng ban"
                              onChange={(event) => setDepartmentForm((prev) => ({ ...prev, name: event.target.value }))}
                            />
                            <span>{department.members?.length ?? 0}</span>
                            <span className="admin-row-actions">
                              <button type="button" className="admin-icon-button primary" onClick={() => void submitDepartment()}>
                                <SaveIcon />
                              </button>
                              <button type="button" className="admin-icon-button" onClick={resetDepartmentEditor}>
                                <ClearIcon />
                              </button>
                            </span>
                          </div>
                        ) : (
                          <div key={department.id} className="admin-table-row admin-table-row-department">
                            <strong>{department.name}</strong>
                            <span>{department.members?.length ?? 0}</span>
                            <span className="admin-row-actions">
                              <button type="button" className="admin-icon-button" onClick={() => handleEditDepartment(department)}>
                                <EditIcon />
                              </button>
                              <button
                                type="button"
                                className="admin-icon-button danger"
                                disabled={busy === 'department-delete'}
                                onClick={() => void handleDeleteDepartment(department.id)}
                              >
                                <TrashIcon />
                              </button>
                            </span>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                </section>
              ) : (
                <section className="detail-card detail-card-dark admin-list-card">
                  <div className="admin-card-header admin-toolbar">
                    <div>
                      <h3>Danh sách user</h3>
                      <p>{adminUsers.length} dòng dữ liệu</p>
                    </div>
                    <div className="admin-toolbar-actions">
                      <button
                        type="button"
                        className="admin-icon-button admin-icon-button-accent"
                        aria-label="Tạo mới user"
                        title="Tạo mới"
                        onClick={() => {
                          resetUserEditor();
                          setShowUserCreateModal(true);
                        }}
                      >
                        <PlusIcon />
                      </button>
                    </div>
                  </div>
                  <div className="admin-list-view">
                    <div className="admin-table-head admin-table-head-user">
                      <span>Tên hiển thị</span>
                      <span>Username</span>
                      <span>Trạng thái</span>
                      <span>Phòng ban</span>
                      <span>Lần cuối</span>
                      <span>IP cuối</span>
                      <span />
                    </div>
                    <div className="admin-table-body">
                      {adminUsers.map((user) =>
                        (() => {
                          const isEditing = editingUserId === user.id;
                          const isDirty =
                            isEditing &&
                            (userForm.fullName.trim() !== user.fullName ||
                              !isSameDepartmentSelection(
                                userForm.departmentIds,
                                user.departments.map((item) => item.departmentId),
                              ));

                          return (
                            <div
                              key={user.id}
                              className={
                                isEditing
                                  ? 'admin-table-row admin-table-row-user admin-table-row-editing active'
                                  : 'admin-table-row admin-table-row-user'
                              }
                            >
                              {isEditing ? (
                                <input
                                  value={userForm.fullName}
                                  onChange={(event) => setUserForm((prev) => ({ ...prev, fullName: event.target.value }))}
                                />
                              ) : (
                                <strong className="admin-cell-clickable" onClick={() => handleEditUser(user)}>
                                  {user.fullName}
                                </strong>
                              )}
                              <span>@{user.username}</span>
                              <span>{user.status}</span>
                              {isEditing ? (
                                <select
                                  value={userForm.departmentIds[0] ?? ''}
                                  onChange={(event) =>
                                    setUserForm((prev) => ({
                                      ...prev,
                                      departmentIds: event.target.value ? [event.target.value] : [],
                                    }))
                                  }
                                >
                                  <option value="">Chọn phòng ban</option>
                                  {departments.map((department) => (
                                    <option key={department.id} value={department.id}>
                                      {department.name}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span className="admin-cell-clickable" onClick={() => handleEditUser(user)}>
                                  {user.departments.map((item) => item.department.name).join(', ') || '-'}
                                </span>
                              )}
                              <span>{user.lastLoginAt ? formatMessageDateTime(user.lastLoginAt) : '-'}</span>
                              <span>{user.lastLoginIp || '-'}</span>
                              <span className="admin-row-actions">
                                {isDirty ? (
                                  <button type="button" className="admin-icon-button primary" onClick={() => void submitUser()}>
                                    <SaveIcon />
                                  </button>
                                ) : null}
                                <button type="button" className="admin-icon-button" onClick={() => setResetPasswordUser(user)}>
                                  <KeyIcon />
                                </button>
                                <button
                                  type="button"
                                  className="admin-icon-button danger"
                                  disabled={busy === 'user-delete' || user.username === 'admin'}
                                  onClick={() => setDeleteUserTarget(user)}
                                >
                                  <TrashIcon />
                                </button>
                              </span>
                            </div>
                          );
                        })(),
                      )}
                    </div>
                  </div>
                </section>
              )}

              <div className="admin-secondary-grid admin-secondary-grid-single">
                <div className="detail-card detail-card-dark stack admin-log-card">
                  <div className="admin-card-header">
                    <div>
                      <h3>Đăng nhập gần đây</h3>
                      <p>IP và thời gian login</p>
                    </div>
                  </div>
                  <div className="admin-table admin-log-table">
                    {(adminOverview?.recentLogins ?? []).map((item) => (
                      <div key={item.id} className="admin-row">
                        <div>
                          <strong>{item.user.fullName}</strong>
                          <span>{item.ipAddress || 'Không rõ IP'} · {formatMessageDateTime(item.loggedInAt)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : mode === 'settings' ? (
          <section className="settings-screen">
            <div className="settings-card">
              <div className="settings-header">
                <div>
                  <h2>Cài đặt tài khoản</h2>
                  <p className="chat-subtitle">Cập nhật ảnh đại diện, tên hiển thị và mật khẩu.</p>
                </div>
              </div>
              {error ? <div className="error-banner inline">{error}</div> : null}
              {notice ? <div className="notice-banner">{notice}</div> : null}
              <div className="settings-stack">
                <form className="detail-card detail-card-dark stack" onSubmit={handleSaveProfile}>
                  <h3>Thông tin cá nhân</h3>
                  <div className="profile-editor">
                    <Avatar avatarUrl={profileForm.avatarUrl} name={profileForm.fullName || currentUser.fullName} size="lg" />
                    <label className="secondary-action">
                      <input type="file" accept="image/*" onChange={handleAvatarUpload} />
                    {busy === 'avatar' ? 'Đang tải ảnh...' : 'Chọn ảnh đại diện'}
                    </label>
                  </div>
                  <input
                    placeholder="Tên hiển thị"
                    value={profileForm.fullName}
                    onChange={(event) => setProfileForm((prev) => ({ ...prev, fullName: event.target.value }))}
                  />
                  <button type="submit" disabled={busy === 'profile'}>
                    {busy === 'profile' ? 'Đang lưu...' : 'Lưu thay đổi'}
                  </button>
                </form>
                <form className="detail-card detail-card-dark stack" onSubmit={handleChangePassword}>
                  <h3>Đổi mật khẩu</h3>
                  <input
                    type="password"
                    placeholder="Mật khẩu hiện tại"
                    value={passwordForm.currentPassword}
                    onChange={(event) => setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))}
                  />
                  <input
                    type="password"
                    placeholder="Mật khẩu mới"
                    value={passwordForm.newPassword}
                    onChange={(event) => setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))}
                  />
                  <button type="submit" disabled={busy === 'password'}>
                    {busy === 'password' ? 'Đang lưu...' : 'Đổi mật khẩu'}
                  </button>
                </form>
              </div>
            </div>
          </section>
        ) : (
          <>
            <section className="conversation-column zalo-dark-panel">
              <div className="column-header">
                <div>
                  <h2>{mode === 'contacts' ? 'Danh bạ' : 'Tin nhắn'}</h2>
                  <p>{mode === 'contacts' ? `${directory.length} liên hệ` : `${conversations.length} cuộc trò chuyện`}</p>
                </div>
              </div>

              <div className="search-box zalo-search-box">
                <div className="search-input-shell">
                  <SearchIcon />
                  <input
                    placeholder={mode === 'contacts' ? 'Tìm liên hệ' : 'Tìm kiếm'}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                {mode === 'chats' ? (
                  <button type="button" className="icon-button create-group-button" onClick={() => setShowGroupModal(true)} aria-label="Tạo nhóm">
                    <GroupAddIcon />
                  </button>
                ) : null}
              </div>

              <div className="conversation-list zalo-conversation-list">
                {mode === 'chats'
                  ? filteredChats.map((conversation) => (
                      <button
                        key={conversation.id}
                        type="button"
                        className={selectedConversationId === conversation.id ? 'conversation-row selected' : 'conversation-row'}
                        onClick={() => openConversation(conversation.id)}
                      >
                        <Avatar
                          avatarUrl={
                            conversation.title
                              ? null
                              : conversation.members.find((member) => member.user.id !== currentUser.id)?.user.avatarUrl
                          }
                          name={getConversationTitle(conversation, currentUser.id)}
                          size="sm"
                        />
                        <div className="row-main">
                          <div className="conversation-title-line">
                            <strong>{getConversationTitle(conversation, currentUser.id)}</strong>
                            {conversation.type === 'GROUP' ? <span className="conversation-kind-badge">Nhóm</span> : null}
                          </div>
                          <span className="conversation-secondary">{getConversationDepartmentLabel(conversation)}</span>
                        </div>
                        {unreadCounts[conversation.id] ? (
                          <span className="unread-badge">{unreadCounts[conversation.id]}</span>
                        ) : null}
                      </button>
                    ))
                  : filteredContacts.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        className="conversation-row"
                        onClick={() => handleOpenDirect(user.id)}
                        disabled={busy === `direct-${user.id}`}
                      >
                        <Avatar avatarUrl={user.avatarUrl} name={user.fullName} size="sm" />
                        <div className="row-main">
                          <strong>{user.fullName}</strong>
                          <span>
                            {user.departments.length
                              ? user.departments.map((item) => item.department.name).join(', ')
                              : '@' + user.username}
                          </span>
                        </div>
                      </button>
                    ))}
              </div>
            </section>

            <section className="chat-column zalo-chat-shell">
              <div className="chat-topbar zalo-chat-topbar">
                <div className="chat-user">
                  <Avatar
                    avatarUrl={
                      selectedConversation?.title
                        ? null
                        : selectedConversation?.members.find((member) => member.user.id !== currentUser.id)?.user.avatarUrl
                    }
                    name={
                      selectedConversation
                        ? getConversationTitle(selectedConversation, currentUser.id)
                        : currentUser.fullName
                    }
                    size="md"
                  />
                  <div>
                    <strong>
                      {selectedConversation
                        ? getConversationTitle(selectedConversation, currentUser.id)
                        : 'Chọn một cuộc trò chuyện'}
                    </strong>
                    <span className="chat-subtitle">
                      {selectedConversation
                        ? selectedConversation.type === 'GROUP'
                          ? `${selectedConversation.members.length} thành viên`
                          : 'Truy cập gần đây'
                        : 'Mở chat từ danh bạ bên trái'}
                    </span>
                  </div>
                </div>
                {selectedConversation ? (
                  <div className="chat-toolbar">
                    <label className="chat-toolbar-field chat-toolbar-date">
                      <CalendarIcon />
                      <input
                        type="date"
                        value={conversationDateFilter}
                        onChange={(event) => setConversationDateFilter(event.target.value)}
                      />
                      {conversationDateFilter ? (
                        <button
                          type="button"
                          className="chat-toolbar-clear"
                          onClick={() => setConversationDateFilter('')}
                          aria-label="Xóa lọc ngày"
                        >
                          <ClearIcon />
                        </button>
                      ) : null}
                    </label>
                    <label className="chat-toolbar-field chat-toolbar-search">
                      <SearchIcon />
                      <input
                        type="search"
                        placeholder="Tìm tin nhắn"
                        value={conversationSearch}
                        onChange={(event) => setConversationSearch(event.target.value)}
                      />
                      {deferredConversationSearch.trim() ? (
                        <span className="chat-search-count">
                          {matchedMessageIds.length ? `${activeConversationSearchIndex + 1}/${matchedMessageIds.length}` : '0'}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="chat-toolbar-next"
                        onClick={gotoNextSearchResult}
                        disabled={!matchedMessageIds.length}
                        aria-label="Kết quả tiếp theo"
                      >
                        <NextIcon />
                      </button>
                    </label>
                  </div>
                ) : null}
              </div>

              {error ? <div className="error-banner inline">{error}</div> : null}
              {notice ? <div className="notice-banner">{notice}</div> : null}

              <div ref={messageStreamRef} className="message-stream zalo-message-stream">
                {!messageTimeline.length ? (
                  <div className="conversation-empty-state">
                    Không có tin nhắn phù hợp với bộ lọc hiện tại.
                  </div>
                ) : null}
                {messageTimeline.map((item) => {
                  if (item.type === 'date') {
                    return (
                      <div key={item.key} className="date-divider">
                        <span>{item.label}</span>
                      </div>
                    );
                  }

                  const message = item.message;
                  if (message.type === 'SYSTEM') {
                    return (
                      <div key={message.id} className="system-message-row">
                        <span>{message.body}</span>
                      </div>
                    );
                  }

                  const isSelf = message.sender.id === currentUser.id;
                  const hasAttachments = message.attachments.length > 0;
                  const isMatched = matchedMessageIds.includes(message.id);
                  const isActiveMatch = activeMatchedMessageId === message.id;
                  const reactionSummary = Object.entries(
                    (message.reactions ?? []).reduce<Record<string, number>>((accumulator, reaction) => {
                      accumulator[reaction.emoji] = (accumulator[reaction.emoji] ?? 0) + 1;
                      return accumulator;
                    }, {}),
                  );

                  return (
                    <div
                      key={message.id}
                      ref={(node) => {
                        messageItemRefs.current[message.id] = node;
                      }}
                      className={isSelf ? 'message-row self' : 'message-row'}
                      onMouseEnter={() => openMessageActions(message.id)}
                      onMouseLeave={() => scheduleCloseMessageActions(message.id)}
                    >
                      {isSelf ? (
                        <div className="message-avatar-spacer" />
                      ) : (
                        <Avatar avatarUrl={message.sender.avatarUrl} name={message.sender.fullName} size="sm" />
                      )}
                      <div className="message-stack">
                        <div className={isSelf ? 'message-interaction-zone self' : 'message-interaction-zone'}>
                          <div className="message-bubble-wrap">
                            <div
                              className={
                                isActiveMatch
                                  ? isSelf
                                    ? 'message self search-match search-match-active'
                                    : 'message search-match search-match-active'
                                  : isMatched
                                    ? isSelf
                                      ? 'message self search-match'
                                      : 'message search-match'
                                    : isSelf
                                      ? 'message self'
                                      : 'message'
                              }
                            >
                              {message.replyTo ? (
                                <div className="reply-preview">
                                  <strong>{message.replyTo.sender.fullName}</strong>
                                  <span>{message.replyTo.body || '(file đính kèm)'}</span>
                                </div>
                              ) : null}
                              {!isSelf ? <div className="message-author">{message.sender.fullName}</div> : null}
                              {message.body?.trim() ? <div className="message-body">{message.body}</div> : null}
                              {message.attachments.length ? (
                                <div className="message-files">
                                  {message.attachments.map((item) =>
                                    isImageAttachment(item.attachment.mimeType) ? (
                                      <a
                                        key={item.attachment.id}
                                        className="message-image-link"
                                        href={item.attachment.downloadUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                          className="message-image"
                                          src={item.attachment.downloadUrl}
                                          alt={item.attachment.originalName}
                                        />
                                      </a>
                                    ) : (
                                      <div key={item.attachment.id} className="message-file-card">
                                        <strong>{item.attachment.originalName}</strong>
                                        <span>{item.attachment.mimeType}</span>
                                      </div>
                                    ),
                                  )}
                                </div>
                              ) : null}
                              <div className="message-meta">
                                <span className="message-time">{formatMessageTime(message.createdAt)}</span>
                              </div>
                            </div>

                            <button
                              type="button"
                              className={
                                activeMessageActionsId === message.id
                                  ? isSelf
                                    ? 'message-reply-trigger self visible'
                                    : 'message-reply-trigger visible'
                                  : isSelf
                                    ? 'message-reply-trigger self'
                                    : 'message-reply-trigger'
                              }
                              onClick={() => handleReplyToMessage(message)}
                              aria-label="Trả lời"
                              onMouseEnter={() => openMessageActions(message.id)}
                            >
                              <ReplyIcon />
                            </button>

                            <div
                              className={
                                activeMessageActionsId === message.id || detailMenuMessageId === message.id
                                  ? isSelf
                                    ? 'message-detail-wrap self visible'
                                    : 'message-detail-wrap visible'
                                  : isSelf
                                    ? 'message-detail-wrap self'
                                    : 'message-detail-wrap'
                              }
                              onMouseEnter={() => openMessageActions(message.id)}
                              onMouseLeave={() => scheduleCloseMessageActions(message.id)}
                            >
                              <button
                                type="button"
                                className={isSelf ? 'message-detail-trigger self visible' : 'message-detail-trigger visible'}
                                onClick={() =>
                                  setDetailMenuMessageId((current) => (current === message.id ? null : message.id))
                                }
                                aria-label="Tùy chọn"
                              >
                                <MoreIcon />
                              </button>
                              {detailMenuMessageId === message.id ? (
                                <div className={isSelf ? 'message-detail-menu self' : 'message-detail-menu'}>
                                  <button
                                    type="button"
                                    className="message-detail-menu-item"
                                    onClick={() => {
                                      setDetailMessage(message);
                                      setDetailMenuMessageId(null);
                                    }}
                                  >
                                    Xem chi tiết
                                  </button>
                                  {hasAttachments
                                    ? message.attachments.map((item) => (
                                        <a
                                          key={item.attachment.id}
                                          className="message-detail-menu-item"
                                          href={item.attachment.downloadUrl}
                                          target="_blank"
                                          rel="noreferrer"
                                          onClick={() => setDetailMenuMessageId(null)}
                                        >
                                          {isImageAttachment(item.attachment.mimeType) ? 'Tải ảnh' : 'Tải tệp'}
                                        </a>
                                      ))
                                    : null}
                                </div>
                              ) : null}
                            </div>

                            <div
                              className={
                                activeMessageActionsId === message.id || activeReactionPickerId === message.id
                                  ? isSelf
                                    ? 'reaction-trigger-wrap self visible'
                                    : 'reaction-trigger-wrap visible'
                                  : isSelf
                                    ? 'reaction-trigger-wrap self'
                                    : 'reaction-trigger-wrap'
                              }
                              onMouseEnter={() => openReactionPicker(message.id)}
                              onMouseLeave={() => scheduleCloseReactionPicker(message.id)}
                            >
                              <button
                                type="button"
                                className="message-action-pill icon-action quick-react-trigger"
                                aria-label="Thả cảm xúc"
                                onClick={() => void handleReact(message.id, '👍')}
                              >
                                <LikeIcon />
                              </button>
                              <div
                                className={
                                  activeReactionPickerId === message.id
                                    ? isSelf
                                      ? 'reaction-menu self open'
                                      : 'reaction-menu open'
                                    : isSelf
                                      ? 'reaction-menu self'
                                      : 'reaction-menu'
                                }
                              >
                                <button type="button" className="message-action-pill" onClick={() => void handleReact(message.id, '👍')}>
                                  👍
                                </button>
                                <button type="button" className="message-action-pill" onClick={() => void handleReact(message.id, '❤️')}>
                                  ❤️
                                </button>
                                <button type="button" className="message-action-pill" onClick={() => void handleReact(message.id, '😂')}>
                                  😂
                                </button>
                                <button type="button" className="message-action-pill" onClick={() => void handleReact(message.id, '😮')}>
                                  😮
                                </button>
                                <button type="button" className="message-action-pill" onClick={() => void handleReact(message.id, '😭')}>
                                  😭
                                </button>
                                <button type="button" className="message-action-pill" onClick={() => void handleReact(message.id, '😡')}>
                                  😡
                                </button>
                              </div>
                            </div>

                            {reactionSummary.length ? (
                              <div className="reaction-bar anchored">
                                {reactionSummary.map(([emoji, count]) => (
                                  <button
                                    key={emoji}
                                    type="button"
                                    className="reaction-pill"
                                    onClick={() => void handleReact(message.id, emoji)}
                                  >
                                    <span>{emoji}</span>
                                    <strong>{count}</strong>
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <form className="composer-panel zalo-composer" onSubmit={handleSendMessage}>
                {replyTarget ? (
                  <div className="composer-reply">
                    <div>
                      <strong>Trả lời {replyTarget.sender.fullName}</strong>
                      <span>{replyTarget.body || '(file đính kèm)'}</span>
                    </div>
                    <button type="button" className="ghost-action reply-close" onClick={() => setReplyTarget(null)}>
                      Hủy
                    </button>
                  </div>
                ) : null}
                {mentionCandidates.length ? (
                  <div className="mention-popover">
                    {mentionCandidates.map((user) => (
                      <button key={user.id} type="button" className="mention-row" onClick={() => insertMention(user)}>
                        <Avatar avatarUrl={user.avatarUrl} name={user.fullName} size="sm" />
                        <span>{user.fullName}</span>
                      </button>
                    ))}
                  </div>
                ) : null}

                {showEmojiMenu ? (
                  <div className="emoji-popover">
                    {EMOJIS.map((emoji) => (
                      <button key={emoji} type="button" onClick={() => insertEmoji(emoji)}>
                        {emoji}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="composer-tools">
                  <label className="icon-button file-picker compact-picker">
                    <input type="file" accept="image/*" onChange={(event) => handleUpload(event, 'image')} />
                    <ImageIcon />
                  </label>
                  <label className="icon-button file-picker compact-picker">
                    <input type="file" onChange={(event) => handleUpload(event, 'file')} />
                    <AttachIcon />
                  </label>
                  <button type="button" className="icon-button" onClick={() => setShowEmojiMenu((prev) => !prev)}>
                    <SmileIcon />
                  </button>
                </div>
                <textarea
                  ref={composerInputRef}
                  placeholder={`Nhập @, tin nhắn tới ${
                    selectedConversation ? getConversationTitle(selectedConversation, currentUser.id) : currentUser.fullName
                  }`}
                  rows={3}
                  value={messageBody}
                  onChange={(event) => setMessageBody(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                />
                <div className="composer-bar">
                  {pendingAttachment ? <div className="attachment-chip">{pendingAttachment.originalName}</div> : null}
                  <button
                    type="button"
                    className="send-button icon-send-button"
                    onClick={() => void handleQuickLike()}
                    disabled={busy === 'message'}
                    aria-label={messageBody.trim() || pendingAttachment ? 'Gửi tin nhắn' : 'Gửi thích'}
                  >
                    {messageBody.trim() || pendingAttachment ? <SendIcon /> : <LikeIcon />}
                  </button>
                </div>
              </form>
            </section>

            <aside className="detail-column zalo-dark-panel detail-sidebar">
              <div className="detail-sidebar-header">Thông tin hội thoại</div>

              <section className="detail-card detail-card-dark compact-actions-card">
                <div className="quick-actions single-action">
                  <button
                    type="button"
                    className={isConversationMuted ? 'quick-action icon-only small-action active' : 'quick-action icon-only small-action'}
                    aria-label={isConversationMuted ? 'Bật thông báo' : 'Tắt thông báo'}
                    onClick={toggleConversationNotifications}
                    disabled={!selectedConversation}
                    title={isConversationMuted ? 'Bật thông báo' : 'Tắt thông báo'}
                  >
                    {isConversationMuted ? <BellOffIcon /> : <BellOnIcon />}
                  </button>
                </div>
              </section>

              {selectedConversation?.type !== 'GROUP' ? (
                <section className="detail-card detail-card-dark">
                  <div className="detail-row">
                    <span>Nhóm chung</span>
                    <strong>{sharedGroupCount}</strong>
                  </div>
                </section>
              ) : null}

              {selectedConversation?.type === 'GROUP' ? (
                <section className="detail-card detail-card-dark">
                  <div className="group-manage-header">
                    <h3>Thành viên nhóm</h3>
                    {isGroupOwner ? (
                      <button
                        type="button"
                        className="admin-icon-button admin-icon-button-accent"
                        aria-label="Thêm thành viên"
                        onClick={() => setShowAddMembersModal(true)}
                      >
                        <PlusIcon />
                      </button>
                    ) : null}
                  </div>
                  <div className="group-member-sidebar-list">
                    {selectedConversation.members.map((member) => (
                      <div key={member.user.id} className="group-member-sidebar-row">
                        <div className="group-member-sidebar-main">
                          <Avatar avatarUrl={member.user.avatarUrl} name={member.user.fullName} size="sm" />
                          <div className="group-member-sidebar-copy">
                            <strong>{member.user.fullName}</strong>
                            <span>{member.role === 'OWNER' ? 'Chủ nhóm' : 'Thành viên'}</span>
                          </div>
                        </div>
                        {isGroupOwner && member.user.id !== currentUser.id ? (
                          <button
                            type="button"
                            className="admin-icon-button danger"
                            aria-label="Xóa thành viên"
                            disabled={busy === `group-member-remove-${member.user.id}`}
                            onClick={() => void handleRemoveMemberFromGroup(member.user.id)}
                          >
                            <TrashIcon />
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {isGroupOwner ? (
                    <button
                      type="button"
                      className="group-danger-button"
                      disabled={busy === 'group-dissolve'}
                      onClick={() => void handleDissolveGroup()}
                    >
                      Giải tán nhóm
                    </button>
                  ) : null}
                </section>
              ) : null}

              <section className="detail-card detail-card-dark">
                <h3>Ảnh / Video</h3>
                <div className="attachment-grid">
                  {recentAttachments.length ? (
                    recentAttachments.map((item) => (
                      <div className="attachment-tile" key={item.attachment.id}>
                        <span>{item.attachment.originalName.slice(0, 18)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="attachment-empty">Chưa có file đính kèm</div>
                  )}
                </div>
              </section>

              <section className="detail-card detail-card-dark">
                <h3>File</h3>
                <div className="file-list">
                  {recentAttachments.length ? (
                    recentAttachments.slice(0, 3).map((item) => (
                      <div className="file-row" key={item.attachment.id}>
                        <div className="file-icon">{item.attachment.originalName[0]}</div>
                        <div>
                          <strong>{item.attachment.originalName}</strong>
                          <span>{item.attachment.mimeType}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="attachment-empty">Chưa có file</div>
                  )}
                </div>
              </section>
            </aside>
          </>
        )}
      </div>
    </main>
  );
}
