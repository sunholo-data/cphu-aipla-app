"use client";

import { useEffect, useState } from "react";

import { type EnvironmentInfo, fetchEnvironment } from "@/lib/environment";

/**
 * Which deployment am I running against — dev, test, prod, local?
 *
 * `null` while in flight AND when the backend can't answer: callers must treat
 * "don't know" as "say nothing", never as "this is production". The underlying
 * fetch is shared and made once per page load (see lib/environment).
 */
export function useEnvironment(): EnvironmentInfo | null {
  const [info, setInfo] = useState<EnvironmentInfo | null>(null);

  useEffect(() => {
    let live = true;
    void fetchEnvironment().then((result) => {
      if (live) setInfo(result);
    });
    return () => {
      live = false;
    };
  }, []);

  return info;
}
