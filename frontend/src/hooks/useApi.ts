import { useMemo } from "react";
import { LendoorApi } from "@/lib/api";
import { useBorrower } from "@/providers/BorrowerProvider";

export function useApi(): LendoorApi {
  const { refreshAccessToken } = useBorrower();
  return useMemo(() => new LendoorApi(refreshAccessToken), [refreshAccessToken]);
}
