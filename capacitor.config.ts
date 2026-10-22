import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.saeedsalari.kharidyar',
  appName: 'خریدیـار',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
    backgroundColor: '#F2F5F9',
  },
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
};

export default config;
