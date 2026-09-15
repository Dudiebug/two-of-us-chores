package net.dudiebug.chores;

import static org.junit.Assert.assertEquals;

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
    @Test
    public void packageAndLauncherActivityUseDedicatedChoresIconResources() throws Exception {
        Context context = ApplicationProvider.getApplicationContext();
        PackageManager pm = context.getPackageManager();
        ApplicationInfo app = pm.getApplicationInfo(context.getPackageName(), 0);
        assertEquals("chores_launcher", context.getResources().getResourceEntryName(app.icon));

        ActivityInfo activity = pm.getActivityInfo(
            new ComponentName(context, MainActivity.class), 0
        );
        assertEquals("chores_launcher", context.getResources().getResourceEntryName(activity.icon));
    }
}
