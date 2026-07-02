import { Guard } from "@/components/feature/Guard";
import { Stock } from "@/components/feature/stock/Stock";

export default function StockPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const tab =
    searchParams.tab === "in" || searchParams.tab === "out"
      ? searchParams.tab
      : "all";
  return (
    <Guard section="stock">
      <Stock initialTab={tab} />
    </Guard>
  );
}
