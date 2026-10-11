// src/kyc/dto/sandbox-decision.dto.ts
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Review PR #6: el sandbox tambien valida con class-validator como todo el
 * resto — sin DTO, un decision arbitrario ('pending', basura) entraba al
 * mapa del fake provider por el cast del controller.
 */
export class SandboxDecisionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  sessionId!: string;

  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';
}
