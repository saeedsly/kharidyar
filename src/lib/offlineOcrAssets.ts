import { registerPlugin } from '@capacitor/core';

export type OfflineOcrLanguageCode = 'fas' | 'eng' | 'tur';

interface OfflineOcrAssetChunk {
  data: string;
  offset: number;
  totalBytes: number;
}

interface OfflineOcrAssetsPlugin {
  readLanguageChunk(options: {
    code: OfflineOcrLanguageCode;
    offset: number;
    length: number;
  }): Promise<OfflineOcrAssetChunk>;
}

export const OfflineOcrAssets = registerPlugin<OfflineOcrAssetsPlugin>('OfflineOcrAssets');
