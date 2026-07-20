import bcrypt from 'bcryptjs';

/**
 * Hashes an admin password using bcrypt.
 * @param password The plain text password
 * @returns The hashed password
 */
export async function hashAdminPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

/**
 * Verifies an admin password against a bcrypt hash.
 * @param password The plain text password
 * @param hash The bcrypt hashed password
 * @returns True if matches, false otherwise
 */
export async function verifyAdminPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch (error) {
    return false;
  }
}

/**
 * Synchronously hashes an admin password.
 * @param password The plain text password
 * @returns The hashed password
 */
export function hashAdminPasswordSync(password: string): string {
  return bcrypt.hashSync(password, 10);
}

/**
 * Synchronously verifies an admin password against a bcrypt hash.
 * @param password The plain text password
 * @param hash The bcrypt hashed password
 * @returns True if matches, false otherwise
 */
export function verifyAdminPasswordSync(password: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(password, hash);
  } catch (error) {
    return false;
  }
}
