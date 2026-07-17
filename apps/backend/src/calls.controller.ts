import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { AuthGuard } from './auth.guard';
import { AuthUser } from './auth.types';
import { CallsService } from './calls.service';
import { CurrentUser } from './current-user.decorator';

class StartCallDto {
  @IsString()
  conversationId!: string;

  @IsOptional()
  @IsIn(['AUDIO', 'VIDEO'])
  kind?: 'AUDIO' | 'VIDEO';
}

@Controller('calls')
@UseGuards(AuthGuard)
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query('conversationId') conversationId?: string) {
    return this.callsService.findAll(user.sub, conversationId);
  }

  @Post()
  start(@CurrentUser() user: AuthUser, @Body() dto: StartCallDto) {
    return this.callsService.start(user.sub, dto.conversationId, dto.kind);
  }

  @Post(':callId/accept')
  accept(@CurrentUser() user: AuthUser, @Param('callId') callId: string) {
    return this.callsService.accept(user.sub, callId);
  }

  @Post(':callId/join')
  join(@CurrentUser() user: AuthUser, @Param('callId') callId: string) {
    return this.callsService.join(user.sub, callId);
  }

  @Post(':callId/decline')
  decline(@CurrentUser() user: AuthUser, @Param('callId') callId: string) {
    return this.callsService.decline(user.sub, callId);
  }

  @Post(':callId/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('callId') callId: string) {
    return this.callsService.cancel(user.sub, callId);
  }

  @Post(':callId/end')
  end(@CurrentUser() user: AuthUser, @Param('callId') callId: string) {
    return this.callsService.end(user.sub, callId);
  }
}
