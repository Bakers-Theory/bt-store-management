import { Guard } from "@/components/feature/Guard";
import { Suppliers } from "@/components/feature/suppliers/Suppliers";

export default function SuppliersPage() {
  return (
    <Guard section="suppliers">
      <Suppliers />
    </Guard>
  );
}
