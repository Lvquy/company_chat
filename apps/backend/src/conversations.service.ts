import { BadRequestException, Injectable } from '@nestjs/common';
import { ConversationRole, ConversationType, MessageType } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { StorageService } from './storage.service';

type CreateConversationInput = {
  type: 'DIRECT' | 'GROUP';
  title?: string;
  createdById: string;
  memberIds: string[];
};

type CreateMessageInput = {
  conversationId: string;
  senderId: string;
  body?: string;
  attachmentIds?: string[];
  replyToId?: string;
};

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private async enrichMessage<T extends { attachments: Array<{ attachment: { storageKey: string } }> }>(message: T) {
    return {
      ...message,
      attachments: await Promise.all(
        message.attachments.map(async (item) => ({
          ...item,
          attachment: {
            ...item.attachment,
            downloadUrl: await this.storage.getDownloadUrl(item.attachment.storageKey),
          },
        })),
      ),
    };
  }

  private conversationMemberSelect = {
    id: true,
    role: true,
    joinedAt: true,
    user: {
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        avatarUrl: true,
        status: true,
      },
    },
  } as const;

  private async createSystemMessage(conversationId: string, body: string, senderId: string) {
    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderId,
        body,
        type: MessageType.SYSTEM,
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            email: true,
            fullName: true,
            avatarUrl: true,
            status: true,
          },
        },
        attachments: {
          include: {
            attachment: true,
          },
        },
        replyTo: {
          select: {
            id: true,
            body: true,
            createdAt: true,
            sender: {
              select: {
                id: true,
                fullName: true,
                username: true,
                avatarUrl: true,
              },
            },
          },
        },
        reactions: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: message.createdAt },
    });

    return this.enrichMessage(message);
  }

  private async assertConversationMember(conversationId: string, userId: string) {
    const membership = await this.prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId,
          userId,
        },
      },
      select: {
        conversationId: true,
        userId: true,
      },
    });

    if (!membership) {
      throw new BadRequestException('You do not have access to this conversation');
    }

    return membership;
  }

  private async assertGroupOwner(conversationId: string, ownerId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        members: {
          select: this.conversationMemberSelect,
        },
      },
    });

    if (!conversation) {
      throw new BadRequestException('Conversation not found');
    }

    if (conversation.type !== ConversationType.GROUP) {
      throw new BadRequestException('Only group conversations support this action');
    }

    if (conversation.createdById !== ownerId) {
      throw new BadRequestException('Only the group owner can manage this group');
    }

    return conversation;
  }

  async findAll(userId?: string) {
    return this.prisma.conversation.findMany({
      where: userId
        ? {
            members: {
              some: {
                userId,
              },
            },
          }
        : undefined,
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        members: {
          select: this.conversationMemberSelect,
        },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  async findOrCreateDirect(currentUserId: string, targetUserId: string) {
    const existing = await this.prisma.conversation.findFirst({
      where: {
        type: ConversationType.DIRECT,
        members: {
          every: {
            userId: {
              in: [currentUserId, targetUserId],
            },
          },
          some: {
            userId: currentUserId,
          },
        },
      },
      include: {
        members: {
          select: this.conversationMemberSelect,
        },
      },
    });

    if (existing) {
      return existing;
    }

    return this.create({
      type: 'DIRECT',
      createdById: currentUserId,
      memberIds: [targetUserId],
    });
  }

  async create(input: CreateConversationInput) {
    const uniqueMemberIds = Array.from(new Set([input.createdById, ...input.memberIds]));

    if (!input.createdById) {
      throw new BadRequestException('createdById is required');
    }

    if (input.type === 'DIRECT' && uniqueMemberIds.length !== 2) {
      throw new BadRequestException('Direct conversation requires exactly 2 members');
    }

    if (input.type === 'GROUP' && uniqueMemberIds.length < 2) {
      throw new BadRequestException('Group conversation requires at least 2 members');
    }

    return this.prisma.conversation.create({
      data: {
        type: input.type === 'GROUP' ? ConversationType.GROUP : ConversationType.DIRECT,
        title: input.type === 'GROUP' ? input.title?.trim() || 'New Group' : null,
        createdById: input.createdById,
        members: {
          create: uniqueMemberIds.map((userId) => ({
            userId,
            role:
              userId === input.createdById
                ? ConversationRole.OWNER
                : ConversationRole.MEMBER,
          })),
        },
      },
      include: {
        members: {
          select: this.conversationMemberSelect,
        },
      },
    });
  }

  async findMessages(conversationId: string, userId: string) {
    await this.assertConversationMember(conversationId, userId);

    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            email: true,
            fullName: true,
            avatarUrl: true,
            status: true,
          },
        },
        attachments: {
          include: {
            attachment: true,
          },
        },
        replyTo: {
          select: {
            id: true,
            body: true,
            createdAt: true,
            sender: {
              select: {
                id: true,
                fullName: true,
                username: true,
                avatarUrl: true,
              },
            },
          },
        },
        reactions: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    return Promise.all(messages.map((message) => this.enrichMessage(message)));
  }

  async createMessage(input: CreateMessageInput) {
    if (!input.body?.trim() && !input.attachmentIds?.length) {
      throw new BadRequestException('Message body or attachment is required');
    }

    await this.assertConversationMember(input.conversationId, input.senderId);

    const attachmentKinds = input.attachmentIds?.length
      ? await this.prisma.attachment.findMany({
          where: { id: { in: input.attachmentIds } },
        })
      : [];

    const hasImage = attachmentKinds.some((attachment) =>
      attachment.mimeType.startsWith('image/'),
    );

    const type =
      input.attachmentIds?.length && input.body?.trim()
        ? MessageType.MIXED
        : hasImage
          ? MessageType.IMAGE
          : input.attachmentIds?.length
            ? MessageType.FILE
            : MessageType.TEXT;

    const message = await this.prisma.message.create({
      data: {
        conversationId: input.conversationId,
        senderId: input.senderId,
        replyToId: input.replyToId ?? null,
        body: input.body?.trim() || null,
        type,
        attachments: input.attachmentIds?.length
          ? {
              create: input.attachmentIds.map((attachmentId) => ({ attachmentId })),
            }
          : undefined,
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            email: true,
            fullName: true,
            avatarUrl: true,
            status: true,
          },
        },
        attachments: {
          include: {
            attachment: true,
          },
        },
        replyTo: {
          select: {
            id: true,
            body: true,
            createdAt: true,
            sender: {
              select: {
                id: true,
                fullName: true,
                username: true,
                avatarUrl: true,
              },
            },
          },
        },
        reactions: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    await this.prisma.conversation.update({
      where: { id: input.conversationId },
      data: { lastMessageAt: message.createdAt },
    });

    return this.enrichMessage(message);
  }

  async reactToMessage(messageId: string, userId: string, emoji: string) {
    if (!emoji.trim()) {
      throw new BadRequestException('emoji is required');
    }

    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        conversationId: true,
      },
    });

    if (!message) {
      throw new BadRequestException('Message not found');
    }

    await this.assertConversationMember(message.conversationId, userId);

    const existing = await this.prisma.messageReaction.findFirst({
      where: {
        messageId,
        userId,
      },
    });

    if (existing) {
      if (existing.emoji === emoji) {
        await this.prisma.messageReaction.delete({
          where: { id: existing.id },
        });
      } else {
        await this.prisma.messageReaction.update({
          where: { id: existing.id },
          data: { emoji },
        });
      }
    } else {
      await this.prisma.messageReaction.create({
        data: {
          messageId,
          userId,
          emoji,
        },
      });
    }

    const updatedMessage = await this.prisma.message.findUniqueOrThrow({
      where: { id: messageId },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            email: true,
            fullName: true,
            avatarUrl: true,
            status: true,
          },
        },
        attachments: {
          include: {
            attachment: true,
          },
        },
        replyTo: {
          select: {
            id: true,
            body: true,
            createdAt: true,
            sender: {
              select: {
                id: true,
                fullName: true,
                username: true,
                avatarUrl: true,
              },
            },
          },
        },
        reactions: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    return this.enrichMessage(updatedMessage);
  }

  async addGroupMembers(conversationId: string, ownerId: string, memberIds: string[]) {
    const conversation = await this.assertGroupOwner(conversationId, ownerId);
    const uniqueMemberIds = Array.from(new Set(memberIds.filter(Boolean))).filter(
      (memberId) => !conversation.members.some((member) => member.user.id === memberId),
    );

    if (!uniqueMemberIds.length) {
      return conversation;
    }

    const usersToAdd = await this.prisma.user.findMany({
      where: {
        id: { in: uniqueMemberIds },
      },
      select: {
        id: true,
        fullName: true,
      },
    });

    if (!usersToAdd.length) {
      throw new BadRequestException('No valid members to add');
    }

    await this.prisma.conversationMember.createMany({
      data: usersToAdd.map((user) => ({
        conversationId,
        userId: user.id,
        role: ConversationRole.MEMBER,
      })),
      skipDuplicates: true,
    });

    await this.createSystemMessage(
      conversationId,
      `${conversation.members.find((member) => member.user.id === ownerId)?.user.fullName ?? 'Chủ nhóm'} đã thêm ${usersToAdd
        .map((user) => user.fullName)
        .join(', ')} vào nhóm`,
      ownerId,
    );

    return this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: {
        members: {
          select: this.conversationMemberSelect,
        },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  async removeGroupMember(conversationId: string, ownerId: string, memberId: string) {
    const conversation = await this.assertGroupOwner(conversationId, ownerId);
    const targetMember = conversation.members.find((member) => member.user.id === memberId);

    if (!targetMember) {
      throw new BadRequestException('Member not found in this group');
    }

    if (memberId === ownerId) {
      throw new BadRequestException('Group owner cannot be removed');
    }

    await this.prisma.conversationMember.delete({
      where: {
        conversationId_userId: {
          conversationId,
          userId: memberId,
        },
      },
    });

    await this.createSystemMessage(
      conversationId,
      `${conversation.members.find((member) => member.user.id === ownerId)?.user.fullName ?? 'Chủ nhóm'} đã xóa ${targetMember.user.fullName} khỏi nhóm`,
      ownerId,
    );

    return this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: {
        members: {
          select: this.conversationMemberSelect,
        },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  async dissolveGroup(conversationId: string, ownerId: string) {
    await this.assertGroupOwner(conversationId, ownerId);
    await this.prisma.conversation.delete({
      where: { id: conversationId },
    });
    return { ok: true };
  }
}
