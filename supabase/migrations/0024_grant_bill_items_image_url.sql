-- ============================================================================
-- 0024 — Fix: grant SELECT on bill_items.image_url to authenticated.
--
-- 0002 removed the table-level SELECT on bill_items and replaced it with
-- column-level grants (to keep cost_price private). 0022 later added the
-- image_url column but never granted SELECT on it. Because the client reads
-- bill_items directly with `select(..., image_url, ...)` (fetchBillsPage /
-- fetchBill / fetchCustomerBills / fetchReportData), the query was denied on the
-- ungranted column and returned no rows — so every historical bill rendered with
-- no line items (while in-progress bills, which come from local cart state, were
-- unaffected). Grant the missing column.
-- ============================================================================

grant select (image_url) on public.bill_items to authenticated;
