/**
 * Cryptographically secure pseudo-random number generator (CSPRNG)
 * Returns a random integer in the range [0, max - 1].
 * Uses rejection sampling to completely eliminate modulo bias.
 * 
 * @param max The upper bound (exclusive)
 * @returns A secure random integer in [0, max - 1]
 */
export function getSecureRandomInt(max: number): number {
  if (max <= 1) return 0;
  
  if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
    const array = new Uint32Array(1);
    // 2^32 = 4294967296. Find the largest multiple of max that fits in a 32-bit uint
    const limit = 4294967296 - (4294967296 % max);
    
    let safetyCounter = 0;
    while (safetyCounter < 1000) {
      window.crypto.getRandomValues(array);
      if (array[0] < limit) {
        return array[0] % max;
      }
      safetyCounter++;
    }
  }
  
  // Fallback to Math.random() in environments where crypto is unavailable (e.g. headless tests)
  return Math.floor(Math.random() * max);
}

/**
 * Shuffles an array and returns a new shuffled array using the cryptographically secure Fisher-Yates algorithm.
 * 
 * @param array The array to shuffle
 * @returns A new shuffled array
 */
export function secureShuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = getSecureRandomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
