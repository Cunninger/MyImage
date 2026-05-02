package com.cunninger.gptimage;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String CHANNEL_ID = "gen_task_channel";
    private static final int NOTIFICATION_ID = 1001;
    private boolean keepAlive = false;

    @Override
    protected void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(BackgroundTaskPlugin.class);
        super.onCreate(savedInstanceState);
        clearWebViewCache();
    }

    private void clearWebViewCache() {
        try {
            android.webkit.CookieManager.getInstance().removeAllCookies(null);
            android.webkit.WebStorage.getInstance().deleteAllData();
            getCacheDir().deleteOnExit();
        } catch (Exception ignored) {}
    }

    @Override
    public void onPause() {
        super.onPause();
        // 前台服务保活时，不暂停 WebView JS 执行
        if (keepAlive && getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().onResume();
        }
    }

    @SuppressLint("NewApi")
    public void showGeneratingNotification() {
        keepAlive = true;
        createChannel();
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("易何画境")
                .setContentText("正在生成图片...")
                .setSmallIcon(android.R.drawable.ic_menu_gallery)
                .setOngoing(true)
                .setContentIntent(pi)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(NOTIFICATION_ID, notification);
        }
    }

    public void cancelNotification() {
        keepAlive = false;
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(NOTIFICATION_ID);
        } catch (Exception ignored) {}
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "生成任务", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("图片生成进度通知");
            channel.setShowBadge(false);
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }
}
