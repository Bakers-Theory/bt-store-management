import { Guard } from "@/components/feature/Guard";
import { Customers } from "@/components/feature/customers/Customers";

export default function CustomersPage() {
  return (
    <Guard section="customers">
      <Customers />
    </Guard>
  );
}
