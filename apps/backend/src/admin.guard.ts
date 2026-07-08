import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AuthUser } from './auth.types';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { authUser?: AuthUser }>();
    if (request.authUser?.username !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
