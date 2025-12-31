import { useColorModeValue } from '@chakra-ui/react';

export function useChartTheme() {
  const gridColor = useColorModeValue('#e2e8f0', '#2d3748');
  const textColor = useColorModeValue('#4a5568', '#a0aec0');
  const tooltipBg = useColorModeValue('#fff', '#1a202c');
  const tooltipBorder = useColorModeValue('#e2e8f0', '#2d3748');

  return {
    gridColor,
    textColor,
    tooltipBg,
    tooltipBorder,
    colors: {
      primary: '#3182ce',
      success: '#38a169',
      warning: '#d69e2e',
      danger: '#e53e3e',
      info: '#4299e1',
    },
  };
}
