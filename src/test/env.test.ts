import { describe, expect, it } from "vitest";

import { envTrim, normalizePem } from "../lib/env";

describe("env helpers", () => {
  it("trims optional surrounding quotes", () => {
    expect(envTrim(' "abc" ')).toBe("abc");
    expect(envTrim(" 'abc' ")).toBe("abc");
  });

  it("normalizes literal newline pem values", () => {
    expect(normalizePem('"-----BEGIN KEY-----\\nabc\\n-----END KEY-----"')).toContain("\nabc\n");
  });
});
