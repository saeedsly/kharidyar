package com.saeedsalari.kharidyar;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.net.Uri;
import android.util.Base64;
import android.util.Log;
import android.webkit.MimeTypeMap;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.googlecode.tesseract.android.ResultIterator;
import com.googlecode.tesseract.android.TessBaseAPI;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;
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
    private static final long MAX_PICKED_IMAGE_BYTES = 40L * 1024L * 1024L;
    private static final int COPY_BUFFER_BYTES = 64 * 1024;

    private final ExecutorService ocrExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService fileExecutor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean scanRunning = new AtomicBoolean(false);
    private volatile TessBaseAPI activeTessApi;
    private TessBaseAPI tessBaseApi;
    private String initializedLanguage = "";

    /** Opens Android's system document picker without requesting broad storage permissions. */
    @PluginMethod
    public void pickReceiptImage(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        try {
            startActivityForResult(call, intent, "handlePickedReceiptImage");
        } catch (ActivityNotFoundException error) {
            call.reject("Android could not open the file picker.", error);
        }
    }

    @ActivityCallback
    private void handlePickedReceiptImage(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Image selection cancelled.", "PICKER_CANCELLED");
            return;
        }

        Uri imageUri = result.getData().getData();
        if (imageUri == null) {
            call.reject("No image was selected.");
            return;
        }

        boolean hasPersistedReadPermission = false;
        try {
            getContext().getContentResolver().takePersistableUriPermission(
                imageUri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION
            );
            hasPersistedReadPermission = true;
        } catch (SecurityException | IllegalArgumentException ignored) {
            // Some document providers grant temporary access only; the image is copied immediately.
        }

        final boolean releasePermissionAfterCopy = hasPersistedReadPermission;
        try {
            fileExecutor.execute(() -> copyPickedImageToCache(call, imageUri, releasePermissionAfterCopy));
        } catch (RejectedExecutionException error) {
            call.reject("The image picker is shutting down.", error);
        }
    }

    private void copyPickedImageToCache(PluginCall call, Uri imageUri, boolean releasePermissionAfterCopy) {
        File copiedFile = null;
        try {
            String mimeType = getContext().getContentResolver().getType(imageUri);
            String imageMimeType = mimeType != null && mimeType.toLowerCase(Locale.ROOT).startsWith("image/")
                ? mimeType
                : null;
            String extension = imageMimeType == null
                ? null
                : MimeTypeMap.getSingleton().getExtensionFromMimeType(imageMimeType);
            if (extension == null || extension.isEmpty()) extension = "jpg";

            File pickerDirectory = new File(getContext().getCacheDir(), "receipt-picker");
            if (!pickerDirectory.isDirectory() && !pickerDirectory.mkdirs() && !pickerDirectory.isDirectory()) {
                throw new IOException("Could not create the temporary image directory.");
            }
            removeExpiredPickedImages(pickerDirectory);
            copiedFile = File.createTempFile("receipt-", "." + extension, pickerDirectory);

            long totalBytes = 0;
            try (InputStream input = getContext().getContentResolver().openInputStream(imageUri);
                 BufferedOutputStream output = new BufferedOutputStream(new FileOutputStream(copiedFile))) {
                if (input == null) throw new IOException("Android could not read the selected image.");
                byte[] buffer = new byte[COPY_BUFFER_BYTES];
                int bytesRead;
                while ((bytesRead = input.read(buffer)) != -1) {
                    totalBytes += bytesRead;
                    if (totalBytes > MAX_PICKED_IMAGE_BYTES) {
                        throw new IOException("The selected image is larger than 40 MB.");
                    }
                    output.write(buffer, 0, bytesRead);
                }
            }
            if (totalBytes == 0) throw new IOException("The selected image is empty.");
            BitmapFactory.Options imageBounds = new BitmapFactory.Options();
            imageBounds.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(copiedFile.getAbsolutePath(), imageBounds);
            if (imageBounds.outWidth <= 0 || imageBounds.outHeight <= 0) {
                throw new IOException("The selected file is not a readable image.");
            }

            JSObject pickedImage = new JSObject();
            pickedImage.put("path", copiedFile.getAbsolutePath());
            pickedImage.put("mimeType", imageMimeType == null ? "" : imageMimeType);
            call.resolve(pickedImage);
        } catch (Exception error) {
            if (copiedFile != null) copiedFile.delete();
            Log.e(TAG, "Could not copy the selected receipt image", error);
            call.reject("Could not read the selected image.", error);
        } finally {
            if (releasePermissionAfterCopy) {
                try {
                    getContext().getContentResolver().releasePersistableUriPermission(
                        imageUri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION
                    );
                } catch (SecurityException | IllegalArgumentException ignored) {
                    // The selected document provider may have granted temporary access only.
                }
            }
        }
    }

    private void removeExpiredPickedImages(File pickerDirectory) {
        File[] files = pickerDirectory.listFiles();
        if (files == null) return;
        long expirationTime = System.currentTimeMillis() - 24L * 60L * 60L * 1000L;
        for (File file : files) {
            if (file.isFile() && file.lastModified() < expirationTime) file.delete();
        }
    }

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

    private static final class RecognitionPass {
        final String text;
        final int confidence;
        final JSArray lines;

        RecognitionPass(String text, int confidence, JSArray lines) {
            this.text = text == null ? "" : text;
            this.confidence = confidence;
            this.lines = lines;
        }

        int score() {
            return confidence * 2 + Math.min(60, lines.length() * 3) + Math.min(40, text.length() / 12);
        }
    }

    private RecognitionPass recognizeWithPageSegMode(TessBaseAPI api, Bitmap bitmap, int pageSegMode) {
        api.setPageSegMode(pageSegMode);
        api.setImage(bitmap);
        api.getHOCRText(0);
        return new RecognitionPass(api.getUTF8Text(), api.meanConfidence(), extractTextLines(api));
    }

    private boolean shouldRetryRecognition(RecognitionPass result, Bitmap bitmap) {
        int minimumCharacters = Math.max(80, Math.min(200, bitmap.getHeight() / 10));
        return result.confidence < 75 || result.lines.length() < 10 || result.text.trim().length() < minimumCharacters;
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
            boolean portraitReceipt = bitmap.getHeight() > bitmap.getWidth() * 1.15f;
            int primaryMode = portraitReceipt
                ? TessBaseAPI.PageSegMode.PSM_SINGLE_COLUMN
                : TessBaseAPI.PageSegMode.PSM_AUTO;
            int alternateMode = portraitReceipt
                ? TessBaseAPI.PageSegMode.PSM_AUTO
                : TessBaseAPI.PageSegMode.PSM_SINGLE_COLUMN;

            sendProgress("در حال خواندن متن فاکتور با موتور بومی...", 0);
            // A long receipt is usually one text column. If the first layout is sparse or weak,
            // retry once with the alternate segmentation mode and keep the stronger result.
            RecognitionPass bestPass = recognizeWithPageSegMode(api, bitmap, primaryMode);
            if (shouldRetryRecognition(bestPass, bitmap)) {
                sendProgress("در حال بررسی دوبارهٔ متن فاکتور...", 0);
                RecognitionPass alternatePass = recognizeWithPageSegMode(api, bitmap, alternateMode);
                if (alternatePass.score() > bestPass.score()) bestPass = alternatePass;
            }

            JSObject result = new JSObject();
            result.put("text", bestPass.text);
            result.put("confidence", bestPass.confidence);
            result.put("lines", bestPass.lines);
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
            if (!created.setVariable("user_defined_dpi", "300")) {
                Log.w(TAG, "Tesseract did not accept the receipt DPI hint");
            }
            if (!created.setVariable("preserve_interword_spaces", "1")) {
                Log.w(TAG, "Tesseract did not enable preserved spaces");
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
        fileExecutor.shutdown();
        super.handleOnDestroy();
    }
}
