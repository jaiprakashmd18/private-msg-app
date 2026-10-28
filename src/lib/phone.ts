import { parsePhoneNumberFromString } from "libphonenumber-js/min";

/**
 * Normalizes user input to E.164 (e.g. "+14155550123"). Input must include the
 * country code. Returns null if the number is not valid.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withPlus = trimmed.startsWith("+") ? trimmed : trimmed.startsWith("00") ? `+${trimmed.slice(2)}` : null;
  if (!withPlus) return null;
  const parsed = parsePhoneNumberFromString(withPlus);
  if (!parsed || !parsed.isPossible()) return null;
  return parsed.number;
}

/** Masks a phone number for display in logs or non-sensitive UI: +14•••••••23 */
export function maskPhone(phone: string): string {
  if (phone.length <= 5) return "***";
  return `${phone.slice(0, 3)}${"•".repeat(phone.length - 5)}${phone.slice(-2)}`;
}

/** Pretty international formatting for display. */
export function formatPhone(phone: string): string {
  const parsed = parsePhoneNumberFromString(phone);
  return parsed ? parsed.formatInternational() : phone;
}
