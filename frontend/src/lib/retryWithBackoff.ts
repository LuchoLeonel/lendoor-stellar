export interface RetryOptions {
  maxAttempts?: number
  baseDelayMs?: number
  shouldRetry?: (err: unknown) => boolean
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions,
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? 3
  const baseDelayMs = opts?.baseDelayMs ?? 1000
  const shouldRetry = opts?.shouldRetry ?? (() => true)

  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err

      if (attempt >= maxAttempts || !shouldRetry(err)) {
        throw err
      }

      // Exponential backoff: base * 2^(attempt-1), with ±20% jitter
      const delay = baseDelayMs * Math.pow(2, attempt - 1)
      const jitter = delay * (0.8 + Math.random() * 0.4)
      await new Promise((r) => setTimeout(r, jitter))
    }
  }

  throw lastError
}
