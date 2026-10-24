import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db";

export const PLUS_PLAN = {
  key: "rebound-plus",
  name: "Rebound Plus",
  description:
    "Adaptive training plans, progress history, and flexible scheduling.",
  amount: 800,
  currency: "usd",
  interval: "month" as const,
};

const apiBase = "https://api.lemonsqueezy.com/v1";

type LemonAttributes = Record<string, unknown>;
type LemonEvent = {
  meta?: { event_name?: string; custom_data?: Record<string, unknown> };
  data?: { id?: string; type?: string; attributes?: LemonAttributes };
};

const setting = (name: string) => process.env[name]?.trim();
const numericId = (name: string) => {
  const value = setting(name);
  return value && /^\d+$/.test(value) ? value : undefined;
};

export function lemonReady() {
  return Boolean(
    setting("LEMONSQUEEZY_API_KEY") &&
      numericId("LEMONSQUEEZY_STORE_ID") &&
      numericId("LEMONSQUEEZY_VARIANT_ID"),
  );
}

export function appOrigin(request: Request) {
  const explicit = request.headers.get("origin");
  if (explicit && /^https?:\/\//.test(explicit))
    return explicit.replace(/\/$/, "");
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  const forwardedHost =
    request.headers.get("x-forwarded-host") || request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto") || "http";
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  throw new Error("A public application origin is required to start checkout.");
}

function activeStatus(status: string, periodEnd?: Date | null) {
  if (status === "active" || status === "on_trial" || status === "paused")
    return true;
  return status === "cancelled" && Boolean(periodEnd && periodEnd > new Date());
}

function periodEnd(attributes: LemonAttributes) {
  const value =
    attributes.renews_at || attributes.ends_at || attributes.trial_ends_at;
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stringValue(attributes: LemonAttributes, key: string) {
  const value = attributes[key];
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
}

function booleanValue(attributes: LemonAttributes, key: string) {
  return attributes[key] === true;
}

async function lemonRequest(path: string, body: object) {
  const apiKey = setting("LEMONSQUEEZY_API_KEY");
  if (!apiKey) throw new Error("Lemon Squeezy is not configured yet.");
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as {
    data?: { id?: string; attributes?: LemonAttributes };
    errors?: unknown[];
  } | null;
  if (!response.ok) {
    throw new Error(
      `Lemon Squeezy request failed (${response.status}). Check the store and variant settings.`,
    );
  }
  return payload;
}

export async function billingSummary(userId: string) {
  const account = await db.billingAccount.findUnique({ where: { userId } });
  const payments = await db.billingPayment.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const end = account?.currentPeriodEnd || null;
  return {
    checkoutEnabled: lemonReady(),
    portalEnabled: Boolean(account?.customerPortalUrl),
    plan: activeStatus(account?.status || "inactive", end) ? "plus" : "free",
    status: account?.status || "inactive",
    currentPeriodEnd: end?.toISOString() || null,
    cancelAtPeriodEnd: account?.cancelAtPeriodEnd || false,
    payments: payments.map((payment) => ({
      id: payment.id,
      date: payment.paidAt?.toISOString() || payment.createdAt.toISOString(),
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      itemName: payment.itemName,
    })),
  };
}

export async function createCheckout(
  userId: string,
  userName: string,
  request: Request,
) {
  const storeId = numericId("LEMONSQUEEZY_STORE_ID");
  const variantId = numericId("LEMONSQUEEZY_VARIANT_ID");
  if (!storeId || !variantId || !setting("LEMONSQUEEZY_API_KEY"))
    throw new Error(
      "Lemon Squeezy checkout is not configured. Add the API key, store ID, and variant ID.",
    );
  const origin = appOrigin(request);
  const existing = await db.billingAccount.findUnique({ where: { userId } });
  if (existing && activeStatus(existing.status, existing.currentPeriodEnd))
    throw new Error("Your Rebound Plus plan is already active.");

  const payload = await lemonRequest("/checkouts", {
    data: {
      type: "checkouts",
      attributes: {
        product_options: {
          name: PLUS_PLAN.name,
          description: PLUS_PLAN.description,
          redirect_url: `${origin}/billing?status=success`,
          receipt_button_text: "Return to Rebound",
          receipt_link_url: `${origin}/billing`,
          receipt_thank_you_note: "Thanks for supporting Rebound.",
        },
        checkout_options: {
          discount: true,
          locale: "en",
          button_color: "#d96845",
          button_text_color: "#ffffff",
        },
        checkout_data: {
          name: userName,
          custom: { user_id: userId },
        },
      },
      relationships: {
        store: { data: { type: "stores", id: storeId } },
        variant: { data: { type: "variants", id: variantId } },
      },
    },
  });
  const url = payload?.data?.attributes?.url;
  if (typeof url !== "string" || !url.startsWith("https://"))
    throw new Error("Lemon Squeezy did not return a checkout URL.");
  return url;
}

export async function createPortal(userId: string) {
  const account = await db.billingAccount.findUnique({ where: { userId } });
  if (!account?.customerPortalUrl)
    throw new Error(
      "A completed Rebound Plus checkout is needed before billing management is available.",
    );
  return account.customerPortalUrl;
}

function eventUserId(event: LemonEvent, attributes: LemonAttributes) {
  const custom = event.meta?.custom_data?.user_id;
  if (typeof custom === "string" && custom.length > 0) return custom;
  const numeric = typeof custom === "number" ? String(custom) : undefined;
  return numeric;
}

async function findUserId(
  event: LemonEvent,
  attributes: LemonAttributes,
  subscriptionId?: string,
  customerId?: string,
) {
  const candidate = eventUserId(event, attributes);
  if (
    candidate &&
    (await db.user.findUnique({
      where: { id: candidate },
      select: { id: true },
    }))
  )
    return candidate;
  if (subscriptionId) {
    const account = await db.billingAccount.findUnique({
      where: { providerSubscriptionId: subscriptionId },
      select: { userId: true },
    });
    if (account) return account.userId;
  }
  if (customerId) {
    const account = await db.billingAccount.findUnique({
      where: { providerCustomerId: customerId },
      select: { userId: true },
    });
    if (account) return account.userId;
  }
  return undefined;
}

export function verifyLemonSignature(
  rawBody: string,
  signature: string,
  secret: string,
) {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const signatureBuffer = Buffer.from(signature, "hex");
  return (
    expectedBuffer.length === signatureBuffer.length &&
    timingSafeEqual(expectedBuffer, signatureBuffer)
  );
}

export async function processLemonEvent(event: LemonEvent) {
  const eventName = event.meta?.event_name;
  const object = event.data;
  const attributes = object?.attributes || {};
  if (!eventName || !object?.id)
    throw new Error("Invalid Lemon Squeezy event.");
  const eventId = `${eventName}:${object.id}`;
  const subscriptionId =
    stringValue(attributes, "id") ||
    (eventName.startsWith("subscription_")
      ? object.id
      : stringValue(attributes, "subscription_id"));
  const customerId = stringValue(attributes, "customer_id");
  const userId = await findUserId(
    event,
    attributes,
    subscriptionId,
    customerId,
  );
  const end = periodEnd(attributes);
  const status = stringValue(attributes, "status") || "inactive";
  const isSubscriptionEvent = eventName.startsWith("subscription_");
  const isOrderEvent = eventName === "order_created";

  await db.$transaction(async (tx) => {
    if (await tx.billingEvent.findUnique({ where: { id: eventId } })) return;
    await tx.billingEvent.create({
      data: {
        id: eventId,
        type: eventName,
        userId,
        providerCustomerId: customerId,
        providerSubscriptionId: subscriptionId,
        orderId: isOrderEvent ? object.id : stringValue(attributes, "order_id"),
      },
    });
    if (!userId) return;

    if (isSubscriptionEvent) {
      const portalUrl =
        attributes.urls &&
        typeof attributes.urls === "object" &&
        typeof (attributes.urls as Record<string, unknown>).customer_portal ===
          "string"
          ? ((attributes.urls as Record<string, unknown>)
              .customer_portal as string)
          : undefined;
      await tx.billingAccount.upsert({
        where: { userId },
        create: {
          userId,
          providerCustomerId: customerId,
          providerSubscriptionId: subscriptionId,
          providerVariantId: stringValue(attributes, "variant_id"),
          customerPortalUrl: portalUrl,
          plan: activeStatus(status, end) ? "plus" : "free",
          status,
          currentPeriodEnd: end,
          cancelAtPeriodEnd: Boolean(
            status === "cancelled" || attributes.ends_at,
          ),
        },
        update: {
          providerCustomerId: customerId,
          providerSubscriptionId: subscriptionId,
          providerVariantId: stringValue(attributes, "variant_id"),
          customerPortalUrl: portalUrl,
          plan: activeStatus(status, end) ? "plus" : "free",
          status,
          currentPeriodEnd: end,
          cancelAtPeriodEnd: Boolean(
            status === "cancelled" || attributes.ends_at,
          ),
        },
      });
    }

    if (isOrderEvent) {
      const amount =
        Number(attributes.total ?? attributes.total_usd ?? PLUS_PLAN.amount) ||
        PLUS_PLAN.amount;
      const currency =
        stringValue(attributes, "currency") || PLUS_PLAN.currency;
      const orderId = object.id;
      await tx.billingPayment.upsert({
        where: { checkoutId: `order:${orderId}` },
        create: {
          userId,
          checkoutId: `order:${orderId}`,
          orderId,
          subscriptionId,
          amount,
          currency,
          status: stringValue(attributes, "status") || "paid",
          itemName: PLUS_PLAN.name,
          paidAt: attributes.created_at
            ? new Date(String(attributes.created_at))
            : new Date(),
        },
        update: {
          orderId,
          subscriptionId,
          status: stringValue(attributes, "status") || "paid",
          paidAt: attributes.created_at
            ? new Date(String(attributes.created_at))
            : new Date(),
        },
      });
      await tx.billingAccount.upsert({
        where: { userId },
        create: {
          userId,
          providerCustomerId: customerId,
          providerSubscriptionId: subscriptionId,
          plan: "plus",
          status: "active",
        },
        update: {
          providerCustomerId: customerId,
          providerSubscriptionId: subscriptionId,
          plan: "plus",
          status: "active",
        },
      });
    }
  });
}
