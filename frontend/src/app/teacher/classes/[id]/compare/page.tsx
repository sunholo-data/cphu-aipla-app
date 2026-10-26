"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { ClassCompareView } from "@/components/teacher/compare/ClassCompareView";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";
import { useT } from "@/i18n";

/** 1.1.99 M1 — compare one element across every group of a class. */
export default function ClassComparePage() {
  const t = useT("ClassComparePage");
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";

  return (
    <TeacherPage
      breadcrumb={
        <Link
          href={`/teacher/classes/${encodeURIComponent(id)}`}
          className="flex w-fit items-center gap-1 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("breadcrumb")}
        </Link>
      }
      title={t("title")}
      subtitle={t("subtitle")}
    >
      {id ? <ClassCompareView classId={id} /> : null}
    </TeacherPage>
  );
}
