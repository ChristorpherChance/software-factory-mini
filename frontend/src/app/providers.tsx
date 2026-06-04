"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
      })
  );
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}
