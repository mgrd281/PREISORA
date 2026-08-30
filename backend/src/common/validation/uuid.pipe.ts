import { Injectable, PipeTransform } from '@nestjs/common';
import { AppException } from '../errors/app-exception';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * `ParseUUIDPipe` throws Nest's own BadRequestException; this one throws the
 * platform envelope directly so a malformed path id is a clean `VALIDATION_FAILED`.
 */
@Injectable()
export class ParseUuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
      throw new AppException('VALIDATION_FAILED', { field: 'id', reason: 'not_a_uuid' });
    }
    return value;
  }
}

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

@Injectable()
export class ParseSlugPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || value.length > 200 || !SLUG_PATTERN.test(value)) {
      throw new AppException('VALIDATION_FAILED', { field: 'slug', reason: 'not_a_slug' });
    }
    return value;
  }
}
