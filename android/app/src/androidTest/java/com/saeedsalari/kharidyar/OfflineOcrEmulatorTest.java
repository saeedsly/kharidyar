package com.saeedsalari.kharidyar;

import android.app.Instrumentation;
import android.os.SystemClock;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.UiDevice;
import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

@RunWith(AndroidJUnit4.class)
public class OfflineOcrEmulatorTest {
    private static final long APP_READY_TIMEOUT_MS = 30_000;
    private static final long OCR_TIMEOUT_MS = 300_000;

    @Test
    public void bundledReceiptOcrCompletesOfflineOnAndroid7() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<String> browserConsole = new AtomicReference<>("");
            AtomicReference<String> missingNativeModel = new AtomicReference<>();
            scenario.onActivity(activity -> {
                String[] languages = { "fas", "eng", "tur" };
                int[] modelResources = {
                    R.raw.fas_traineddata,
                    R.raw.eng_traineddata,
                    R.raw.tur_traineddata,
                };
                for (int index = 0; index < languages.length; index++) {
                    String language = languages[index];
                    try (InputStream input = activity.getResources().openRawResource(modelResources[index])) {
                        if (input.read() != 0x1f || input.read() != 0x8b) {
                            missingNativeModel.compareAndSet(null, language + " resource is not a valid gzip model");
                        }
                    } catch (IOException | RuntimeException error) {
                        missingNativeModel.compareAndSet(null, language + " resource is missing or unreadable: " + error);
                    }
                }
                WebView webView = activity.getBridge().getWebView();
                webView.setWebChromeClient(new WebChromeClient() {
                    @Override
                    public boolean onConsoleMessage(ConsoleMessage message) {
                        browserConsole.accumulateAndGet(message.message() + "\n", (oldValue, nextValue) -> oldValue + nextValue);
                        return true;
                    }
                });
            });
            assertTrue(
                "Native OCR model files were not packaged into the APK: " + missingNativeModel.get(),
                missingNativeModel.get() == null
            );

            long readyDeadline = SystemClock.elapsedRealtime() + APP_READY_TIMEOUT_MS;
            String body = "";
            while (SystemClock.elapsedRealtime() < readyDeadline) {
                try {
                    body = evaluate(scenario, "document.getElementById('root') ? document.getElementById('root').textContent : ''");
                } catch (AssertionError error) {
                    throw new AssertionError("WebView startup evaluation failed. Console: " + browserConsole.get(), error);
                }
                if (body.contains("فاکتور نمونه")) break;
                SystemClock.sleep(500);
            }
            if (!body.contains("فاکتور نمونه")) {
                // If startup failed before diagnostics were attached, reload only on failure so
                // the browser console captures the actual JavaScript compatibility error.
                scenario.onActivity(activity -> activity.getBridge().getWebView().reload());
                SystemClock.sleep(2_000);
                try {
                    body = evaluate(scenario, "document.getElementById('root') ? document.getElementById('root').textContent : ''");
                } catch (AssertionError error) {
                    throw new AssertionError("WebView did not respond after diagnostic reload. Console: " + browserConsole.get(), error);
                }
            }
            String pageState = evaluate(scenario,
                "JSON.stringify({href: location.href, readyState: document.readyState, title: document.title, " +
                "body: document.body ? document.body.innerHTML.substring(0, 1000) : 'no body', " +
                "text: document.body ? document.body.innerText : '', userAgent: navigator.userAgent, " +
                "moduleScriptsSupported: 'noModule' in HTMLScriptElement.prototype})"
            );
            assertTrue(
                "The app UI did not load in the emulator. Native URL: " + getNativeUrl(scenario) +
                " Page state: " + pageState + " Console: " + browserConsole.get(),
                body.contains("فاکتور نمونه")
            );
            verifySystemFilePicker(scenario);

            evaluate(scenario,
                "(() => { window.__emulatorOcrErrors = []; window.__emulatorOcrDebug = true; window.__emulatorOcrProgress = null; window.__emulatorOcrWorkerStatus = null; " +
                "window.addEventListener('error', e => window.__emulatorOcrErrors.push(String(e.message || e.error || 'window error'))); " +
                "window.addEventListener('unhandledrejection', e => window.__emulatorOcrErrors.push(String(e.reason || 'unhandled rejection'))); " +
                "return 'armed'; })()"
            );

