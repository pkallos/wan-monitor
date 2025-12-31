import { Center, Spinner } from '@chakra-ui/react';
import { Dashboard } from '@/components/Dashboard';
import { Login } from '@/components/Login';
import { AuthProvider, useAuth } from '@/context/AuthContext';

function AppContent() {
  const { isAuthenticated, isLoading, authRequired } = useAuth();

  if (isLoading) {
    return (
      <Center minH="100vh">
        <Spinner size="xl" />
      </Center>
    );
  }

  if (authRequired && !isAuthenticated) {
    return <Login />;
  }

  return <Dashboard />;
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
