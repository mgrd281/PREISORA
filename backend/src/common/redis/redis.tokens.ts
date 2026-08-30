/**
 * The Redis injection token lives in its own file: `redis.module.ts` imports
 * `RedisCacheService` and `RedisCacheService` needs the token, so keeping the token
 * in the module file would make the two files circular (and the token `undefined` at
 * decoration time).
 */
export const REDIS = Symbol('PREISORA_REDIS');
