package com.saeedsalari.kharidyar;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.util.Base64;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.googlecode.tesseract.android.ResultIterator;
import com.googlecode.tesseract.android.TessBaseAPI;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.GZIPInputStream;

/** Runs offline receipt OCR with the native Android Tesseract engine. */
@CapacitorPlugin(name = "OfflineOcrAssets")
public class OfflineOcrAssetsPlugin extends Plugin {
    private static final String TAG = "OfflineOcrAssets";
    private static final int MAX_IMAGE_BASE64_CHARS = 12 * 1024 * 1024;
    private static final int MAX_IMAGE_EDGE = 5000;
    private static final int COPY_BUFFER_BYTES = 64 * 1024;

    private final ExecutorService ocrExecutor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean scanRunning = new AtomicBoolean(false);
    private volatile TessBaseAPI activeTessApi;
    private TessBaseAPI tessBaseApi;
    private String initializedLanguage = "";

    @PluginMethod
    public void recognizeReceipt(PluginCall call) {
        String imageBase64 = call.getString("imageBase64");
        String language = call.getString("language");
        Integer width = call.getInt("width");
        Integer height = call.getInt("height");

        if (!("fas+eng".equals(language) || "tur+eng".equals(language))) {
            call.reject("Unsupported offline OCR language.");
            return;
        }
        if (imageBase64 == null || imageBase64.isEmpty() || imageBase64.length() > MAX_IMAGE_BASE64_CHARS) {
            call.reject("Invalid or oversized receipt image.");
            return;
        }
        if (width == null || height == null || width < 1 || height < 1 || width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE) {
            call.reject("Invalid receipt image dimensions.");
            return;
        }
        if (!scanRunning.compareAndSet(false, true)) {
            call.reject("Another offline OCR scan is already running.");
            return;
        }

        try {
            ocrExecutor.execute(() -> performRecognition(call, imageBase64, language, width, height));
        } catch (RejectedExecutionException error) {
            scanRunning.set(false);
            call.reject("The offline OCR engine is shutting down.", error);
        }
    }

    @PluginMethod
    public void cancelRecognition(PluginCall call) {
        TessBaseAPI api = activeTessApi;
        if (api != null) {
            try {
                api.stop();
            } catch (RuntimeException error) {
                Log.w(TAG, "Could not stop the active OCR scan", error);
            }
        }
        call.resolve();
    }

