import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AccessToken } from 'livekit-server-sdk';

type LiveKitParticipant = {
  id: string;
  fullName: string;
};

@Injectable()
export class LiveKitService {
  createAudioCallToken(roomName: string, participant: LiveKitParticipant) {
    const url = process.env.LIVEKIT_URL ?? 'ws://localhost:7880';
    const apiKey = process.env.LIVEKIT_API_KEY ?? 'devkey';
    const apiSecret = process.env.LIVEKIT_API_SECRET ?? 'secret';
    const tokenTtl = process.env.LIVEKIT_TOKEN_TTL ?? '8h';

    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      throw new ServiceUnavailableException('LIVEKIT_URL must use ws:// or wss://');
    }

    const token = new AccessToken(apiKey, apiSecret, {
      identity: participant.id,
      name: participant.fullName,
      ttl: tokenTtl,
    });
    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
    });

    return token.toJwt().then((participantToken) => ({
      url,
      token: participantToken,
    }));
  }
}
