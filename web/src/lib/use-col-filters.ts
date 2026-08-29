"use client";

import { useState } from "react";
import { colFiltersParam, type ColFilter } from "@/lib/api";

export function useColFilters() {
  const [colFilters, setColFilters] = useState<ColFilter[]>([]);
  return {
    colFilters,
    onFiltersChange: setColFilters,
    colQuery: colFiltersParam(colFilters),
  };
}
