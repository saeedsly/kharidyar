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
import java.util.regex.Matcher;
import java.util.regex.Pattern;
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
    private static final Pattern RECEIPT_AMOUNT_PATTERN = Pattern.compile(
        "(?<![0-9۰-۹٠-٩])(?:[0-9۰-۹٠-٩]{1,3}(?:[,،.][0-9۰-۹٠-٩]{3})+|[0-9۰-۹٠-٩]{4,10})(?![0-9۰-۹٠-٩])"
    );
    private static final Pattern PERSIAN_LETTER_PATTERN = Pattern.compile("[\\u0600-\\u06FF]");

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
        boolean longReceipt = Boolean.TRUE.equals(call.getBoolean("longReceipt", false));
        boolean receiptTail = Boolean.TRUE.equals(call.getBoolean("receiptTail", false));

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
            ocrExecutor.execute(() -> performRecognition(call, imageBase64, language, width, height, longReceipt, receiptTail));
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
            int amountCount = 0;
            Matcher amountMatcher = RECEIPT_AMOUNT_PATTERN.matcher(text);
            while (amountMatcher.find()) amountCount++;
            int persianLetterCount = 0;
            Matcher persianMatcher = PERSIAN_LETTER_PATTERN.matcher(text);
            while (persianMatcher.find()) persianLetterCount++;
            String lowerText = text.toLowerCase(Locale.ROOT);
            int receiptKeywordCount = 0;
            for (String keyword : new String[] { "جمع", "پرداخت", "تخفیف", "مالیات", "total", "amount", "discount", "tax" }) {
                if (lowerText.contains(keyword)) receiptKeywordCount++;
            }
            return confidence * 2
                + Math.min(800, lines.length() * 4)
                + Math.min(300, text.length() / 10)
                + Math.min(1200, amountCount * 16)
                + Math.min(1200, persianLetterCount * 2)
                + receiptKeywordCount * 20;
        }
    }

    private RecognitionPass recognizeWithPageSegMode(TessBaseAPI api, Bitmap bitmap, int pageSegMode) {
        api.setPageSegMode(pageSegMode);
        api.setImage(bitmap);
        return new RecognitionPass(api.getUTF8Text(), api.meanConfidence(), extractTextLines(api));
    }

    private boolean shouldRetryRecognition(RecognitionPass result, Bitmap bitmap, boolean portraitReceipt, boolean longReceipt) {
        int textLength = result.text.trim().length();
        Matcher amountMatcher = RECEIPT_AMOUNT_PATTERN.matcher(result.text);
        int amountCount = 0;
        while (amountMatcher.find()) amountCount++;
        boolean hasAmount = amountCount > 0;
        Matcher persianMatcher = PERSIAN_LETTER_PATTERN.matcher(result.text);
        int persianLetterCount = 0;
        while (persianMatcher.find()) persianLetterCount++;
        boolean hasPersianText = persianLetterCount > 0;
        if (longReceipt) {
            int minimumAmountCount = Math.max(4, Math.min(36, bitmap.getHeight() / 80));
            int minimumLineCount = Math.max(8, Math.min(40, bitmap.getHeight() / 70));
            int minimumPersianLetterCount = Math.max(50, Math.min(300, bitmap.getHeight() / 10));
            return result.confidence < 52
                || result.lines.length() < minimumLineCount
                || textLength < 80
                || amountCount < minimumAmountCount
                || persianLetterCount < minimumPersianLetterCount;
        }
        if (portraitReceipt) {
            int minimumCharacters = Math.max(70, Math.min(180, bitmap.getHeight() / 12));
            return result.confidence < 82
                || result.lines.length() < 10
                || textLength < minimumCharacters
                || !hasAmount
                || !hasPersianText;
        }
        return result.confidence < 70
            || result.lines.length() < 8
            || textLength < 80
            || !hasAmount;
    }

    private void performRecognition(PluginCall call, String imageBase64, String language, int expectedWidth, int expectedHeight, boolean longReceipt, boolean receiptTail) {
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
                ? TessBaseAPI.PageSegMode.PSM_SINGLE_BLOCK
                : TessBaseAPI.PageSegMode.PSM_SINGLE_COLUMN;

            sendProgress("در حال خواندن متن و رقم‌های فاکتور با موتور بومی...", 0);
            // Long receipts get an alternate pass at the footer, where totals are printed, and
            // earlier tiles retry only when the first pass has weak text or too few price tokens.
            RecognitionPass bestPass = recognizeWithPageSegMode(api, bitmap, primaryMode);
            boolean longThermalLayout = !longReceipt && portraitReceipt && bitmap.getHeight() > bitmap.getWidth() * 2.3f;
            if (receiptTail || longThermalLayout || shouldRetryRecognition(bestPass, bitmap, portraitReceipt, longReceipt)) {
                sendProgress("در حال بازبینی دوبارهٔ خطوط و رقم‌های فاکتور...", 0);
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

    private static final class OcrWord {
        final String text;
        final int confidence;
        final Rect bounds;
        final int sequence;

        OcrWord(String text, int confidence, Rect bounds, int sequence) {
            this.text = text;
            this.confidence = confidence;
            this.bounds = bounds;
            this.sequence = sequence;
        }
    }

    private static final class OcrTextLine {
        final java.util.List<OcrWord> words = new java.util.ArrayList<>();
        int top = Integer.MAX_VALUE;
        int left = Integer.MAX_VALUE;
        int bottom = Integer.MIN_VALUE;
        int right = Integer.MIN_VALUE;
        int baseline;
        int confidenceTotal;

        void add(OcrWord word) {
            int oldCount = words.size();
            words.add(word);
            top = Math.min(top, word.bounds.top);
            left = Math.min(left, word.bounds.left);
            bottom = Math.max(bottom, word.bounds.bottom);
            right = Math.max(right, word.bounds.right);
            baseline = oldCount == 0
                ? word.bounds.bottom
                : Math.round((baseline * oldCount + word.bounds.bottom) / (float) (oldCount + 1));
            confidenceTotal += word.confidence;
        }

        int verticalTolerance(OcrWord word) {
            int rowHeight = Math.max(bottom - top, word.bounds.height());
            return Math.max(5, Math.min(18, Math.round(rowHeight * 0.55f)));
        }

        String text() {
            java.util.Collections.sort(words, (first, second) -> Integer.compare(first.sequence, second.sequence));
            StringBuilder text = new StringBuilder();
            for (OcrWord word : words) {
                if (text.length() > 0) text.append(' ');
                text.append(word.text);
            }
            return text.toString().trim();
        }

        JSObject toJson() {
            JSObject line = new JSObject();
            line.put("text", text());
            line.put("confidence", words.isEmpty() ? 0 : Math.round(confidenceTotal / (float) words.size()));

            JSObject box = new JSObject();
            box.put("x0", left);
            box.put("y0", top);
            box.put("x1", right);
            box.put("y1", bottom);
            line.put("bbox", box);
            return line;
        }
    }

    private JSArray extractTextLines(TessBaseAPI api) {
        JSArray wordLines = new JSArray();
        ResultIterator iterator = api.getResultIterator();
        if (iterator != null) {
            java.util.List<OcrWord> words = new java.util.ArrayList<>();
            int level = TessBaseAPI.PageIteratorLevel.RIL_WORD;
            try {
                iterator.begin();
                int sequence = 0;
                do {
                    String text = iterator.getUTF8Text(level);
                    if (text == null || text.trim().isEmpty()) continue;
                    Rect bounds = iterator.getBoundingRect(level);
                    if (bounds == null || bounds.isEmpty()) continue;
                    words.add(new OcrWord(text.trim(), Math.round(iterator.confidence(level)), bounds, sequence++));
                } while (iterator.next(level));
            } finally {
                iterator.delete();
            }

            java.util.Collections.sort(words, (first, second) -> {
                int verticalOrder = Integer.compare(first.bounds.bottom, second.bounds.bottom);
                return verticalOrder != 0 ? verticalOrder : Integer.compare(first.sequence, second.sequence);
            });

            java.util.List<OcrTextLine> groupedLines = new java.util.ArrayList<>();
            for (OcrWord word : words) {
                OcrTextLine match = null;
                for (int index = groupedLines.size() - 1; index >= 0; index--) {
                    OcrTextLine candidate = groupedLines.get(index);
                    if (Math.abs(candidate.baseline - word.bounds.bottom) <= candidate.verticalTolerance(word)) {
                        match = candidate;
                        break;
                    }
                    if (candidate.baseline < word.bounds.bottom - 24) break;
                }
                if (match == null) {
                    match = new OcrTextLine();
                    groupedLines.add(match);
                }
                match.add(word);
            }

            for (OcrTextLine groupedLine : groupedLines) {
                if (!groupedLine.words.isEmpty() && !groupedLine.text().isEmpty()) wordLines.put(groupedLine.toJson());
            }
        }
        if (wordLines.length() > 1) return wordLines;

        // Keep Tesseract's own text-line layout as a fallback for images with no usable word boxes.
        JSArray textLines = new JSArray();
        ResultIterator textIterator = api.getResultIterator();
        if (textIterator == null) return wordLines;
        int textLevel = TessBaseAPI.PageIteratorLevel.RIL_TEXTLINE;
        try {
            textIterator.begin();
            do {
                String text = textIterator.getUTF8Text(textLevel);
                if (text == null || text.trim().isEmpty()) continue;

                Rect bounds = textIterator.getBoundingRect(textLevel);
                if (bounds == null || bounds.isEmpty()) continue;
                JSObject line = new JSObject();
                line.put("text", text.trim());
                line.put("confidence", Math.round(textIterator.confidence(textLevel)));

                JSObject box = new JSObject();
                box.put("x0", bounds.left);
                box.put("y0", bounds.top);
                box.put("x1", bounds.right);
                box.put("y1", bounds.bottom);
                line.put("bbox", box);
                textLines.put(line);
            } while (textIterator.next(textLevel));
        } finally {
            textIterator.delete();
        }
        return textLines.length() > wordLines.length() ? textLines : wordLines;
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
