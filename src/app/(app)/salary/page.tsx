import { Guard } from "@/components/feature/Guard";
import { Salary } from "@/components/feature/salary/Salary";

export default function SalaryPage() {
  return (
    <Guard section="salary">
      <Salary />
    </Guard>
  );
}
