// src/user/phone-otp.service.ts
//
// Phone OTP via WhatsApp (Kapso) — mirrors the live Lendoor backend's
// WhatsAppService. Generates a 6-digit code, stores it on the user, and sends
// it through the Kapso WhatsApp Cloud API using the OTP template (body param +
// copy-code URL button). Falls back to a plain-text WhatsApp message, and to a
// dev log if Kapso isn't configured. Secrets (KAPSO_API_KEY /
// KAPSO_PHONE_NUMBER_ID) are read from env only — never hardcoded.
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from 'src/domain/entities/user.entity';
import { normalizeWallet } from 'src/common/normalize-wallet';

// Real Kapso client surface (v0.2.1 is resource-based: client.messages.*).
type KapsoClient = {
  messages: {
    sendTemplate(params: {
      phoneNumberId: string;
      to: string;
      template: {
        name: string;
        language: { code: string };
        components: unknown[];
      };
    }): Promise<{ messages?: { id?: string }[] }>;
    sendText(params: {
      phoneNumberId: string;
      to: string;
      body: string;
    }): Promise<{ messages?: { id?: string }[] }>;
  };
};

// Lazy Kapso client, built once from env. `undefined` = not yet resolved.
let cachedKapso: KapsoClient | null | undefined;
function getKapsoClient(): KapsoClient | null {
  if (cachedKapso !== undefined) return cachedKapso;
  const apiKey = process.env.KAPSO_API_KEY;
  const phoneNumberId = process.env.KAPSO_PHONE_NUMBER_ID;
  if (!apiKey || !phoneNumberId) {
    cachedKapso = null;
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WhatsAppClient } = require('@kapso/whatsapp-cloud-api') as {
    WhatsAppClient: new (o: { kapsoApiKey: string; baseUrl: string }) => KapsoClient;
  };
  cachedKapso = new WhatsAppClient({
    kapsoApiKey: apiKey,
    baseUrl: 'https://api.kapso.ai/meta/whatsapp',
  });
  return cachedKapso;
}

@Injectable()
export class PhoneOtpService {
  private readonly logger = new Logger(PhoneOtpService.name);

  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
  ) {}

  /** Generates a 6-digit code, persists it, and sends it via WhatsApp (Kapso). */
  async sendVerification(
    phone: string,
    channel: 'whatsapp' | 'sms',
    walletAddress: string,
  ): Promise<void> {
    const wallet = normalizeWallet(walletAddress);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await this.repo.update(
      { walletAddress: wallet },
      {
        phoneOtpCode: code,
        phoneOtpExpiresAt: new Date(Date.now() + 10 * 60_000),
      },
    );

    const kapso = getKapsoClient();
    const phoneNumberId = process.env.KAPSO_PHONE_NUMBER_ID ?? '';
    const masked = `${phone.slice(0, 5)}***`;
    if (kapso && phoneNumberId) {
      const templateName = process.env.WA_OTP_TEMPLATE || 'otp_verification';
      const templateLang = process.env.WA_TPL_LANG || 'es';
      try {
        // OTP template: body param {{1}} = code, plus a copy-code URL button
        // whose {{1}} placeholder = code (same shape as the live WhatsAppService).
        const components: unknown[] = [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          {
            type: 'button',
            sub_type: 'url',
            index: 0,
            parameters: [{ type: 'text', text: code }],
          },
        ];
        await kapso.messages.sendTemplate({
          phoneNumberId,
          to: phone,
          template: {
            name: templateName,
            language: { code: templateLang },
            components,
          },
        });
        this.logger.log(`Phone OTP sent via WhatsApp template to ${masked}`);
        return;
      } catch (templateErr: unknown) {
        const m =
          templateErr instanceof Error ? templateErr.message : String(templateErr);
        this.logger.warn(`WhatsApp template send failed, trying text: ${m}`);
        try {
          await kapso.messages.sendText({
            phoneNumberId,
            to: phone,
            body: `Tu código de verificación Lendoor es: ${code}\n\nExpira en 10 minutos.`,
          });
          this.logger.log(`Phone OTP sent via WhatsApp text to ${masked}`);
          return;
        } catch (textErr: unknown) {
          const tm = textErr instanceof Error ? textErr.message : String(textErr);
          this.logger.error(`WhatsApp OTP send FAILED to ${masked}: ${tm}`);
          // fall through to dev log
        }
      }
    }

    if (process.env.NODE_ENV !== 'production') {
      this.logger.warn(`[DEV] phone OTP for ${phone} via ${channel}: ${code}`);
    }
  }

  /** Compares the submitted code against the stored one. */
  async checkVerification(
    _phone: string,
    code: string,
    walletAddress: string,
  ): Promise<boolean> {
    const wallet = normalizeWallet(walletAddress);
    const user = await this.repo.findOne({ where: { walletAddress: wallet } });
    if (!user?.phoneOtpCode || !user.phoneOtpExpiresAt) return false;
    if (user.phoneOtpExpiresAt.getTime() < Date.now()) return false;
    const ok = user.phoneOtpCode === code;
    if (ok) {
      await this.repo.update(
        { walletAddress: wallet },
        { phoneOtpCode: null, phoneOtpExpiresAt: null },
      );
    }
    return ok;
  }
}
