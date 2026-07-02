import { Guard } from "@/components/feature/Guard";
import { Bill } from "@/components/feature/bill/Bill";

export default function BillPage() {
  return (
    <Guard section="bill">
      <Bill />
    </Guard>
  );
}
