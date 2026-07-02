"use client";

import { useCurrentUser } from "@/lib/store";
import { canAccessSection } from "@/lib/permissions";
import { NoAccess } from "./NoAccess";

export function Guard({
  section,
  children,
}: {
  section: string;
  children: React.ReactNode;
}) {
  const user = useCurrentUser();
  if (!canAccessSection(user, section)) return <NoAccess />;
  return <>{children}</>;
}
