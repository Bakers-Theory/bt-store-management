import { Guard } from "@/components/feature/Guard";
import { Expenses } from "@/components/feature/cashbook/Expenses";

export default function ExpensesPage() {
  return (
    // Under the cashbook section. The component itself renders NoAccess without
    // expense.view, since cashbook.view alone does not grant the register.
    <Guard section="cashbook">
      <Expenses />
    </Guard>
  );
}
