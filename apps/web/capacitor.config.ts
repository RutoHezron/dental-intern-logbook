import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Native app shell (Android now, iOS later) around the same web build.
 * The logbook database lives in the app's private storage on the phone;
 * automatic backups go to Documents/DentalLogbook.
 */
const config: CapacitorConfig = {
  appId: 'org.dentallogbook.intern',
  appName: 'Intern Logbook',
  webDir: 'dist',
  android: {
    // Clinical data: never allow plain-HTTP content or WebView debugging in release builds.
    allowMixedContent: false,
  },
};

export default config;
