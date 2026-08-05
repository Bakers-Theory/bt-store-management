import { Guard } from "@/components/feature/Guard";
import { Assets } from "@/components/feature/assets/Assets";

export default function AssetsPage() {
  return (
    <Guard section="assets">
      <Assets />
    </Guard>
  );
}
