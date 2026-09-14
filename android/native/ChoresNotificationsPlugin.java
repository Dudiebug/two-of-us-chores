package net.dudiebug.chores;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.ContextCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.concurrent.TimeUnit;

@CapacitorPlugin(
    name = "ChoresNotifications",
    permissions = {
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class ChoresNotificationsPlugin extends Plugin {
    static final String UNIQUE_WORK = "chores-native-notifications";

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        JSObject result = new JSObject();
        result.put("notifications", notificationState());
        call.resolve(result);
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            checkPermissions(call);
            return;
        }
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            checkPermissions(call);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationPermissionCallback");
    }

    @PermissionCallback
    private void notificationPermissionCallback(PluginCall call) {
        checkPermissions(call);
    }

    @PluginMethod
    public void configure(PluginCall call) {
        String token = call.getString("token");
        if (token == null || token.isBlank()) {
            call.reject("Missing native notification token");
            return;
        }
        long cursor = call.getData().optLong("cursor", 0L);
        ChoresNotificationWorker.saveConfiguration(getContext(), token, cursor);
        schedulePeriodicWork();
        JSObject result = new JSObject();
        result.put("enabled", true);
        call.resolve(result);
    }

    @PluginMethod
    public void disable(PluginCall call) {
        ChoresNotificationWorker.clearConfiguration(getContext());
        WorkManager.getInstance(getContext()).cancelUniqueWork(UNIQUE_WORK);
        JSObject result = new JSObject();
        result.put("enabled", false);
        call.resolve(result);
    }

    @PluginMethod
    public void pollNow(PluginCall call) {
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(ChoresNotificationWorker.class)
            .setConstraints(networkConstraint())
            .build();
        WorkManager.getInstance(getContext()).enqueue(request);
        JSObject result = new JSObject();
        result.put("queued", true);
        call.resolve(result);
    }

    private void schedulePeriodicWork() {
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
            ChoresNotificationWorker.class,
            15,
            TimeUnit.MINUTES
        )
            .setConstraints(networkConstraint())
            .build();
        WorkManager.getInstance(getContext()).enqueueUniquePeriodicWork(
            UNIQUE_WORK,
            ExistingPeriodicWorkPolicy.UPDATE,
            request
        );
    }

    private Constraints networkConstraint() {
        return new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();
    }

    private String notificationState() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return "granted";
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            return "granted";
        }
        if (getActivity() != null && getActivity().shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)) {
            return "prompt-with-rationale";
        }
        return "prompt";
    }
}
