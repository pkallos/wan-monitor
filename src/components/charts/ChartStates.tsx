import { Box, Text } from '@chakra-ui/react';

export interface ErrorStateProps {
  message: string;
}

export function ErrorState({ message }: ErrorStateProps) {
  return (
    <Box textAlign="center" py={8}>
      <Text color="red.500" fontWeight="medium">
        {message}
      </Text>
    </Box>
  );
}

export interface EmptyStateProps {
  message: string;
}

export function EmptyState({ message }: EmptyStateProps) {
  return (
    <Box textAlign="center" py={8}>
      <Text color="gray.500">{message}</Text>
    </Box>
  );
}
