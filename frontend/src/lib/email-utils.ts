const COMMON_DOMAIN_FIXES: Record<string, string> = {
  "gmail.con": "gmail.com",
  "gmail.co": "gmail.com",
  "gmai.com": "gmail.com",
  "gmial.com": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmai.com": "hotmail.com",
  "outlok.com": "outlook.com",
  "outlook.con": "outlook.com",
  "yaho.com": "yahoo.com",
  "yahoo.con": "yahoo.com",
};

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

export function suggestFixedEmail(email: string): {
  email: string;
  changed: boolean;
} {
  const trimmed = email.trim();
  const [local, domain] = trimmed.split("@");
  if (!local || !domain) return { email: trimmed, changed: trimmed !== email };

  const lowerDomain = domain.toLowerCase();
  const fixedDomain = COMMON_DOMAIN_FIXES[lowerDomain] ?? lowerDomain;
  const fixed = `${local}@${fixedDomain}`;
  return { email: fixed, changed: fixed !== email };
}
