export type ContactDetails = { email?: string[]; tel?: string[] };

export function normalizeContactDetails(contacts: ContactDetails[]) {
  const emails = new Set<string>();
  const phones = new Set<string>();
  for (const contact of contacts) {
    for (const address of contact.email ?? []) {
      const email = address.trim().toLowerCase();
      if (email.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(email)) emails.add(email);
    }
    for (const number of contact.tel ?? []) {
      const phone = number.trim().replace(/^tel:/i, "").replace(/[().\s-]/g, "").replace(/^00/, "+");
      if (/^\+[1-9][0-9]{7,14}$/.test(phone)) phones.add(phone);
    }
  }
  return { emails: [...emails], phones: [...phones] };
}

export function readVCard(text: string): ContactDetails {
  const email: string[] = [];
  const tel: string[] = [];
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  if (!/^BEGIN:VCARD\s*$/im.test(unfolded)) throw new Error("Choose a vCard contacts export (.vcf).");
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).split(";")[0]?.split(".").pop()?.toUpperCase();
    const value = line.slice(colon + 1);
    if (key === "EMAIL") email.push(value);
    if (key === "TEL") tel.push(value);
  }
  return { email, tel };
}
