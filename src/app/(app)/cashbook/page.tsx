import { Guard } from "@/components/feature/Guard";
import { Cashbook } from "@/components/feature/cashbook/Cashbook";

export default function CashbookPage() {
  return (
    <Guard section="cashbook">
      <Cashbook />
    </Guard>
  );
}
