import { Guard } from "@/components/feature/Guard";
import { Attendance } from "@/components/feature/attendance/Attendance";

export default function AttendancePage() {
  return (
    <Guard section="attendance">
      <Attendance />
    </Guard>
  );
}
