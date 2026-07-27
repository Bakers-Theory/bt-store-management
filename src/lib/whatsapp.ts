import type { Bakery, Bill } from "./types";

/**
 * A 10-digit Indian number prefixed with the 91 country code, or undefined when
 * the input is not a usable 10-digit number. Callers fall back to a share link
 * with no recipient rather than opening a broken chat.
 */
function toWhatsAppNumber(phone: string | undefined): string | undefined {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length === 10 ? `91${digits}` : undefined;
}

/**
 * Character width of the monospace block. WhatsApp renders ``` blocks in a
 * fixed-width font at a reduced size; much past this and lines wrap on a phone,
 * which breaks the column alignment the block exists for.
 */
const MONO_WIDTH = 24;

/** `label` left, `amount` right-aligned to MONO_WIDTH, never overlapping. */
function monoRow(label: string, amount: string): string {
  const pad = MONO_WIDTH - amount.length;
  return pad > label.length ? label.padEnd(pad) + amount : `${label} ${amount}`;
}

/**
 * The receipt as a WhatsApp message. Header and footer use WhatsApp's markup
 * (*bold*, _italic_); the items and totals sit in a ``` block so the amounts
 * line up in a column. Markup is NOT applied inside a ``` block, which is why
 * the total is uppercased there rather than bolded.
 */
export function buildBillText(bill: Bill, bakery: Bakery): string {
  const c = bakery.currency;
  const dt = new Date(bill.date);
  const dateStr = dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const timeStr = dt
    .toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })
    .toUpperCase();
  const money = (n: number) => `${c}${n.toFixed(2)}`;
  const lines: string[] = [];

  if (bill.status === "cancelled") lines.push("⚠️ *THIS BILL WAS CANCELLED*", "");

  lines.push(`*${bakery.name}*`);
  if (bakery.tagline) lines.push(`_${bakery.tagline}_`);
  if (bakery.address) lines.push(bakery.address);
  if (bakery.gst) lines.push(`GST: ${bakery.gst}`);

  lines.push("", `🧾 Bill #${bill.billNo}`, `📅 ${dateStr}, ${timeStr}`);
  if (bill.customerName) lines.push(`👤 ${bill.customerName}`);
  if (bill.billerName) lines.push(`🧑‍🍳 Billed by ${bill.billerName}`);

  lines.push("", "```");
  for (const bi of bill.items) {
    lines.push(bi.name, monoRow(`  ${bi.qty} × ${money(bi.price)}`, money(bi.qty * bi.price)));
  }
  lines.push("─".repeat(MONO_WIDTH));
  lines.push(monoRow("Subtotal", money(bill.subtotal)));
  if (bill.discountAmount > 0) {
    const label = bill.discountType === "percent" ? `Discount (${bill.discountPercent}%)` : "Discount";
    lines.push(monoRow(label, `-${money(bill.discountAmount)}`));
  }
  if (bill.tax > 0) lines.push(monoRow(`Tax (${bill.taxRate}%)`, money(bill.tax)));
  lines.push(monoRow("TOTAL", money(bill.total)));
  lines.push("```", "");

  lines.push(`💳 Paid via ${bill.paymentMethod}`);
  lines.push("", "_Thank you for your visit!_");
  lines.push(bakery.phone ? `_Please come again · ${bakery.phone}_` : `_${bakery.name}_`);

  return lines.join("\n");
}

/**
 * True for phones and tablets, where WhatsApp should open in the native app
 * rather than WhatsApp Web. The Macintosh branch catches modern iPadOS, which
 * reports itself as desktop Safari but exposes touch points.
 */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

export interface WhatsAppTargets {
  /** Tried first. */
  primary: string;
  /** Used only when `primary` is a desktop app scheme that nothing handled. */
  fallback?: string;
}

/**
 * Where to send the message. Mobile gets wa.me, which hands off to the installed
 * app on its own. Desktop gets the `whatsapp://` scheme so the native desktop app
 * opens, with WhatsApp Web as the fallback for machines that do not have it
 * installed. Without a usable recipient the links open WhatsApp's chat picker.
 */
export function whatsAppTargets(
  text: string,
  phone: string | undefined,
  isMobile: boolean,
): WhatsAppTargets {
  const encoded = encodeURIComponent(text);
  const to = toWhatsAppNumber(phone);
  if (isMobile) return { primary: to ? `https://wa.me/${to}?text=${encoded}` : `https://wa.me/?text=${encoded}` };
  return to
    ? {
        primary: `whatsapp://send?phone=${to}&text=${encoded}`,
        fallback: `https://web.whatsapp.com/send?phone=${to}&text=${encoded}`,
      }
    : { primary: `whatsapp://send?text=${encoded}`, fallback: `https://wa.me/?text=${encoded}` };
}

/** How long the desktop app gets to take focus before we give up on it. */
const APP_LAUNCH_GRACE_MS = 2000;

/**
 * Hands off to the desktop app, falling back to WhatsApp Web if nothing handled
 * the scheme.
 *
 * The tab is opened up front and left blank rather than opened later from the
 * timer: a `window.open` outside a user gesture is blocked by every browser's
 * popup blocker. The blank tab holds focus, so if the app does launch it steals
 * focus away and the tab closes itself; otherwise it becomes WhatsApp Web.
 */
function openAppWithWebFallback(appUrl: string, webUrl: string): void {
  const tab = window.open("about:blank", "_blank");
  if (!tab) {
    // Popup blocked outright — go straight to the app and let the user retry.
    window.location.href = appUrl;
    return;
  }
  tab.location.href = appUrl;
  window.setTimeout(() => {
    if (tab.closed) return;
    let appTookFocus = false;
    try {
      appTookFocus = !tab.document.hasFocus();
    } catch {
      // Focus unreadable — prefer landing the user somewhere over closing the tab.
    }
    if (appTookFocus) tab.close();
    else tab.location.href = webUrl;
  }, APP_LAUNCH_GRACE_MS);
}

/** Opens WhatsApp with the bill prefilled. Must be called synchronously from a click handler. */
export function shareBillOnWhatsApp(bill: Bill, bakery: Bakery): void {
  const text = buildBillText(bill, bakery);
  const { primary, fallback } = whatsAppTargets(text, bill.customerPhone, isMobileDevice());
  if (fallback) openAppWithWebFallback(primary, fallback);
  else window.open(primary, "_blank", "noopener,noreferrer");
}
