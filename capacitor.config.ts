import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ir.kharidyar.app',
  appName: 'خریدیـار',
  webDir: 'dist',
  bundledWebRuntime: false,
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
