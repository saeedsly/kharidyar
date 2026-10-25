package com.saeedsalari.kharidyar;

import android.os.SystemClock;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
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
    private static final long OCR_TIMEOUT_MS = 75_000;

    @Test
    public void bundledReceiptOcrCompletesOfflineOnAndroid7() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<String> browserConsole = new AtomicReference<>("");
            scenario.onActivity(activity -> {
                WebView webView = activity.getBridge().getWebView();
                webView.setWebChromeClient(new WebChromeClient() {
                    @Override
                    public boolean onConsoleMessage(ConsoleMessage message) {
                        browserConsole.accumulateAndGet(message.message() + "\n", (oldValue, nextValue) -> oldValue + nextValue);
                        return true;
                    }
                });
            });

            long readyDeadline = SystemClock.elapsedRealtime() + APP_READY_TIMEOUT_MS;
            String body = "";
            while (SystemClock.elapsedRealtime() < readyDeadline) {
                try {
                    body = evaluate(scenario, "document.getElementById('root') ? document.getElementById('root').textContent : ''");
                } catch (AssertionError error) {
                    throw new AssertionError("WebView startup evaluation failed. Console: " + browserConsole.get(), error);
                }
                if (body.contains("تست زنده اسکنر هوشمند")) break;
                SystemClock.sleep(500);
            }
            if (!body.contains("تست زنده اسکنر هوشمند")) {
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
                body.contains("تست زنده اسکنر هوشمند")
            );

            evaluate(scenario,
                "(() => { window.__emulatorOcrErrors = []; " +
                "window.addEventListener('error', e => window.__emulatorOcrErrors.push(String(e.message || e.error || 'window error'))); " +
                "window.addEventListener('unhandledrejection', e => window.__emulatorOcrErrors.push(String(e.reason || 'unhandled rejection'))); " +
                "return 'armed'; })()"
            );

            String clickResult = evaluate(scenario,
                "(() => { const button = Array.from(document.querySelectorAll('button')) " +
                ".find(element => (element.innerText || '').includes('تست زنده اسکنر هوشمند')); " +
                "if (!button) return 'button-not-found'; button.click(); return 'sample-scan-started'; })()"
            );
            assertEquals("The built-in receipt test button could not be activated.", "sample-scan-started", clickResult);

            long ocrDeadline = SystemClock.elapsedRealtime() + OCR_TIMEOUT_MS;
            String lastBody = "";
            String lastOcrProgress = "<no progress reported>";
            while (SystemClock.elapsedRealtime() < ocrDeadline) {
                lastBody = evaluate(scenario, "document.body ? document.body.innerText : ''");
                int percentIndex = lastBody.indexOf('٪');
                if (percentIndex >= 0) {
                    int contextStart = Math.max(0, percentIndex - 120);
                    int contextEnd = Math.min(lastBody.length(), percentIndex + 12);
                    lastOcrProgress = lastBody.substring(contextStart, contextEnd);
                }
                if (lastBody.contains("دقت خوانش:")) {
                    evaluate(scenario,
                        "(() => { const button = Array.from(document.querySelectorAll('button')) " +
                        ".find(element => (element.innerText || '').includes('متن خام OCR')); " +
                        "if (button) button.click(); return 'raw-text-opened'; })()"
                    );
                    String reviewedBody = evaluate(scenario, "document.body ? document.body.innerText : ''");
                    assertFalse("OCR completed but returned no recognized text.", reviewedBody.contains("متنی یافت نشد"));
                    System.out.println("OFFLINE_OCR_EMULATOR_PASS: built-in Ofogh receipt completed and produced OCR text.");
                    return;
                }
                if (lastBody.contains("پردازش این عکس در یک دقیقه تمام نشد")) {
                    fail("OFFLINE_OCR_EMULATOR_TIMEOUT: OCR reached the app's one-minute timeout. Last progress: " + lastOcrProgress + " UI: " + lastBody + " Errors: " + getPageErrors(scenario));
                }
                if (lastBody.contains("خواندن فاکتور ناموفق بود") || lastBody.contains("قابل خواندن نیست")) {
                    fail("OFFLINE_OCR_EMULATOR_ERROR: scan failed before review. Last progress: " + lastOcrProgress + " UI: " + lastBody + " Errors: " + getPageErrors(scenario));
                }
                SystemClock.sleep(750);
            }
            fail("OFFLINE_OCR_EMULATOR_TIMEOUT: OCR did not reach review within 75 seconds. Last UI: " + lastBody + " Errors: " + getPageErrors(scenario));
        }
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
