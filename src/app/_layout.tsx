import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';

import { initDatabase } from '@/database/db';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    async function prepare() {
      try {
        await initDatabase();
      } catch (e) {
        console.error('[RootLayout] Database init error:', e);
      } finally {
        setDbReady(true);
        await SplashScreen.hideAsync();
      }
    }
    prepare();
  }, []);

  if (!dbReady) {
    // Keep splash screen visible until DB is ready
    return null;
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="index" options={{ title: 'SMS Tracker' }} />
      </Stack>
    </ThemeProvider>
  );
}
