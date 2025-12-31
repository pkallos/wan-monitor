import { Box, Skeleton } from "@chakra-ui/react";
import type { ReactElement } from "react";
import { ResponsiveContainer } from "recharts";

export interface ChartContainerProps {
  height?: number;
  isLoading?: boolean;
  children: ReactElement;
}

export function ChartContainer({
  height = 300,
  isLoading = false,
  children,
}: ChartContainerProps) {
  if (isLoading) {
    return <Skeleton height={`${height}px`} borderRadius="md" />;
  }

  return (
    <Box height={`${height}px`} width="100%" overflow="visible" py={2}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </Box>
  );
}
