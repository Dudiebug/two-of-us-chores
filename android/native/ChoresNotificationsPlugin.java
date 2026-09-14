package net.dudiebug.chores;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.*;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "ChoresNotifications", permissions = {
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public class ChoresNotificationsPlugin extends Plugin {
    static final String UNIQUE_WORK = "chores-native-notifications";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("notifications", notificationState());
        result.put("configured", ChoresNotificationWorker.isConfigured(getContext()));
        result.put("lastCheck", ChoresNotificationWorker.prefs(getContext()).getString("lastCheck", ""));
        result.put("lastError", ChoresNotificationWorker.prefs(getContext()).getString("lastError", ""));
        result.put("version", "1.2.0"); call.resolve(result);
    }
    @PluginMethod public void checkPermissions(PluginCall call) { getStatus(call); }
    @PluginMethod public void requestPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) { getStatus(call); return; }
        requestPermissionForAlias("notifications", call, "permissionResult");
    }
    @PermissionCallback private void permissionResult(PluginCall call) {
        getContext().getSharedPreferences("chores_permission", 0).edit().putBoolean("requested", true).apply();
        getStatus(call);
    }
    @PluginMethod public void openSettings(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            getActivity().startActivity(intent); call.resolve();
        });
    }
    @PluginMethod public void configure(PluginCall call) {
        String token = call.getString("token"); long cursor = call.getData().optLong("cursor", -1L);
        if (token == null || !token.matches("[A-Za-z0-9_-]{20,256}") || cursor < 0) { call.reject("Invalid native device configuration"); return; }
        ChoresNotificationWorker.saveConfiguration(getContext(), token, cursor);
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(ChoresNotificationWorker.class, 15, TimeUnit.MINUTES)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build();
        WorkManager.getInstance(getContext()).enqueueUniquePeriodicWork(UNIQUE_WORK, ExistingPeriodicWorkPolicy.UPDATE, request);
        getStatus(call);
    }
    @PluginMethod public void disable(PluginCall call) {
        ChoresNotificationWorker.clearConfiguration(getContext());
        WorkManager.getInstance(getContext()).cancelUniqueWork(UNIQUE_WORK); getStatus(call);
    }
    @PluginMethod public void pollNow(PluginCall call) {
        // Return the actual native result, not merely "work queued".
        executor.execute(() -> {
            try { call.resolve(ChoresNotificationWorker.poll(getContext())); }
            catch (Exception error) { call.reject("Native notification check failed. Check your connection and try again."); }
        });
    }
    @PluginMethod public void testLocal(PluginCall call) {
        if (!"granted".equals(notificationState())) { call.reject("Allow notifications in Android settings first"); return; }
        try {
            org.json.JSONObject item = new org.json.JSONObject().put("id", 2147483000).put("title", "Chores").put("body", "Native notifications are working.");
            ChoresNotificationWorker.postNotification(getContext(), item); call.resolve();
        } catch (Exception error) { call.reject("Could not post native test notification"); }
    }
    private String notificationState() {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            if (getActivity().shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)) return "prompt-with-rationale";
            return getContext().getSharedPreferences("chores_permission", 0).getBoolean("requested", false) ? "denied" : "prompt";
        }
        return ChoresNotificationWorker.canNotify(getContext()) ? "granted" : "denied";
    }
    @Override protected void handleOnDestroy() { executor.shutdown(); }
}
