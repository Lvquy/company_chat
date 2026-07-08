import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth() {
    return {
      ok: true,
      service: 'inhouse-chat-backend',
      timestamp: new Date().toISOString(),
    };
  }
}
