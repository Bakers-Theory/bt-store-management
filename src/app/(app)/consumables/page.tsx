import { Guard } from "@/components/feature/Guard";
import { Consumables } from "@/components/feature/consumables/Consumables";

export default function ConsumablesPage() {
  return (
    <Guard section="consumables">
      <Consumables />
    </Guard>
  );
}
