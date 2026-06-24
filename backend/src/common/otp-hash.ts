import { createHash } from 'crypto';

export function hashOtp(otp: string): string {
  return createHash('sha256').update(otp).digest('hex');
}