    private void performRecognition(PluginCall call, String imageBase64, String language, int expectedWidth, int expectedHeight) {
        Bitmap bitmap = null;
        TessBaseAPI api = null;
        try {
            sendProgress("آماده‌سازی مدل‌های آفلاین روی گوشی...", 0);
            byte[] imageBytes = Base64.decode(imageBase64, Base64.DEFAULT);
            bitmap = BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.length);
            if (bitmap == null) throw new IOException("Android could not decode the compressed receipt image.");
            if (bitmap.getWidth() != expectedWidth || bitmap.getHeight() != expectedHeight) {
                throw new IOException("Receipt image dimensions changed during native transfer.");
            }

            String dataPath = ensureLanguageModels(language);
            api = getOrCreateTessApi(dataPath, language);
            activeTessApi = api;
            api.setPageSegMode(TessBaseAPI.PageSegMode.PSM_AUTO);
            api.setImage(bitmap);

            sendProgress("در حال خواندن متن فاکتور با موتور بومی...", 0);
            // HOCR recognition is cancellable and provides native progress callbacks.
            api.getHOCRText(0);
            String text = api.getUTF8Text();
            JSArray lines = extractTextLines(api);

            JSObject result = new JSObject();
            result.put("text", text == null ? "" : text);
            result.put("confidence", api.meanConfidence());
            result.put("lines", lines);
            call.resolve(result);
        } catch (Exception error) {
            Log.e(TAG, "Native offline OCR failed", error);
            call.reject("Offline OCR failed: " + error.getClass().getSimpleName() + ": " + error.getMessage(), error);
        } finally {
            if (api != null) {
                try {
                    api.clear();
                } catch (RuntimeException error) {
                    Log.w(TAG, "Could not clear the previous OCR image", error);
                }
            }
            if (bitmap != null && !bitmap.isRecycled()) bitmap.recycle();
            activeTessApi = null;
            scanRunning.set(false);
        }
    }

    private TessBaseAPI getOrCreateTessApi(String dataPath, String language) {
        if (tessBaseApi != null && !language.equals(initializedLanguage)) {
            tessBaseApi.recycle();
            tessBaseApi = null;
            initializedLanguage = "";
        }
        if (tessBaseApi == null) {
            TessBaseAPI created = new TessBaseAPI(progressValues ->
                sendProgress("در حال تشخیص متن فاکتور روی گوشی...", progressValues.getPercent())
            );
            if (!created.init(dataPath, language, TessBaseAPI.OEM_LSTM_ONLY)) {
                created.recycle();
                throw new IllegalStateException("Tesseract could not initialize language " + language + ".");
            }
            created.setPageSegMode(TessBaseAPI.PageSegMode.PSM_AUTO);
            tessBaseApi = created;
            initializedLanguage = language;
            Log.i(TAG, "Initialized native Tesseract for " + language + " using " + dataPath);
        }
        return tessBaseApi;
    }

    private String ensureLanguageModels(String language) throws IOException {
        File dataRoot = new File(getContext().getFilesDir(), "offline-tesseract");
        File tessdataDirectory = new File(dataRoot, "tessdata");
        if (!tessdataDirectory.isDirectory() && !tessdataDirectory.mkdirs() && !tessdataDirectory.isDirectory()) {
            throw new IOException("Could not create the private Tesseract model directory.");
        }

        for (String code : language.split("\\+")) {
            File modelFile = new File(tessdataDirectory, code + ".traineddata");
            if (modelFile.isFile() && modelFile.length() > 1024) continue;

            File temporaryFile = new File(tessdataDirectory, code + ".traineddata.tmp");
            try (InputStream raw = getActivity().getResources().openRawResource(getLanguageResourceId(code));
                 GZIPInputStream input = new GZIPInputStream(raw);
                 BufferedOutputStream output = new BufferedOutputStream(new FileOutputStream(temporaryFile))) {
                byte[] buffer = new byte[COPY_BUFFER_BYTES];
                int bytesRead;
                while ((bytesRead = input.read(buffer)) != -1) output.write(buffer, 0, bytesRead);
            }

            if (modelFile.exists() && !modelFile.delete()) {
                temporaryFile.delete();
                throw new IOException("Could not replace the cached " + code + " OCR model.");
            }
            if (!temporaryFile.renameTo(modelFile)) {
                temporaryFile.delete();
                throw new IOException("Could not install the private " + code + " OCR model.");
            }
            Log.i(TAG, "Extracted " + code + " OCR model to private app storage (" + modelFile.length() + " bytes)");
        }
        return dataRoot.getAbsolutePath();
    }

    private JSArray extractTextLines(TessBaseAPI api) {
        JSArray lines = new JSArray();
        ResultIterator iterator = api.getResultIterator();
        if (iterator == null) return lines;

        int level = TessBaseAPI.PageIteratorLevel.RIL_TEXTLINE;
        try {
            iterator.begin();
            do {
                String text = iterator.getUTF8Text(level);
                if (text == null || text.trim().isEmpty()) continue;

                Rect bounds = iterator.getBoundingRect(level);
                JSObject line = new JSObject();
                line.put("text", text.trim());
                line.put("confidence", Math.round(iterator.confidence(level)));

                JSObject box = new JSObject();
                box.put("x0", bounds.left);
                box.put("y0", bounds.top);
                box.put("x1", bounds.right);
                box.put("y1", bounds.bottom);
                line.put("bbox", box);
                lines.put(line);
            } while (iterator.next(level));
        } finally {
            iterator.delete();
        }
        return lines;
    }

    private int getLanguageResourceId(String code) {
        switch (code) {
            case "fas":
                return R.raw.fas_traineddata;
            case "eng":
                return R.raw.eng_traineddata;
            case "tur":
                return R.raw.tur_traineddata;
            default:
                throw new IllegalArgumentException("Unsupported offline OCR language: " + code);
        }
    }

    private void sendProgress(String stage, int percent) {
        JSObject progress = new JSObject();
        progress.put("stage", stage);
        progress.put("percent", percent);
        notifyListeners("ocrProgress", progress);
    }

    @Override
    protected void handleOnDestroy() {
        TessBaseAPI activeApi = activeTessApi;
        if (activeApi != null) {
            try {
                activeApi.stop();
            } catch (RuntimeException error) {
                Log.w(TAG, "Could not stop OCR during plugin shutdown", error);
            }
        }
        try {
            ocrExecutor.execute(() -> {
                if (tessBaseApi != null) {
                    tessBaseApi.recycle();
                    tessBaseApi = null;
                    initializedLanguage = "";
                }
            });
        } catch (RejectedExecutionException error) {
            Log.w(TAG, "OCR executor was already shut down", error);
        }
        ocrExecutor.shutdown();
        super.handleOnDestroy();
    }
}
