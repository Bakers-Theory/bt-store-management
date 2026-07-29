import { Guard } from "@/components/feature/Guard";
import { Purchases } from "@/components/feature/purchases/Purchases";

export default function PurchasesPage() {
  return (
    <Guard section="purchases">
      <Purchases />
    </Guard>
  );
}
