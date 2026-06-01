import type { ReactNode } from "react";

import { TeacherClientShell } from "./_TeacherClientShell";

export default function TeacherLayout({ children }: { children: ReactNode }) {
  return <TeacherClientShell>{children}</TeacherClientShell>;
}
