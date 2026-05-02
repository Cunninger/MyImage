package com.cunninger.gptimage;

import android.Manifest;
import android.content.pm.PackageManager;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

@CapacitorPlugin(
    name = "BackgroundGen",
    permissions = {
        @Permission(
            strings = { Manifest.permission.POST_NOTIFICATIONS },
            alias = "notifications"
        )
    }
)
public class BackgroundTaskPlugin extends Plugin {

    @PluginMethod
    public void startForeground(PluginCall call) {
        if (getActivity() instanceof MainActivity) {
            ((MainActivity) getActivity()).showGeneratingNotification();
        }
        call.resolve();
    }

    @PluginMethod
    public void stopForeground(PluginCall call) {
        if (getActivity() instanceof MainActivity) {
            ((MainActivity) getActivity()).cancelNotification();
        }
        call.resolve();
    }
}
