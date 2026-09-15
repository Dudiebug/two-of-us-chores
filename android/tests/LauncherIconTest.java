package net.dudiebug.chores;

import static org.junit.Assert.assertTrue;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;

import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;

import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class LauncherIconTest {
    private static void assertDedicatedChoresIcon(Context context, int resourceId) {
        String name = context.getResources().getResourceEntryName(resourceId);
        assertTrue(
            "expected dedicated Chores launcher resource, got " + name,
            name.equals("chores_launcher") || name.equals("chores_launcher_round")
        );
    }

    @Test
    public void packageAndLauncherActivityUseDedicatedChoresIconResources() throws Exception {
        Context context = ApplicationProvider.getApplicationContext();
        PackageManager pm = context.getPackageManager();
        ApplicationInfo app = pm.getApplicationInfo(context.getPackageName(), 0);
        assertDedicatedChoresIcon(context, app.icon);

        ActivityInfo activity = pm.getActivityInfo(
            new ComponentName(context, MainActivity.class), 0
        );
        assertDedicatedChoresIcon(context, activity.icon);
    }
}
