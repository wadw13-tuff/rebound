import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyLemonSignature } from "./billing";

describe("Lemon Squeezy webhook signatures", () => {
  it("accepts the exact raw-body HMAC signature", () => {
    const body = JSON.stringify({ meta: { event_name: "order_created" } });
    const secret = "local-test-secret";
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyLemonSignature(body, signature, secret)).toBe(true);
  });

  it("rejects a changed body or wrong secret", () => {
    const body = '{"event":"subscription_created"}';
    const signature = createHmac("sha256", "local-test-secret")
      .update(body)
      .digest("hex");
    expect(
      verifyLemonSignature(`${body} `, signature, "local-test-secret"),
    ).toBe(false);
    expect(verifyLemonSignature(body, signature, "wrong-secret")).toBe(false);
  });
});
