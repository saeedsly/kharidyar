package com.saeedsalari.kharidyar;

import android.content.res.AssetManager;
import android.util.Base64;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Reads bundled OCR models through AssetManager, independently of WebView asset routing. */
@CapacitorPlugin(name = "OfflineOcrAssets")
public class OfflineOcrAssetsPlugin extends Plugin {
    private static final String TAG = "OfflineOcrAssets";
    private static final String ASSET_DIRECTORY = "offline-ocr";
    private static final int MAX_CHUNK_BYTES = 192 * 1024;
    private final Map<String, byte[]> languageCache = new ConcurrentHashMap<>();

    @PluginMethod
    public void readLanguageChunk(PluginCall call) {
        String code = call.getString("code");
        Integer offsetValue = call.getInt("offset");
        Integer lengthValue = call.getInt("length");

        if (code == null || !("fas".equals(code) || "eng".equals(code) || "tur".equals(code))) {
            call.reject("Unsupported offline OCR language.");
            return;
        }
        if (offsetValue == null || lengthValue == null || offsetValue < 0 || lengthValue < 1 || lengthValue > MAX_CHUNK_BYTES) {
            call.reject("Invalid offline OCR asset range.");
            return;
        }

        try {
            byte[] languageData = getLanguageData(code);
            int offset = offsetValue;
            if (offset > languageData.length) {
                call.reject("Offline OCR asset range is out of bounds.");
                return;
            }
            int end = Math.min(languageData.length, offset + lengthValue);
            byte[] chunk = Arrays.copyOfRange(languageData, offset, end);

            JSObject result = new JSObject();
            result.put("data", Base64.encodeToString(chunk, Base64.NO_WRAP));
            result.put("offset", offset);
            result.put("totalBytes", languageData.length);
            call.resolve(result);
        } catch (IOException error) {
            String message = "Could not read bundled " + code + " OCR model from APK assets ("
                + error.getClass().getSimpleName() + ": " + error.getMessage() + ").";
            Log.e(TAG, message + " Available native model assets: " + listNativeAssets(), error);
            call.reject(message, error);
        }
    }

    private byte[] getLanguageData(String code) throws IOException {
        byte[] cached = languageCache.get(code);
        if (cached != null) return cached;

        String assetPath = ASSET_DIRECTORY + "/" + code + ".traineddata.gz";
        try (InputStream input = getActivity().getAssets().open(assetPath, AssetManager.ACCESS_STREAMING);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[64 * 1024];
            int bytesRead;
            while ((bytesRead = input.read(buffer)) != -1) {
                output.write(buffer, 0, bytesRead);
            }
            byte[] loaded = output.toByteArray();
            languageCache.put(code, loaded);
            Log.i(TAG, "Loaded " + assetPath + " (" + loaded.length + " bytes)");
            return loaded;
        }
    }

    private String listNativeAssets() {
        try {
            return Arrays.toString(getActivity().getAssets().list(ASSET_DIRECTORY));
        } catch (IOException error) {
            return "<could not list " + ASSET_DIRECTORY + ": " + error.getMessage() + ">";
        }
    }
}
