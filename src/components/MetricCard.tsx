import { Box, Heading, Text, useColorModeValue } from '@chakra-ui/react';
import type { ReactNode } from 'react';

export interface MetricCardProps {
  title: string;
  value?: string | number;
  unit?: string;
  status?: 'good' | 'warning' | 'error';
  children?: ReactNode;
}

export function MetricCard({
  title,
  value,
  unit,
  status,
  children,
}: MetricCardProps) {
  const bg = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.700');

  const getStatusColor = () => {
    if (!status) return undefined;
    const colors = {
      good: 'green.500',
      warning: 'orange.500',
      error: 'red.500',
    };
    return colors[status];
  };

  return (
    <Box
      bg={bg}
      borderWidth="1px"
      borderColor={borderColor}
      borderRadius="lg"
      p={6}
      shadow="sm"
      _hover={{ shadow: 'md' }}
      transition="box-shadow 0.2s"
    >
      <Heading size="sm" mb={3} color="gray.500" textTransform="uppercase">
        {title}
      </Heading>
      {value !== undefined && (
        <Text fontSize="3xl" fontWeight="bold" color={getStatusColor()}>
          {value}
          {unit && (
            <Text as="span" fontSize="md" ml={1} fontWeight="normal">
              {unit}
            </Text>
          )}
        </Text>
      )}
      {children}
    </Box>
  );
}
