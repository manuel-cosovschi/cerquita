import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from '@/lib/session';
import { theme } from '@/lib/theme';

/**
 * The app shell.
 *
 * The session sits above navigation for the same reason it does on the web:
 * friend pricing, social proof and who may see an address are all resolved per
 * viewer, so no screen can render correctly without it.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: theme.color.background },
            headerTitleStyle: {
              fontWeight: theme.font.weight.black,
              color: theme.color.text,
            },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: theme.color.background },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'Cerca tuyo' }} />
          <Stack.Screen name="map" options={{ title: 'Mapa' }} />
          <Stack.Screen name="listing/[id]" options={{ title: 'Publicación' }} />
          <Stack.Screen name="chat/[id]" options={{ title: 'Chat' }} />
          <Stack.Screen name="account" options={{ title: 'Cuenta' }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