            String clickResult = evaluate(scenario,
                "(() => { const button = Array.from(document.querySelectorAll('button')) " +
                ".find(element => (element.innerText || '').includes('فاکتور نمونه')); " +
                "if (!button) return 'button-not-found'; button.click(); return 'sample-scan-started'; })()"
            );
            assertEquals("The built-in receipt test button could not be activated.", "sample-scan-started", clickResult);

            long ocrDeadline = SystemClock.elapsedRealtime() + OCR_TIMEOUT_MS;
            String lastBody = "";
            String lastOcrProgress = "<no progress reported>";
            while (SystemClock.elapsedRealtime() < ocrDeadline) {
                lastBody = evaluate(scenario, "document.body ? document.body.innerText : ''");
                String progressSnapshot = evaluate(scenario,
                    "JSON.stringify({progress: window.__emulatorOcrProgress || null, worker: window.__emulatorOcrWorkerStatus || null, core: window.__emulatorOcrCorePath || null, userAgent: navigator.userAgent})"
                );
                if (!"{\"progress\":null,\"worker\":null}".equals(progressSnapshot)) lastOcrProgress = progressSnapshot;
                if (lastBody.contains("اطمینان خوانش:")) {
                    evaluate(scenario,
                        "(() => { const button = Array.from(document.querySelectorAll('button')) " +
                        ".find(element => (element.innerText || '').includes('متن خام OCR')); " +
                        "if (button) button.click(); return 'raw-text-opened'; })()"
                    );
                    String reviewedBody = evaluate(scenario, "document.body ? document.body.innerText : ''");
                    assertFalse("OCR completed but returned no recognized text.", reviewedBody.contains("متنی یافت نشد"));
                    String rawOcrText = evaluate(scenario,
                        "(() => { const node = document.querySelector('div.font-mono'); return node ? node.textContent || '' : ''; })()"
                    );
                    String itemNames = evaluate(scenario,
                        "JSON.stringify(Array.from(document.querySelectorAll('[data-testid=\"receipt-item-name\"]')).map(input => input.value))"
                    );
                    int recognizedLines = 0;
                    for (String line : rawOcrText.split("\\n")) {
                        if (!line.trim().isEmpty()) recognizedLines++;
                    }
                    String[] expectedItemNames = { "شیر", "پنیر", "تخم مرغ", "نان تست", "ماست", "چیپس" };
                    int matchedItemNames = 0;
                    for (String expectedName : expectedItemNames) {
                        if (itemNames.contains(expectedName)) matchedItemNames++;
                    }
                    int parsedItemCount = Integer.parseInt(evaluate(scenario,
                        "String(document.querySelectorAll('[data-testid=\"receipt-item-name\"]').length)"
                    ));
                    String parsedItemTotals = evaluate(scenario,
                        "JSON.stringify(Array.from(document.querySelectorAll('[data-testid=\"receipt-item-total\"]')) " +
                        ".map(element => Number(element.getAttribute('data-amount'))))"
                    );
                    String parsedSubtotal = evaluate(scenario,
                        "(function() { var node = document.querySelector('[data-testid=\"receipt-subtotal\"]'); " +
                        "return node ? node.getAttribute('data-amount') || '' : ''; })()"
                    );
                    String sourceSubtotal = evaluate(scenario,
                        "(function() { var node = document.querySelector('[data-testid=\"ocr-source-subtotal\"]'); " +
                        "return node ? node.getAttribute('data-amount') || '' : ''; })()"
                    );
                    String sourcePayableTotal = evaluate(scenario,
                        "(function() { var node = document.querySelector('[data-testid=\"ocr-source-total\"]'); " +
                        "return node ? node.getAttribute('data-amount') || '' : ''; })()"
                    );
                    String parsedDiscount = evaluate(scenario,
                        "(function() { var node = document.querySelector('[data-testid=\"receipt-discount\"]'); " +
                        "return node ? node.value || '' : ''; })()"
                    );
                    String parsedPayableTotal = evaluate(scenario,
                        "(function() { var node = document.querySelector('[data-testid=\"receipt-payable-total\"]'); " +
                        "return node ? node.getAttribute('data-amount') || '' : ''; })()"
                    );
                    String reviewDetails = evaluate(scenario,
                        "JSON.stringify((function() { var discount = document.querySelector('[data-testid=\"receipt-discount\"]'); " +
                        "var subtotal = document.querySelector('[data-testid=\"receipt-subtotal\"]'); " +
                        "var payable = document.querySelector('[data-testid=\"receipt-payable-total\"]'); " +
                        "return {discount: discount ? discount.outerHTML : null, subtotal: subtotal ? subtotal.outerHTML : null, " +
                        "payable: payable ? payable.outerHTML : null, " +
                        "inputs: Array.from(document.querySelectorAll('input')).map(function(input) { return {testId: input.getAttribute('data-testid'), value: input.value}; }), " +
                        "summary: document.body.innerText.slice(-700)}; })())"
                    );
                    assertTrue("OCR returned too little receipt text (" + rawOcrText.length() + " characters).", rawOcrText.length() >= 100);
                    assertTrue("OCR returned too few receipt lines (" + recognizedLines + "). Raw text: " + rawOcrText.substring(0, Math.min(400, rawOcrText.length())), recognizedLines >= 8);
                    assertTrue("OCR parsed " + parsedItemCount + " receipt items; expected all six. Names: " + itemNames + " Raw text: " + rawOcrText.substring(0, Math.min(400, rawOcrText.length())), parsedItemCount == 6);
                    assertTrue("OCR missed too many sample product names (" + matchedItemNames + "/6): " + itemNames, matchedItemNames >= 5);
                    assertTrue("OCR did not preserve the sample receipt subtotal.", rawOcrText.contains("443,000"));
                    assertTrue("OCR did not preserve the sample discount.", rawOcrText.contains("23,000"));
                    assertTrue("OCR did not preserve the sample payable amount.", rawOcrText.contains("420,000"));
                    assertEquals("The item prices were parsed incorrectly. OCR: " + rawOcrText,
                        "[98000,65000,115000,42000,78000,45000]", parsedItemTotals);
                    assertEquals("The editable item subtotal was parsed incorrectly. OCR: " + rawOcrText +
                        " Parsed item totals: " + parsedItemTotals + " Review state: " + reviewDetails,
                        "443000", parsedSubtotal);
                    assertEquals("The OCR source subtotal was not preserved. OCR: " + rawOcrText,
                        "443000", sourceSubtotal);
                    assertEquals("The OCR source payable total was not preserved. OCR: " + rawOcrText,
                        "420000", sourcePayableTotal);
                    assertEquals("The discount was parsed incorrectly. OCR: " + rawOcrText +
                        " Parsed subtotal: " + parsedSubtotal + " item totals: " + parsedItemTotals +
                        " Review state: " + reviewDetails, "23000", parsedDiscount);
                    assertEquals("The payable total was parsed incorrectly. OCR: " + rawOcrText +
                        " Review state: " + reviewDetails, "420000", parsedPayableTotal);
                    System.out.println("OFFLINE_OCR_EMULATOR_PASS: sample receipt produced " + rawOcrText.length() +
                        " OCR characters across " + recognizedLines + " lines and parsed " + parsedItemCount + " items. Names: " + itemNames +
                        ". Discount: " + parsedDiscount + ". Payable total: " + parsedPayableTotal);
                    verifyLongThermalReceipt(scenario);
                    return;
                }
                if (lastBody.contains("خواندن فاکتور در زمان مجاز تمام نشد")) {
                    fail("OFFLINE_OCR_EMULATOR_TIMEOUT: OCR reached the app's native scan timeout. Last progress: " + lastOcrProgress + " UI: " + lastBody + " Errors: " + getPageErrors(scenario) + " Console: " + browserConsole.get());
                }
                if (lastBody.contains("خواندن فاکتور ناموفق بود") || lastBody.contains("قابل خواندن نیست")) {
                    fail("OFFLINE_OCR_EMULATOR_ERROR: scan failed before review. Last progress: " + lastOcrProgress + " UI: " + lastBody + " Errors: " + getPageErrors(scenario));
                }
                SystemClock.sleep(750);
            }
            fail("OFFLINE_OCR_EMULATOR_TIMEOUT: OCR did not reach review within the configured app timeout. Last progress: " + lastOcrProgress + " Last UI: " + lastBody + " Errors: " + getPageErrors(scenario) + " Console: " + browserConsole.get());
        }
    }

    private static void verifyLongThermalReceipt(ActivityScenario<MainActivity> scenario) throws Exception {
        String rescanClick = evaluate(scenario,
            "(() => { const button = document.querySelector('[data-testid=\\\"receipt-rescan\\\"]'); " +
            "if (!button) return 'rescan-button-not-found'; button.click(); return 'capture-opened'; })()"
        );
        assertEquals("The scanner could not return to its sample list.", "capture-opened", rescanClick);

        long sampleButtonDeadline = SystemClock.elapsedRealtime() + 10_000;
        String sampleClick = "sample-button-not-found";
        while (SystemClock.elapsedRealtime() < sampleButtonDeadline && !"long-sample-started".equals(sampleClick)) {
            sampleClick = evaluate(scenario,
                "(() => { const button = document.querySelector('[data-testid=\\\"receipt-sample-thermal-long\\\"]'); " +
                "if (!button) return 'sample-button-not-found'; button.click(); return 'long-sample-started'; })()"
            );
            if (!"long-sample-started".equals(sampleClick)) SystemClock.sleep(250);
        }
        assertEquals("The 48-item thermal receipt sample was not available.", "long-sample-started", sampleClick);

        long deadline = SystemClock.elapsedRealtime() + OCR_TIMEOUT_MS;
        String body = "";
        String lastProgress = "<no progress reported>";
        while (SystemClock.elapsedRealtime() < deadline) {
            body = evaluate(scenario, "document.body ? document.body.innerText : ''");
            lastProgress = evaluate(scenario,
                "JSON.stringify({progress: window.__emulatorOcrProgress || null, worker: window.__emulatorOcrWorkerStatus || null})"
            );
            if (body.contains("اطمینان خوانش:")) break;
            if (body.contains("خواندن فاکتور در زمان مجاز تمام نشد") ||
                body.contains("خواندن فاکتور ناموفق بود") || body.contains("قابل خواندن نیست")) {
                fail("OFFLINE_OCR_LONG_RECEIPT_ERROR: long thermal OCR failed. Progress: " + lastProgress +
                    " UI: " + body + " Errors: " + getPageErrors(scenario));
            }
            SystemClock.sleep(750);
        }
        assertTrue("OFFLINE_OCR_LONG_RECEIPT_TIMEOUT: the 48-item receipt did not reach review. Progress: " +
            lastProgress + " UI: " + body + " Errors: " + getPageErrors(scenario), body.contains("اطمینان خوانش:"));

        String rawButton = evaluate(scenario,
            "(() => { const button = Array.from(document.querySelectorAll('button')) " +
            ".find(element => (element.innerText || '').includes('متن خام OCR')); " +
            "if (!button) return 'raw-text-button-not-found'; button.click(); return 'raw-text-opened'; })()"
        );
        assertEquals("Raw OCR text could not be opened for the long thermal sample.", "raw-text-opened", rawButton);
        String rawText = evaluate(scenario,
            "(() => { const node = document.querySelector('div.font-mono'); return node ? node.textContent || '' : ''; })()"
        );
        String itemNames = evaluate(scenario,
            "JSON.stringify(Array.from(document.querySelectorAll('[data-testid=\\\"receipt-item-name\\\"]')).map(input => input.value))"
        );
        String itemTotals = evaluate(scenario,
            "JSON.stringify(Array.from(document.querySelectorAll('[data-testid=\\\"receipt-item-total\\\"]')) " +
            ".map(element => Number(element.getAttribute('data-amount'))))"
        );
        String sourceSubtotal = evaluate(scenario,
            "(function() { var node = document.querySelector('[data-testid=\\\"ocr-source-subtotal\\\"]'); " +
            "return node ? node.getAttribute('data-amount') || '' : ''; })()"
        );
        String sourceTotal = evaluate(scenario,
            "(function() { var node = document.querySelector('[data-testid=\\\"ocr-source-total\\\"]'); " +
            "return node ? node.getAttribute('data-amount') || '' : ''; })()"
        );
        String discount = evaluate(scenario,
            "(function() { var node = document.querySelector('[data-testid=\\\"receipt-discount\\\"]'); " +
            "return node ? node.value || '' : ''; })()"
        );
        String payable = evaluate(scenario,
            "(function() { var node = document.querySelector('[data-testid=\\\"receipt-payable-total\\\"]'); " +
            "return node ? node.getAttribute('data-amount') || '' : ''; })()"
        );
        int parsedItemCount = Integer.parseInt(evaluate(scenario,
            "String(document.querySelectorAll('[data-testid=\\\"receipt-item-name\\\"]').length)"
        ));

        assertTrue("The long receipt produced too little raw OCR text (" + rawText.length() + " chars).",
            rawText.length() >= 1500);
        assertTrue("The OCR text did not include the 48-item receipt's subtotal.", rawText.contains("4,846,000"));
        assertTrue("The OCR text did not include the receipt discount.", rawText.contains("47,000"));
        assertTrue("The OCR text did not include the final payable amount.", rawText.contains("4,799,000"));
        assertEquals("The long thermal receipt should parse all 48 products. Item names: " + itemNames +
            " OCR excerpt: " + rawText.substring(0, Math.min(1400, rawText.length())), 48, parsedItemCount);
        String[] expectedNameFragments = {
            "شیر", "پنیر", "تخم مرغ", "نان", "ماست", "چیپس", "روغن", "گوجه", "دوغ", "مرغ",
            "برنج", "سیب", "چای", "قند", "ماکارونی", "رب گوجه", "زیتون", "آب", "نوشابه", "بیسکویت",
            "شکلات", "دستمال", "مایع", "پودر", "کره", "خامه", "عدس", "لوبیا", "نخود", "تن ماهی",
            "سس", "خیارشور", "عسل", "مربا", "قهوه", "آبمیوه", "موز", "پیاز", "لیمو", "شامپو",
            "صابون", "بستنی", "پسته", "خرما"
        };
        int recognizedNameFragments = 0;
        for (String fragment : expectedNameFragments) {
            if (itemNames.contains(fragment)) recognizedNameFragments++;
        }
        assertTrue("Too many long-receipt product names were lost (" + recognizedNameFragments + "/" +
            expectedNameFragments.length + "). Names: " + itemNames, recognizedNameFragments >= 36);
        assertEquals("The line-item prices differ from the 48-item thermal receipt fixture. OCR excerpt: " +
            rawText.substring(0, Math.min(1800, rawText.length())),
            "[98000,65000,115000,42000,78000,45000,89000,76000,58000,196000,650000,110000,145000,52000," +
            "81000,78000,210000,54000,64000,48000,68000,112000,74000,132000,59000,94000,36000,86000," +
            "94000,51000,156000,64000,83000,185000,72000,115000,56000,138000,52000,18000,44000,99000," +
            "51000,78000,24000,138000,225000,88000]",
            itemTotals);
        assertEquals("The printed subtotal was not extracted.", "4846000", sourceSubtotal);
        assertEquals("The printed final payable amount was not extracted.", "4799000", sourceTotal);
        assertEquals("The printed discount was not extracted.", "47000", discount);
        assertEquals("The payable total calculated from parsed items is wrong.", "4799000", payable);
        assertTrue("The review panel should identify the final amount as read from the receipt.",
            body.contains("مبلغ پرداختی خوانده‌شده"));
        System.out.println("OFFLINE_OCR_LONG_THERMAL_PASS: parsed 48/48 items; subtotal=" + sourceSubtotal +
            ", discount=" + discount + ", payable=" + sourceTotal + ". Names: " + itemNames);
    }

    private static boolean isSystemDocumentPickerPackage(String packageName) {
        // Android 7 emulator images can report the platform package instead of DocumentsUI.
        return packageName != null && (
            packageName.toLowerCase().contains("documentsui") || "android".equals(packageName)
        );
    }

    private static void verifySystemFilePicker(ActivityScenario<MainActivity> scenario) throws Exception {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        UiDevice device = UiDevice.getInstance(instrumentation);
        String openScanner = evaluate(scenario,
            "(() => { const button = document.querySelector('button[aria-label=\"اسکن فاکتور\"]'); " +
            "if (!button) return 'scanner-button-not-found'; button.click(); return 'scanner-opened'; })()"
        );
        assertEquals("The scanner could not be opened for file-picker testing.", "scanner-opened", openScanner);

        long pickerButtonDeadline = SystemClock.elapsedRealtime() + 10_000;
        String pickerClick = "picker-button-not-found";
        while (SystemClock.elapsedRealtime() < pickerButtonDeadline && !"picker-started".equals(pickerClick)) {
            pickerClick = evaluate(scenario,
                "(() => { const button = Array.from(document.querySelectorAll('button')) " +
                ".find(element => (element.innerText || '').includes('انتخاب فایل یا عکس')); " +
                "if (!button) return 'picker-button-not-found'; button.click(); return 'picker-started'; })()"
            );
            if (!"picker-started".equals(pickerClick)) SystemClock.sleep(250);
        }
        assertEquals("The file picker button was not available.", "picker-started", pickerClick);

        long pickerDeadline = SystemClock.elapsedRealtime() + 10_000;
        String pickerPackage = "";
        while (SystemClock.elapsedRealtime() < pickerDeadline) {
            pickerPackage = device.getCurrentPackageName();
            if (isSystemDocumentPickerPackage(pickerPackage)) break;
            SystemClock.sleep(250);
        }
        if (pickerPackage == null) pickerPackage = "<unknown>";
        if (!isSystemDocumentPickerPackage(pickerPackage)) {
            String appState = "<WebView unavailable>";
            try {
                appState = evaluate(scenario, "document.body ? document.body.innerText : ''") +
                    " Errors: " + getPageErrors(scenario);
            } catch (Exception ignored) {
                // The diagnostic is optional if the external picker interrupted the WebView.
            }
            assertTrue("ACTION_OPEN_DOCUMENT did not open Android DocumentsUI. Current package: " +
                pickerPackage + ". App state: " + appState, pickerPackage.toLowerCase().contains("documentsui"));
        }
        System.out.println("OFFLINE_OCR_FILE_PICKER_PASS: ACTION_OPEN_DOCUMENT opened " + pickerPackage + ".");
        device.pressBack();

        long appReturnDeadline = SystemClock.elapsedRealtime() + 10_000;
        String body = "";
        while (SystemClock.elapsedRealtime() < appReturnDeadline) {
            body = evaluate(scenario, "document.body ? document.body.innerText : ''");
            if (body.contains("اسکنر هوشمند فاکتور")) break;
            SystemClock.sleep(250);
        }
        assertTrue("The app did not return to its scanner after dismissing the file picker.",
            body.contains("اسکنر هوشمند فاکتور"));
        String closeScanner = evaluate(scenario,
            "(() => { const button = document.querySelector('button[aria-label=\"بستن اسکنر\"]'); " +
            "if (!button) return 'close-button-not-found'; button.click(); return 'scanner-closed'; })()"
        );
        assertEquals("The scanner could not be closed after the picker test.", "scanner-closed", closeScanner);
    }

    private static String getNativeUrl(ActivityScenario<MainActivity> scenario) {
        AtomicReference<String> url = new AtomicReference<>("<unavailable>");
        scenario.onActivity(activity -> {
            WebView webView = activity.getBridge().getWebView();
            if (webView != null) url.set(String.valueOf(webView.getUrl()));
        });
        return url.get();
    }

    private static String getPageErrors(ActivityScenario<MainActivity> scenario) throws Exception {
        return evaluate(scenario,
            "JSON.stringify(window.__emulatorOcrErrors || [])"
        );
    }

    private static String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> encodedResult = new AtomicReference<>();
        AtomicReference<String> evaluationError = new AtomicReference<>();
        scenario.onActivity(activity -> {
            try {
                WebView webView = activity.getBridge().getWebView();
                if (webView == null) {
                    evaluationError.set("Capacitor WebView is not available");
                    latch.countDown();
                    return;
                }
                webView.evaluateJavascript(script, value -> {
                    encodedResult.set(value);
                    latch.countDown();
                });
            } catch (Exception error) {
                evaluationError.set(error.toString());
                latch.countDown();
            }
        });
        assertTrue("Timed out while reading the WebView state", latch.await(20, TimeUnit.SECONDS));
        if (evaluationError.get() != null) throw new AssertionError(evaluationError.get());
        String encoded = encodedResult.get();
        if (encoded == null || "null".equals(encoded)) return "";
        Object decoded = new JSONTokener(encoded).nextValue();
        return decoded == null ? "" : decoded.toString();
    }
}
