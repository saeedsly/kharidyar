package com.saeedsalari.kharidyar;

import android.util.Base64;
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

/** Reads bundled OCR models through AssetManager instead of the Android 7 WebView URL that returns 404. */
@CapacitorPlugin(name = "OfflineOcrAssets")
public class OfflineOcrAssetsPlugin extends Plugin {
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
            call.reject("Could not read the bundled " + code + " OCR model from the APK.", error);
        }
    }

    private byte[] getLanguageData(String code) throws IOException {
        byte[] cached = languageCache.get(code);
        if (cached != null) return cached;

        String assetPath = "public/tessdata/" + code + ".traineddata.gz";
        try (InputStream input = getContext().getAssets().open(assetPath);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[64 * 1024];
            int bytesRead;
            while ((bytesRead = input.read(buffer)) != -1) {
                output.write(buffer, 0, bytesRead);
            }
            byte[] loaded = output.toByteArray();
            languageCache.put(code, loaded);
            return loaded;
        }
    }
}
