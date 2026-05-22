package com.rkotv

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.NotificationCompat

class WebFloatingService : Service() {

    companion object {
        private const val TAG = "RKO_WebFloat"
        private const val NOTIFICATION_ID = 1004
        private const val CHANNEL_ID = "rko_web_floating_channel"
    }

    private lateinit var windowManager: WindowManager
    private lateinit var winParams: WindowManager.LayoutParams

    private var rootView: FrameLayout? = null
    private var webView: WebView? = null

    private var isMuted = false

    private var initialX = 0
    private var initialY = 0
    private var initialTouchX = 0f
    private var initialTouchY = 0f

    private var isResizing = false
    private var initialWidth = 0
    private var initialHeight = 0

    private var fullscreenBtn: TextView? = null
    private var resizeHandle: TextView? = null
    private var isFullscreen = false
    private var savedX = 0
    private var savedY = 0
    private var savedWidth = 0
    private var savedHeight = 0
    private var savedFlags = 0

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        createNotificationChannel()
        Log.d(TAG, "Service created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            "STOP" -> { stopSelf(); return START_NOT_STICKY }
            "TOGGLE_MUTE" -> { toggleMute(); return START_STICKY }
            else -> {
                val url = intent?.getStringExtra("url") ?: ""
                val title = intent?.getStringExtra("title") ?: "Web"
                Log.d(TAG, "Received URL: $url")
                if (url.isNotEmpty()) {
                    if (rootView == null) createOverlay(url, title)
                    else switchPage(url, title)
                }
                return START_STICKY
            }
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (isFullscreen) {
            val metrics = android.util.DisplayMetrics()
            windowManager.defaultDisplay.getRealMetrics(metrics)
            winParams.x = 0
            winParams.y = 0
            winParams.width = metrics.widthPixels
            winParams.height = metrics.heightPixels
            updateLayout()
        }
    }

    private fun toggleMute() {
        isMuted = !isMuted
        webView?.evaluateJavascript("(function(){var v=document.querySelector('video');if(v)v.muted=$isMuted})()", null)
        Toast.makeText(this, if (isMuted) "Muted" else "Unmuted", Toast.LENGTH_SHORT).show()
    }

