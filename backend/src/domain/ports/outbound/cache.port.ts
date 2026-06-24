// src/domain/ports/outbound/cache.port.ts

export const CACHE_PORT = Symbol('CACHE_PORT');

/**
 * Port for key-value cache operations.
 *
 * Abstracts over the underlying cache provider (currently NestJS CacheManager
 * backed by in-memory or Redis) used by auth.service.ts for access-token
 * validation.
 */
export interface CachePort {
  /**
   * Retrieves a cached value by key.
   * Returns undefined if the key does not exist or has expired.
   *
   * @param key - cache key
   */
  get<T>(key: string): Promise<T | undefined>;

  /**
   * Stores a value in the cache.
   *
   * @param key   - cache key
   * @param value - value to store
   * @param ttl   - optional time-to-live in milliseconds; implementation
   *                defaults apply when omitted
   */
  set<T>(key: string, value: T, ttl?: number): Promise<void>;

  /**
   * Removes a key from the cache.
   * Safe to call even if the key does not exist.
   *
   * @param key - cache key
   */
  del(key: string): Promise<void>;
}
