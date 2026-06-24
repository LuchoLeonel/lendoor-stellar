import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
  correlationId: string | null;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const correlationId =
      (request.headers['x-request-id'] as string | undefined) ?? null;

    const path = request.url;
    const timestamp = new Date().toISOString();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      // NestJS ValidationPipe returns an object with { message: string[], error: string, statusCode: number }
      // Other HttpExceptions may return a string or an object.
      let message: string | string[];
      let errorText: string;

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        errorText = exception.message;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const body = exceptionResponse as Record<string, unknown>;
        // ValidationPipe sets message as string[]
        message = (body['message'] as string | string[]) ?? exception.message;
        errorText = (body['error'] as string) ?? HttpStatus[status] ?? 'Error';
      } else {
        message = exception.message;
        errorText = HttpStatus[status] ?? 'Error';
      }

      const errorResponse: ErrorResponse = {
        statusCode: status,
        message,
        error: errorText,
        timestamp,
        path,
        correlationId,
      };

      response.status(status).json(errorResponse);
    } else {
      // Unknown / unhandled exceptions — never leak internal details.
      this.logger.error(
        {
          err: exception,
          correlationId,
          path,
        },
        'Unhandled exception',
      );

      const errorResponse: ErrorResponse = {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal Server Error',
        error: 'Internal Server Error',
        timestamp,
        path,
        correlationId,
      };

      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(errorResponse);
    }
  }
}
