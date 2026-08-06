import { Guard } from "@/components/feature/Guard";
import { Stock } from "@/components/feature/stock/Stock";

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: tabParam } = await searchParams;
  const tab = tabParam === "in" || tabParam === "out" ? tabParam : "all";
  return (
    <Guard section="stock">
      <Stock initialTab={tab} />
    </Guard>
  );
}
