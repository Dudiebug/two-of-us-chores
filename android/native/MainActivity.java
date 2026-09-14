package net.dudiebug.chores;

import android.os.Bundle;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.JSExport;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(ChoresNotificationsPlugin.class);
        super.onCreate(state);
        // Explicit same-origin external bridge script also works when a remote
        // document's strict CSP rejects the older inline-injection fallback.
        // Keep CSP intact; never expose this bridge to another web origin.
        final Uri origin = Uri.parse(bridge.getConfig().getServerUrl());
        final String bootstrap;
        try {
            bootstrap = "if(!window.Capacitor?.Plugins?.ChoresNotifications){\n"
                + JSExport.getGlobalJS(this, false, false) + "\n"
                + JSExport.getBridgeJS(this) + "\n"
                + JSExport.getPluginJS(Collections.singletonList(bridge.getPlugin("ChoresNotifications")))
                + "\n}\nwindow.dispatchEvent(new Event('chores-native-ready'));";
        } catch (Exception error) { throw new IllegalStateException("Cannot initialize native Chores bridge", error); }
        bridge.getWebView().stopLoading();
        bridge.getWebView().setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (origin.getScheme().equals(uri.getScheme()) && origin.getHost().equals(uri.getHost())
                    && origin.getPort() == uri.getPort() && "/native-bridge.js".equals(uri.getPath())) {
                    return new WebResourceResponse("text/javascript", "UTF-8", new ByteArrayInputStream(bootstrap.getBytes(StandardCharsets.UTF_8)));
                }
                return super.shouldInterceptRequest(view, request);
            }
        });
        bridge.getWebView().loadUrl(origin.toString());
    }
}
