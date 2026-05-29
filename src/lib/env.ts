export function envTrim(raw: string | undefined): string {
  if (!raw) return "";
  let s = raw.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

export function normalizePem(raw: string | undefined): string {
  const s = envTrim(raw);
  if (!s) return "";
  return s.includes("\\n") ? s.replace(/\\n/g, "\n") : s;
}

export function boolEnv(name: string, fallback = false): boolean {
  const v = envTrim(process.env[name]);
  if (!v) return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export function configured(name: string): boolean {
  return Boolean(envTrim(process.env[name]));
}
