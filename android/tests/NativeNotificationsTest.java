package net.dudiebug.chores;

import android.app.NotificationManager;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class NativeNotificationsTest {
    private String eval(ActivityScenario<MainActivity> scene, String expression) throws Exception {
        CountDownLatch latch = new CountDownLatch(1); AtomicReference<String> value = new AtomicReference<>();
        scene.onActivity(a -> a.getBridge().getWebView().evaluateJavascript(expression, r -> { value.set(r); latch.countDown(); }));
        assertTrue("WebView did not respond", latch.await(10, TimeUnit.SECONDS)); return value.get();
    }
    private void until(ActivityScenario<MainActivity> scene, String expression) throws Exception {
        for(int n=0;n<60;n++) { if ("true".equals(eval(scene, expression))) return; Thread.sleep(200); }
        fail("WebView condition failed: " + expression);
    }
    @Test public void strictCspBridgePromptsAndPostsAsChores() throws Exception {
        try (ActivityScenario<MainActivity> scene = ActivityScenario.launch(MainActivity.class)) {
            scene.onActivity(a -> a.getBridge().getWebView().loadDataWithBaseURL("https://chores.dudiebug.net/",
                "<!doctype html><html><head><meta http-equiv='Content-Security-Policy' content=\"default-src 'self'; script-src 'self'\"><script src='/native-bridge.js'></script></head><body>Native bridge test</body></html>", "text/html", "UTF-8", null));
            until(scene, "typeof window.Capacitor?.Plugins?.ChoresNotifications?.getStatus === 'function'");
            // Prove the explicit external-script repair works even when the initial bridge is absent.
            eval(scene, "window.Capacitor={};var script=document.createElement('script');script.src='/native-bridge.js?test=external';document.head.append(script);");
            until(scene, "typeof window.Capacitor?.Plugins?.ChoresNotifications?.getStatus === 'function'");
            eval(scene, "Capacitor.Plugins.ChoresNotifications.getStatus().then(s=>window.nativeState=s.notifications)");
            until(scene, "window.nativeState === 'prompt'");
            eval(scene, "Capacitor.Plugins.ChoresNotifications.requestPermissions().then(s=>window.nativeState=s.notifications)");
            UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
            UiObject allow = device.findObject(new UiSelector().resourceIdMatches(".*:id/permission_allow_button"));
            assertTrue("Android notification permission prompt missing", allow.waitForExists(10000)); allow.click();
            until(scene, "window.nativeState === 'granted'");
            eval(scene, "Capacitor.Plugins.ChoresNotifications.testLocal().then(()=>window.posted=true)");
            until(scene, "window.posted === true");
            scene.onActivity(a -> {
                assertEquals("Chores", a.getApplicationInfo().loadLabel(a.getPackageManager()).toString());
                assertEquals("net.dudiebug.chores", a.getPackageName());
                assertTrue("Native notification not posted", a.getSystemService(NotificationManager.class).getActiveNotifications().length > 0);
            });
        }
    }
}
