import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface NativeOcrLine {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface NativeOcrResult {
  text: string;
  confidence: number;
  lines: NativeOcrLine[];
}

export interface NativeOcrProgress {
  stage: string;
  percent: number;
}

interface OfflineOcrAssetsPlugin {
  pickReceiptImage(): Promise<{ path: string; mimeType: string }>;
  recognizeReceipt(options: {
    imageBase64: string;
    language: string;
    width: number;
    height: number;
    longReceipt?: boolean;
    receiptTail?: boolean;
  }): Promise<NativeOcrResult>;
  cancelRecognition(): Promise<void>;
  addListener(
    eventName: 'ocrProgress',
    listenerFunc: (progress: NativeOcrProgress) => void
  ): Promise<PluginListenerHandle>;
}

export const OfflineOcrAssets = registerPlugin<OfflineOcrAssetsPlugin>('OfflineOcrAssets');
