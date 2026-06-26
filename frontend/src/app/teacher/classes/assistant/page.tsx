"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ManageClassChat } from "./_ManageClassChat";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";

export default function ManageClassAssistantPage() {
  return (
    <TeacherPage
      breadcrumb={
        <Link href="/teacher/classes" className="flex w-fit items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Dashboard
        </Link>
      }
      title="Manage classes by chat"
      subtitle="Create classes, mint join-codes, look up activities, and ask how a class is doing — in conversation, the same data as the dashboard."
    >
      <ManageClassChat />
    </TeacherPage>
  );
}
