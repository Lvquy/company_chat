import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { IsArray, IsOptional, IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { AuthUser } from './auth.types';
import { ConversationsService } from './conversations.service';

class JoinConversationDto {
  @IsString()
  conversationId!: string;
}

class SendMessageDto {
  @IsString()
  conversationId!: string;

  @IsString()
  @MinLength(1)
  body!: string;

  @IsOptional()
  @IsArray()
  attachmentIds?: string[];

  @IsOptional()
  @IsString()
  replyToId?: string;
}

@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: process.env.APP_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly authService: AuthService,
  ) {}

  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket) {
    const bearer =
      typeof client.handshake.auth?.token === 'string'
        ? client.handshake.auth.token
        : typeof client.handshake.headers.authorization === 'string'
          ? client.handshake.headers.authorization
          : '';

    const token = bearer.startsWith('Bearer ') ? bearer.slice('Bearer '.length) : bearer;
    if (!token) {
      client.disconnect(true);
      throw new UnauthorizedException('Missing bearer token');
    }

    client.data.authUser = this.authService.verifyToken(token);
    client.emit('connected', {
      clientId: client.id,
      serverTime: new Date().toISOString(),
    });
  }

  handleDisconnect(client: Socket) {
    this.server.emit('presence:update', {
      clientId: client.id,
      online: false,
    });
  }

  emitToConversation(conversationId: string, event: string, payload: unknown) {
    this.server.to(conversationId).emit(event, payload);
  }

  @SubscribeMessage('conversation:join')
  async joinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinConversationDto,
  ) {
    const authUser = client.data.authUser as AuthUser | undefined;
    if (!authUser) {
      throw new UnauthorizedException('Missing socket auth');
    }

    await this.conversationsService.findMessages(payload.conversationId, authUser.sub);
    await client.join(payload.conversationId);
    return {
      event: 'conversation:joined',
      data: payload,
    };
  }

  @SubscribeMessage('message:send')
  async sendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SendMessageDto,
  ) {
    const authUser = client.data.authUser as AuthUser | undefined;
    if (!authUser) {
      throw new UnauthorizedException('Missing socket auth');
    }

    if (!payload.body?.trim() && !(payload.attachmentIds?.length ?? 0)) {
      throw new BadRequestException('Message body or attachment is required');
    }

    const message = await this.conversationsService.createMessage({
      conversationId: payload.conversationId,
      senderId: authUser.sub,
      body: payload.body,
      attachmentIds: payload.attachmentIds ?? [],
      replyToId: payload.replyToId,
    });

    client.to(payload.conversationId).emit('message:new', message);
    client.emit('message:ack', message);

    return {
      event: 'message:sent',
      data: message,
    };
  }
}
