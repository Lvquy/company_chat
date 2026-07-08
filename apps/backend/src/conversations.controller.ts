import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './auth.types';
import { IsArray, IsOptional, IsString, MinLength } from 'class-validator';
import { ConversationsService } from './conversations.service';

class CreateConversationDto {
  @IsString()
  type!: 'DIRECT' | 'GROUP';

  @IsOptional()
  @IsString()
  title?: string;

  @IsArray()
  memberIds!: string[];
}

class CreateMessageDto {
  @IsString()
  conversationId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  body?: string;

  @IsOptional()
  @IsArray()
  attachmentIds?: string[];

  @IsOptional()
  @IsString()
  replyToId?: string;
}

class ReactMessageDto {
  @IsString()
  emoji!: string;
}

class UpdateGroupMembersDto {
  @IsArray()
  memberIds!: string[];
}

@Controller('conversations')
@UseGuards(AuthGuard)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.conversationsService.findAll(user.sub);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateConversationDto) {
    return this.conversationsService.create({
      ...dto,
      createdById: user.sub,
    });
  }

  @Post('direct')
  createDirect(@CurrentUser() user: AuthUser, @Body('targetUserId') targetUserId: string) {
    return this.conversationsService.findOrCreateDirect(user.sub, targetUserId);
  }

  @Get('messages')
  findMessages(@CurrentUser() user: AuthUser, @Query('conversationId') conversationId: string) {
    return this.conversationsService.findMessages(conversationId, user.sub);
  }

  @Post('messages')
  createMessage(@CurrentUser() user: AuthUser, @Body() dto: CreateMessageDto) {
    return this.conversationsService.createMessage({
      ...dto,
      senderId: user.sub,
    });
  }

  @Post('messages/:messageId/reactions')
  reactToMessage(
    @CurrentUser() user: AuthUser,
    @Param('messageId') messageId: string,
    @Body() dto: ReactMessageDto,
  ) {
    return this.conversationsService.reactToMessage(messageId, user.sub, dto.emoji);
  }

  @Post(':conversationId/members')
  addGroupMembers(
    @CurrentUser() user: AuthUser,
    @Param('conversationId') conversationId: string,
    @Body() dto: UpdateGroupMembersDto,
  ) {
    return this.conversationsService.addGroupMembers(conversationId, user.sub, dto.memberIds);
  }

  @Delete(':conversationId/members/:memberId')
  removeGroupMember(
    @CurrentUser() user: AuthUser,
    @Param('conversationId') conversationId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.conversationsService.removeGroupMember(conversationId, user.sub, memberId);
  }

  @Delete(':conversationId')
  dissolveGroup(@CurrentUser() user: AuthUser, @Param('conversationId') conversationId: string) {
    return this.conversationsService.dissolveGroup(conversationId, user.sub);
  }
}
