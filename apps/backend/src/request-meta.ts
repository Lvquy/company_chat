import { Request } from 'express';

function pickFirstHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0]?.trim() || null;
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split(',')[0]?.trim() || null;
  }
  return null;
}

export function getRequestIp(request: Request) {
  return (
    pickFirstHeaderValue(request.headers['cf-connecting-ip']) ||
    pickFirstHeaderValue(request.headers['true-client-ip']) ||
    pickFirstHeaderValue(request.headers['x-real-ip']) ||
    pickFirstHeaderValue(request.headers['x-forwarded-for']) ||
    request.ip ||
    null
  );
}

export function getUserAgent(request: Request) {
  return request.headers['user-agent'] ?? null;
}