    private fun createOverlay(url: String, title: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "Overlay permission needed", Toast.LENGTH_LONG).show()
            stopSelf()
            return
        }

        val defaultWidth = dpToPx(380)
        val defaultHeight = dpToPx(280)

        winParams = WindowManager.LayoutParams(
            defaultWidth, defaultHeight,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else
                WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = dpToPx(20)
            y = dpToPx(80)
        }

        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
        }
        rootView = root

        // WebView — bottom layer
        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            ).apply {
                setMargins(0, dpToPx(36), 0, dpToPx(36))
            }
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            webViewClient = WebViewClient()
            webChromeClient = WebChromeClient()
        }
        root.addView(webView)

        // Mute button — top-left (always visible)
        val muteBtn = TextView(this).apply {
            text = "\uD83D\uDD0A"
            textSize = 18f
            gravity = Gravity.CENTER
            setBackgroundColor(Color.argb(180, 0, 0, 0))
            setTextColor(Color.WHITE)
            layoutParams = FrameLayout.LayoutParams(dpToPx(40), dpToPx(40)).apply {
                gravity = Gravity.TOP or Gravity.START
                setMargins(dpToPx(4), dpToPx(4), 0, 0)
            }
            setOnClickListener {
                isMuted = !isMuted
                text = if (isMuted) "\uD83D\uDD07" else "\uD83D\uDD0A"
                webView?.evaluateJavascript("(function(){var v=document.querySelector('video');if(v)v.muted=$isMuted})()", null)
                Toast.makeText(this@WebFloatingService, if (isMuted) "Muted" else "Unmuted", Toast.LENGTH_SHORT).show()
            }
        }
        root.addView(muteBtn)

        // Fullscreen button — top-center (always visible)
        fullscreenBtn = TextView(this).apply {
            text = "\u26F6"
            textSize = 18f
            gravity = Gravity.CENTER
            setBackgroundColor(Color.argb(180, 0, 0, 0))
            setTextColor(Color.WHITE)
            layoutParams = FrameLayout.LayoutParams(dpToPx(40), dpToPx(40)).apply {
                gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
                setMargins(0, dpToPx(4), 0, 0)
            }
            setOnClickListener { toggleFullscreen() }
        }
        root.addView(fullscreenBtn)

        // Close button — top-right (always visible)
        val closeBtn = TextView(this).apply {
            text = "\u2715"
            textSize = 22f
            gravity = Gravity.CENTER
            setBackgroundColor(Color.argb(180, 0, 0, 0))
            setTextColor(Color.WHITE)
            setTypeface(null, Typeface.BOLD)
            layoutParams = FrameLayout.LayoutParams(dpToPx(40), dpToPx(40)).apply {
                gravity = Gravity.TOP or Gravity.END
                setMargins(0, dpToPx(4), dpToPx(4), 0)
            }
            setOnClickListener { stopSelf() }
        }
        root.addView(closeBtn)

        // Drag handle — bottom center (always visible)
        val dragHandle = TextView(this).apply {
            text = "\u2261"
            textSize = 24f
            gravity = Gravity.CENTER
            setBackgroundColor(Color.argb(200, 0, 0, 0))
            setTextColor(Color.WHITE)
            setTypeface(null, Typeface.BOLD)
            layoutParams = FrameLayout.LayoutParams(dpToPx(48), dpToPx(36)).apply {
                gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            }
        }
        dragHandle.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = winParams.x
                    initialY = winParams.y
                    initialTouchX = event.rawX
                    initialTouchY = event.rawY
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - initialTouchX).toInt()
                    val dy = (event.rawY - initialTouchY).toInt()
                    winParams.x = initialX + dx
                    winParams.y = initialY + dy
                    updateLayout()
                    true
                }
                else -> false
            }
        }
        root.addView(dragHandle)

        // Resize handle — bottom-right (always visible)
        resizeHandle = TextView(this).apply {
            text = "\u25A2"
            textSize = 22f
            gravity = Gravity.CENTER
            setBackgroundColor(Color.argb(200, 0, 0, 0))
            setTextColor(Color.WHITE)
            setTypeface(null, Typeface.BOLD)
            layoutParams = FrameLayout.LayoutParams(dpToPx(40), dpToPx(36)).apply {
                gravity = Gravity.BOTTOM or Gravity.END
            }
        }
        resizeHandle?.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    isResizing = true
                    initialWidth = winParams.width
                    initialHeight = winParams.height
                    initialTouchX = event.rawX
                    initialTouchY = event.rawY
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    if (isResizing) {
                        val deltaX = (event.rawX - initialTouchX).toInt()
                        val deltaY = (event.rawY - initialTouchY).toInt()
                        winParams.width = (initialWidth + deltaX).coerceAtLeast(dpToPx(200))
                        winParams.height = (initialHeight + deltaY).coerceAtLeast(dpToPx(150))
                        updateLayout()
                    }
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    isResizing = false
                    true
                }
                else -> false
            }
        }
        resizeHandle?.let { root.addView(it) }

        try {
            windowManager.addView(root, winParams)
            webView?.loadUrl(url)
            setupNotification(title)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to add overlay", e)
            stopSelf()
        }
    }

    private fun toggleFullscreen() {
        if (isFullscreen) {
            winParams.width = savedWidth
            winParams.height = savedHeight
            winParams.x = savedX
            winParams.y = savedY
            winParams.flags = savedFlags
            isFullscreen = false
            resizeHandle?.visibility = View.VISIBLE
            fullscreenBtn?.text = "\u26F6"
            sendBroadcast(Intent(MainActivity.ACTION_SET_ORIENTATION).apply {
                putExtra(MainActivity.EXTRA_ORIENTATION, android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED)
            })
            getSharedPreferences("rko_orient", Context.MODE_PRIVATE).edit().putInt("orientation", android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED).apply()
        } else {
            savedWidth = winParams.width
            savedHeight = winParams.height
            savedX = winParams.x
            savedY = winParams.y
            savedFlags = winParams.flags
            val metrics = android.util.DisplayMetrics()
            windowManager.defaultDisplay.getRealMetrics(metrics)
            winParams.x = 0
            winParams.y = 0
            winParams.width = metrics.widthPixels
            winParams.height = metrics.heightPixels
            isFullscreen = true
            resizeHandle?.visibility = View.GONE
            fullscreenBtn?.text = "\u2715"
            sendBroadcast(Intent(MainActivity.ACTION_SET_ORIENTATION).apply {
                putExtra(MainActivity.EXTRA_ORIENTATION, android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE)
            })
            getSharedPreferences("rko_orient", Context.MODE_PRIVATE).edit().putInt("orientation", android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE).apply()
            Intent(this@WebFloatingService, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_NEW_TASK
                startActivity(this)
            }
        }
        updateLayout()
    }

    private fun switchPage(url: String, title: String) {
        Log.d(TAG, "Switching page: $url")
        webView?.loadUrl(url)
        setupNotification(title)
    }

    private fun updateLayout() {
        try {
            rootView?.let { windowManager.updateViewLayout(it, winParams) }
        } catch (e: Exception) {
            Log.e(TAG, "updateLayout failed", e)
        }
    }

    private fun dpToPx(dp: Int): Int = (dp * resources.displayMetrics.density).toInt()

    private fun setupNotification(title: String) {
        val stopPi = PendingIntent.getService(this, 0,
            Intent(this, WebFloatingService::class.java).apply { action = "STOP" },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        val mutePi = PendingIntent.getService(this, 1,
            Intent(this, WebFloatingService::class.java).apply { action = "TOGGLE_MUTE" },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Web Player")
            .setContentText(title)
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .addAction(android.R.drawable.ic_lock_silent_mode_off, "Mute", mutePi)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stopPi)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            Log.e(TAG, "startForeground failed", e)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "Web Floating Player", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        try { rootView?.let { windowManager.removeView(it) } } catch (_: Exception) {}
        webView?.destroy()
        webView = null
        rootView = null
        try { sendBroadcast(Intent("com.rkotv.FLOAT_CLOSED")) } catch (_: Exception) {}
    }
}
