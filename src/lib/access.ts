import "server-only";

import { NextResponse } from "next/server";

import { envTrim } from "@/lib/env";

function parseCookie(raw: string | null, key: string): string {
  if (!raw) return "";
  const pairs = raw.split(";").map((part) => part.trim());
  const prefix = `${key}=`;
  const match = pairs.find((part) => part.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : "";
}

function hostName(raw: string | null): string {
  return (raw ?? "").split(":")[0].replace(/^\[|\]$/g, "").toLowerCase();
}

export function isLocalHost(raw: string | null): boolean {
  const host = hostName(raw);
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return hostName(new URL(origin).host) === hostName(req.headers.get("host"));
  } catch {
    return false;
  }
}

function bearerToken(req: Request): string {
  const raw = req.headers.get("authorization") ?? "";
  const [kind, token] = raw.split(/\s+/, 2);
  return kind?.toLowerCase() === "bearer" ? envTrim(token) : "";
}

export function hasOperatorAccessHeaders(headers: Headers): boolean {
  const host = headers.get("host");
  if (isLocalHost(host)) return true;

  const required = envTrim(process.env.AGENT_API_TOKEN);
  if (!required) return false;

  const auth = headers.get("authorization") ?? "";
  const [kind, token] = auth.split(/\s+/, 2);
  const bearer = kind?.toLowerCase() === "bearer" ? envTrim(token) : "";
  const cookieToken = parseCookie(headers.get("cookie"), "operator_token");
  return bearer === required || cookieToken === required;
}

export function requireOperatorAccess(
  req: Request,
  options: { mutation?: boolean } = {},
): NextResponse | null {
  const required = envTrim(process.env.AGENT_API_TOKEN);
  const hostIsLocal = isLocalHost(req.headers.get("host"));
  const headerToken = bearerToken(req) || envTrim(req.headers.get("x-agent-api-token") ?? "");
  const cookieToken = parseCookie(req.headers.get("cookie"), "operator_token");
  const tokenOk = Boolean(required) && (headerToken === required || cookieToken === required);
  const originOk = sameOrigin(req);

  if (hostIsLocal && originOk) return null;
  if (tokenOk && (!options.mutation || headerToken === required || originOk)) return null;

  return NextResponse.json(
    {
      ok: false,
      error:
        "Operator access required. Use localhost, or provide AGENT_API_TOKEN as a Bearer token.",
    },
    { status: 401 },
  );
}
