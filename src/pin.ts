/** PINs are exactly 6 digits: the server checks them like a password, and rate-limits wrong guesses. */
export const validPin = (pin: string): boolean => /^\d{6}$/.test(pin)

/** A random PIN to give a new staff member, who can change it later from the menu. */
export function tempPin(): string {
  const a = crypto.getRandomValues(new Uint32Array(1))[0]
  return String(100000 + (a % 900000))
}
