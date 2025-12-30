import { Box, Container, Heading, Text } from '@chakra-ui/react';

function App() {
  return (
    <Container maxW="container.xl" py={8}>
      <Box textAlign="center">
        <Heading as="h1" size="2xl" mb={4}>
          WAN Monitor
        </Heading>
        <Text fontSize="lg" color="gray.600">
          Network monitoring dashboard - initialization complete
        </Text>
      </Box>
    </Container>
  );
}

export default App;
