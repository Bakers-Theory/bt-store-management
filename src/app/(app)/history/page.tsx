import { Guard } from "@/components/feature/Guard";
import { History } from "@/components/feature/history/History";

export default function HistoryPage() {
  return (
    <Guard section="history">
      <History />
    </Guard>
  );
}
