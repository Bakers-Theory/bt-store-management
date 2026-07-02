import type { Bakery, User } from "./types";

export const EMOJIS = [
  "🥐", "🥖", "🍞", "🧁", "🎂", "🍰", "🍩", "🍪", "🧇", "🥞", "🍫", "🥛",
  "☕", "🧃", "🍓", "🍋", "🥚", "🧈", "🍯", "🌾", "🧂", "🫙", "🥤", "📦",
];

export const CATS = [
  "Breads", "Cakes", "Pastries", "Beverages", "Ingredients", "Cookies", "Others",
];

export const UNITS = ["pcs", "kg", "g", "l", "ml", "dozen", "box", "pack", "bag"];

export const CURRENCIES = ["₹", "$", "€", "£", "¥", "₵"];

export const STOCK_OUT_REASONS = [
  "Sold", "Damaged", "Expired", "Used in production", "Other",
];

export const DEFAULT_BAKERY: Bakery = {
  name: "My Bakery",
  tagline: "Fresh & Delicious",
  address: "123 Baker Street",
  phone: "9876543210",
  gst: "",
  logo: null,
  currency: "₹",
  taxRate: 0,
  lowStockAlert: 5,
};

/** The fixed Owner account, always seeded if missing. */
export function makeOwner(): User {
  return {
    id: "owner",
    name: "Prateek Kumar Patel",
    userId: "7873557430",
    password: "Dominar@400",
    role: "Owner",
    permissions: { sales: true, inventory: true, analytics: true },
  };
}
