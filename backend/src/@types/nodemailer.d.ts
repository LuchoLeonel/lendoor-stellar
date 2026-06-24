// Type declaration for nodemailer — install @types/nodemailer to get full types.
// This minimal shim satisfies strict-mode compilation until the package is added.
declare module 'nodemailer' {
  export interface TransportOptions {
    host?: string;
    port?: number;
    secure?: boolean;
    pool?: boolean;
    maxConnections?: number;
    maxMessages?: number;
    auth?: { user: string; pass: string };
    [key: string]: unknown;
  }

  export interface MailOptions {
    from?: string;
    to?: string | string[];
    subject?: string;
    text?: string;
    html?: string;
    headers?: Record<string, string>;
    [key: string]: unknown;
  }

  export interface SentMessageInfo {
    messageId: string;
    envelope: { from: string; to: string[] };
    accepted: string[];
    rejected: string[];
    response: string;
  }

  export interface Transporter {
    sendMail(mailOptions: MailOptions): Promise<SentMessageInfo>;
    verify(): Promise<boolean>;
    close(): void;
  }

  export function createTransport(options: TransportOptions): Transporter;
}
