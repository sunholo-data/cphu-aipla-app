"use client";

import { useEffect, useState } from "react";

import { fetchMyFeatures } from "@/lib/teacherFeaturesApi";

/** "loading" until the answer arrives; "off" also when it cannot be read, so a
 *  failed read shows the locked state (the server refuses anyway). */
export type FeatureAccess = "loading" | "on" | "off";

/** Whether the signed-in teacher has a per-teacher feature (e.g. "simWorkshop"). */
export function useMyFeature(feature: string): FeatureAccess {
  const [access, setAccess] = useState<FeatureAccess>("loading");
  useEffect(() => {
    let alive = true;
    fetchMyFeatures()
      .then((f) => alive && setAccess(f.features[feature] ? "on" : "off"))
      .catch(() => alive && setAccess("off"));
    return () => {
      alive = false;
    };
  }, [feature]);
  return access;
}
