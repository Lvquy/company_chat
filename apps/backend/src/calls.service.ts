import { BadRequestException, Injectable } from '@nestjs/common';
import { CallKind, CallStatus, ConversationType, MessageType, UserStatus } from '@prisma/client';
import { ChatGateway } from './chat.gateway';
import { LiveKitService } from './livekit.service';
import { PrismaService } from './prisma.service';

const callInclude = {
  initiator: {
    select: {
      id: true,
      username: true,
      fullName: true,
      avatarUrl: true,
    },
  },
  recipient: {
    select: {
      id: true,
      username: true,
      fullName: true,
      avatarUrl: true,
      status: true,
    },
  },
} as const;

@Injectable()
export class CallsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatGateway: ChatGateway,
    private readonly liveKit: LiveKitService,
  ) {}

  private emit(call: { conversationId: string; status: CallStatus } & Record<string, unknown>, event: 'call:incoming' | 'call:updated') {
    this.chatGateway.emitToConversation(call.conversationId, event, call);
  }

  private formatDateTime(value: Date) {
    return new Intl.DateTimeFormat('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(value);
  }

  private formatDuration(startedAt: Date, endedAt: Date) {
    const totalSeconds = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours) return `${hours} giờ ${minutes} phút ${seconds} giây`;
    if (minutes) return `${minutes} phút ${seconds} giây`;
    return `${seconds} giây`;
  }

  private async publishCallHistory(call: {
    conversationId: string;
    initiatorId: string;
    kind: CallKind;
    status: CallStatus;
    createdAt: Date;
    answeredAt: Date | null;
    endedAt: Date | null;
  }) {
    const label = call.kind === CallKind.VIDEO ? 'Cuộc gọi video' : 'Cuộc gọi thoại';
    const startedAt = call.answeredAt ?? call.createdAt;
    const endedAt = call.endedAt ?? new Date();
    const statusLabel =
      call.status === CallStatus.ENDED
        ? `Thời lượng ${this.formatDuration(startedAt, endedAt)}`
        : call.status === CallStatus.DECLINED
          ? 'Đã từ chối'
          : call.status === CallStatus.MISSED
            ? 'Cuộc gọi nhỡ'
            : 'Đã hủy';
    const message = await this.prisma.message.create({
      data: {
        conversationId: call.conversationId,
        senderId: call.initiatorId,
        type: MessageType.SYSTEM,
        body: `${label} lúc ${this.formatDateTime(startedAt)} · ${statusLabel}`,
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
    });

    await this.prisma.conversation.update({
      where: { id: call.conversationId },
      data: { lastMessageAt: message.createdAt },
    });
    this.chatGateway.emitToConversation(call.conversationId, 'message:new', {
      ...message,
      attachments: [],
      reactions: [],
    });
  }

  private async getCallForParticipant(callId: string, userId: string) {
    const call = await this.prisma.call.findUnique({
      where: { id: callId },
      include: callInclude,
    });

    if (!call) {
      throw new BadRequestException('Call not found');
    }

    if (call.initiatorId !== userId && call.recipientId !== userId) {
      throw new BadRequestException('You do not have access to this call');
    }

    return call;
  }

  async findAll(userId: string, conversationId?: string) {
    if (conversationId) {
      const membership = await this.prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId, userId } },
      });
      if (!membership) {
        throw new BadRequestException('You do not have access to this conversation');
      }
    }

    return this.prisma.call.findMany({
      where: {
        ...(conversationId ? { conversationId } : {}),
        OR: [{ initiatorId: userId }, { recipientId: userId }],
      },
      include: callInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async start(initiatorId: string, conversationId: string, kind: CallKind = CallKind.AUDIO) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        members: {
          select: {
            userId: true,
            user: {
              select: { status: true },
            },
          },
        },
      },
    });

    if (!conversation || conversation.type !== ConversationType.DIRECT || conversation.members.length !== 2) {
      throw new BadRequestException('Voice calls are only available in direct conversations');
    }

    const recipient = conversation.members.find((member) => member.userId !== initiatorId);
    const initiatorIsMember = conversation.members.some((member) => member.userId === initiatorId);
    if (!initiatorIsMember || !recipient) {
      throw new BadRequestException('You do not have access to this conversation');
    }

    if (recipient.user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('The recipient is inactive');
    }

    const existingCall = await this.prisma.call.findFirst({
      where: {
        conversationId,
        status: { in: [CallStatus.RINGING, CallStatus.ACTIVE] },
      },
      select: { id: true },
    });
    if (existingCall) {
      throw new BadRequestException('A call is already in progress for this conversation');
    }

    const callId = crypto.randomUUID();
    const call = await this.prisma.call.create({
      data: {
        id: callId,
        conversationId,
        initiatorId,
        recipientId: recipient.userId,
        roomName: `call-${callId}`,
        kind,
      },
      include: callInclude,
    });

    this.emit(call, 'call:incoming');
    return call;
  }

  async accept(userId: string, callId: string) {
    const call = await this.getCallForParticipant(callId, userId);
    if (call.recipientId !== userId || call.status !== CallStatus.RINGING) {
      throw new BadRequestException('This call cannot be accepted');
    }

    const updated = await this.prisma.call.update({
      where: { id: callId },
      data: { status: CallStatus.ACTIVE, answeredAt: new Date() },
      include: callInclude,
    });
    this.emit(updated, 'call:updated');
    return updated;
  }

  async join(userId: string, callId: string) {
    const call = await this.getCallForParticipant(callId, userId);
    if (call.status !== CallStatus.ACTIVE) {
      throw new BadRequestException('This call is not active');
    }

    const participant = call.initiatorId === userId ? call.initiator : call.recipient;
    return this.liveKit.createAudioCallToken(call.roomName, participant);
  }

  async decline(userId: string, callId: string) {
    const call = await this.getCallForParticipant(callId, userId);
    if (call.recipientId !== userId || call.status !== CallStatus.RINGING) {
      throw new BadRequestException('This call cannot be declined');
    }

    const updated = await this.prisma.call.update({
      where: { id: callId },
      data: { status: CallStatus.DECLINED, endedAt: new Date() },
      include: callInclude,
    });
    await this.publishCallHistory(updated);
    this.emit(updated, 'call:updated');
    return updated;
  }

  async cancel(userId: string, callId: string) {
    const call = await this.getCallForParticipant(callId, userId);
    if (call.initiatorId !== userId || call.status !== CallStatus.RINGING) {
      throw new BadRequestException('This call cannot be cancelled');
    }

    const updated = await this.prisma.call.update({
      where: { id: callId },
      data: { status: CallStatus.CANCELLED, endedAt: new Date() },
      include: callInclude,
    });
    await this.publishCallHistory(updated);
    this.emit(updated, 'call:updated');
    return updated;
  }

  async end(userId: string, callId: string) {
    const call = await this.getCallForParticipant(callId, userId);
    if (call.status !== CallStatus.RINGING && call.status !== CallStatus.ACTIVE) {
      throw new BadRequestException('This call has already ended');
    }

    const status = call.status === CallStatus.RINGING
      ? call.initiatorId === userId
        ? CallStatus.CANCELLED
        : CallStatus.MISSED
      : CallStatus.ENDED;
    const updated = await this.prisma.call.update({
      where: { id: callId },
      data: { status, endedAt: new Date() },
      include: callInclude,
    });
    await this.publishCallHistory(updated);
    this.emit(updated, 'call:updated');
    return updated;
  }
}
