"use client";

import { useEffect, useState } from "react";
import { subscribeToDbChanges } from "@/lib/db";

export function useDbSync() {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    return subscribeToDbChanges(() => {
      setRevision((value) => value + 1);
    });
  }, []);

  return { revision };
}