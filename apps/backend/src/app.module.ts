import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AdminGuard } from './admin.guard';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AttachmentsController } from './attachments.controller';
import { AttendanceController } from './attendance.controller';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { ChatGateway } from './chat.gateway';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';
import { PrismaService } from './prisma.service';
import { SetupController } from './setup.controller';
import { StorageService } from './storage.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
  ],
  controllers: [
    AppController,
    AdminController,
    AuthController,
    AttendanceController,
    SetupController,
    UsersController,
    DepartmentsController,
    ConversationsController,
    AttachmentsController,
  ],
  providers: [
    AppService,
    AdminService,
    AuthService,
    AuthGuard,
    AdminGuard,
    ChatGateway,
    PrismaService,
    StorageService,
    UsersService,
    DepartmentsService,
    ConversationsService,
  ],
})
export class AppModule {}
