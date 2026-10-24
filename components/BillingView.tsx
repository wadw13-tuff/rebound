"use client";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  CreditCard,
  ExternalLink,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { PageHeading, Pill } from "./ui";

type BillingData = {
  checkoutEnabled: boolean;
  portalEnabled: boolean;
  plan: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  payments: {
    id: string;
    date: string;
    amount: number;
    currency: string;
    status: string;
    itemName: string;
  }[];
};
const formatMoney = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
const formatDate = (value: string) =>
  new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
export default function BillingView({
  notifyAction,
}: {
  notifyAction: (message: string) => void;
}) {
  const [data, setData] = useState<BillingData | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("status");
    if (status === "success")
      setMessage(
        "Checkout returned. Your subscription is being confirmed from Lemon Squeezy’s webhook.",
      );
    if (status === "cancelled")
      setMessage("Checkout was cancelled. Nothing was charged.");
    fetch("/api/billing", { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        setData(body);
      })
      .catch((error) =>
        setMessage(
          error instanceof Error
            ? error.message
            : "Billing could not be loaded.",
        ),
      );
  }, []);
  async function openCheckout() {
    setBusy(true);
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      window.open(body.url, "_blank", "noopener,noreferrer");
      notifyAction("Lemon Squeezy checkout opened in a new tab.");
    } catch (error) {
      notifyAction(
        error instanceof Error
          ? error.message
          : "Checkout could not be started.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function openPortal() {
    setBusy(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      window.open(body.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      notifyAction(
        error instanceof Error
          ? error.message
          : "Billing management could not be opened.",
      );
    } finally {
      setBusy(false);
    }
  }
  const plus = data?.plan === "plus";
  return (
    <main className="billing-view">
      <PageHeading
        eyebrow="YOUR REBOUND ACCOUNT"
        title="Support your momentum."
        subtitle="Rebound Plus keeps your plan flexible, your history clear, and your billing safely in Lemon Squeezy."
      />
      {message && (
        <div className="billing-message" role="status">
          {message}
        </div>
      )}
      <section className="billing-hero panel">
        <div className="billing-copy">
          <Pill tone={plus ? "sage" : "peach"}>
            {plus ? "ACTIVE PLAN" : "OPTIONAL UPGRADE"}
          </Pill>
          <h2>{plus ? "Rebound Plus is on." : "More room for real life."}</h2>
          <p>
            One adaptive training space for your schedule, progress, and next
            good decision.
          </p>
          <div className="billing-price">
            <strong>$8</strong>
            <span>
              {" "}
              / month
              <br />
              cancel any time
            </span>
          </div>
          {plus ? (
            <button
              className="btn btn-secondary"
              disabled={busy || !data?.portalEnabled}
              onClick={() => void openPortal()}
            >
              <ExternalLink size={16} /> Manage billing
            </button>
          ) : (
            <button
              className="btn btn-primary"
              disabled={busy || !data?.checkoutEnabled}
              onClick={() => void openCheckout()}
            >
              <CreditCard size={16} /> Start Rebound Plus{" "}
              <ArrowRight size={16} />
            </button>
          )}
        </div>
        <div className="billing-perks">
          <div className="billing-spark">
            <Sparkles size={25} />
          </div>
          <h3>Built for the weeks that change.</h3>
          {[
            "Adaptive plans that move with you",
            "Progress history without the pressure",
            "Safe, transparent Lemon Squeezy checkout",
          ].map((item) => (
            <div className="billing-perk" key={item}>
              <Check size={16} />
              {item}
            </div>
          ))}
        </div>
      </section>
      <section className="billing-safety">
        <ShieldCheck size={19} />
        <p>
          Lemon Squeezy handles payment details. Rebound stores only the
          entitlement, provider identifiers needed for subscription events, and
          a minimal payment history. Card numbers, security codes, and expiry
          dates never enter Rebound.
        </p>
      </section>
      <section className="panel billing-history">
        <div className="section-row">
          <div>
            <p className="eyebrow">PAYMENT HISTORY</p>
            <h2>Your Rebound receipts</h2>
          </div>
          {plus && (
            <Pill tone="sage">
              {data?.cancelAtPeriodEnd
                ? "Ends at period close"
                : "Renews monthly"}
            </Pill>
          )}
        </div>
        {!data ? (
          <p className="muted">Loading billing…</p>
        ) : data.payments.length ? (
          <div className="billing-table">
            {data.payments.map((payment) => (
              <div className="billing-row" key={payment.id}>
                <div>
                  <strong>{payment.itemName}</strong>
                  <small>{formatDate(payment.date)}</small>
                </div>
                <span className={`billing-status ${payment.status}`}>
                  {payment.status}
                </span>
                <strong>{formatMoney(payment.amount, payment.currency)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="billing-empty">
            <CreditCard size={22} />
            <p>
              No payments yet. Checkout stays on Lemon Squeezy and will appear
              here after its webhook confirms the session.
            </p>
          </div>
        )}
      </section>
      <p className="billing-footnote">
        Test mode is active in this Preview. No charge starts until you choose
        checkout and approve it on Lemon Squeezy.
      </p>
    </main>
  );
}
