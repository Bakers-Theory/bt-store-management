import { Guard } from "@/components/feature/Guard";
import { Dashboard } from "@/components/feature/dashboard/Dashboard";

export default function DashboardPage() {
  return (
    <Guard section="dashboard">
      <Dashboard />
    </Guard>
  );
}
