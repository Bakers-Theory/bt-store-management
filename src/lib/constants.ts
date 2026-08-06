// Item option lists (categories, emojis, units, stock-out reasons) now live in
// the `store_lists` table and are managed by the Owner in Settings.
// See supabase/migrations/0006_store_lists.sql.

/**
 * The GST slabs an Indian bakery can actually charge. A fixed list rather than a
 * free number field: the slabs are set by law, not by the store, and a typo'd
 * 1.8% would print on a tax invoice and be filed against the return.
 *
 * Enforced server-side too — `items_gst_rate_range` and `consumable_gst_rate_range`
 * bound the column to 0–28 (migration 0068).
 */
export const GST_RATES = [0, 5, 12, 18, 28] as const;
