/**
 * Password hashing. Uses Bun's built-in argon2id (memory-hard, the current
 * OWASP-recommended default) so there are no native crypto dependencies to
 * build. Isolated here so the algorithm can be swapped centrally.
 */
export async function hashPassword(plain: string): Promise<string> {
  return Bun.password.hash(plain, { algorithm: "argon2id" });
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  try {
    return await Bun.password.verify(plain, hash);
  } catch {
    return false;
  }
}
