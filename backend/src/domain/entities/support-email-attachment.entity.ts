// src/domain/entities/support-email-attachment.entity.ts
//
// Spec 082 — Email Operator Dashboard (attachments).
// One row per attachment parsed from an inbound support email.
// Bytes live in S3 (bucket `lendoor-emails`); this row stores only metadata +
// the S3 location. The dashboard serves them via short-lived presigned URLs.

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from 'typeorm';

@Entity({ name: 'support_email_attachments' })
@Index('idx_support_email_attachments_email', ['emailId'])
export class SupportEmailAttachment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** FK to support_emails.id (uuid). Not a hard TypeORM relation. */
  @Column({ type: 'uuid' })
  emailId!: string;

  /** Original filename (may be synthesized for inline parts). */
  @Column({ type: 'text' })
  filename!: string;

  /** MIME type, e.g. image/png, application/pdf. */
  @Column({ type: 'text' })
  contentType!: string;

  /** Size in bytes of the stored object. */
  @Column({ type: 'integer' })
  sizeBytes!: number;

  /** Content-ID for inline parts (cid:) referenced from the HTML body. Nullable. */
  @Column({ type: 'text', nullable: true })
  contentId?: string | null;

  /** True for inline/related parts (e.g. embedded images), false for real attachments. */
  @Column({ type: 'boolean', default: false })
  isInline!: boolean;

  /** S3 bucket the object lives in. */
  @Column({ type: 'text' })
  s3Bucket!: string;

  /** S3 object key. */
  @Column({ type: 'text' })
  s3Key!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
