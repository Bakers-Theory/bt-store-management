import { Guard } from "@/components/feature/Guard";
import { DayClose } from "@/components/feature/cashbook/DayClose";

export default function DayClosePage() {
  return (
    // Same section as /cashbook: reaching the page needs cashbook.view, and the
    // page itself renders read-only without cashbook.close.
    <Guard section="cashbook">
      <DayClose />
    </Guard>
  );
}
