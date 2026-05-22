package com.rkotv

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
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
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.Toast
import androidx.core.app.NotificationCompat
import com.google.android.exoplayer2.ExoPlayer
import com.google.android.exoplayer2.MediaItem
import com.google.android.exoplayer2.source.hls.HlsMediaSource
import com.google.android.exoplayer2.ui.StyledPlayerView
import com.google.android.exoplayer2.upstream.DefaultDataSource
import com.google.android.exoplayer2.upstream.DefaultHttpDataSource

class FloatingService : Service() {

    companion object {
        private const val TAG = "RKO_Float"
        private const val NOTIFICATION_ID = 1001
        private const val CHANNEL_ID = "rko_floating_channel"
        private const val AUTO_HIDE_DELAY = 3000L
    }

    private lateinit var windowManager: WindowManager
    private lateinit var winParams: WindowManager.LayoutParams

    private var rootView: FrameLayout? = null
    private var videoContainer: FrameLayout? = null
    private var controlsLayout: LinearLayout? = null

    private var exoPlayer: ExoPlayer? = null
    private var playerView: StyledPlayerView? = null
    private var webView: WebView? = null

    private var isPlaying = true
    private var isMuted = false

    private var initialX = 0
    private var initialY = 0
    private var initialTouchX = 0f
    private var initialTouchY = 0f

    private var isResizing = false
    private var initialWidth = 0
    private var initialHeight = 0

    private val handler = Handler(Looper.getMainLooper())
    private val hideControlsRunnable = Runnable { hideControls() }

    private var playPauseBtn: ImageButton? = null
    private var liveBtn: android.widget.TextView? = null
    private var muteBtn: ImageButton? = null
    private var fullscreenBtn: ImageButton? = null
    private var closeBtn: ImageButton? = null
    private var screenModeBtn: android.widget.TextView? = null
    private var resizeHandle: ImageButton? = null
    private var screenMode = 0
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
            "TOGGLE_PLAY" -> { togglePlayback(); return START_STICKY }
            "TOGGLE_MUTE" -> { toggleMute(); return START_STICKY }
            "SEEK_LIVE" -> { seekToLive(); return START_STICKY }
            else -> {
                val url = intent?.getStringExtra("url") ?: ""
                val title = intent?.getStringExtra("title") ?: "RKO TV"
                if (rootView == null && url.isNotEmpty()) createOverlay(url, title)
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

    private fun createOverlay(url: String, title: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "Please grant 'Display over other apps' permission", Toast.LENGTH_LONG).show()
            stopSelf()
            return
        }

        val root = FrameLayout(this)
        rootView = root

        val defaultWidth = dpToPx(340)
        val defaultHeight = dpToPx(220)

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
            y = dpToPx(150)
        }

        videoContainer = FrameLayout(this).apply {
            setBackgroundColor(0x00000000)
        }

        // Smaller Controls
        controlsLayout = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setBackgroundColor(0xCC000000.toInt())
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dpToPx(42)).apply {
                gravity = Gravity.TOP
            }
            visibility = View.GONE
        }

        fun createBtn(icon: Int, onClick: () -> Unit): ImageButton {
            return ImageButton(this).apply {
                setImageResource(icon)
                setBackgroundColor(0)
                layoutParams = LinearLayout.LayoutParams(dpToPx(38), dpToPx(38)).apply {
                    setMargins(6, 2, 6, 2)
                }
                setOnClickListener {
                    onClick()
                    resetAutoHide()
                }
            }
        }

        playPauseBtn = createBtn(android.R.drawable.ic_media_pause) {
            togglePlayback()
            updatePlayPauseIcon()
        }

        liveBtn = android.widget.TextView(this).apply {
            text = "LIVE"
            setTextColor(0xFFFF0000.toInt())
            gravity = Gravity.CENTER
            textSize = 11f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setBackgroundColor(0x33000000)
            layoutParams = LinearLayout.LayoutParams(dpToPx(50), dpToPx(30)).apply {
                setMargins(6, 2, 6, 2)
            }
            setOnClickListener {
                seekToLive()
                resetAutoHide()
            }
        }

        muteBtn = createBtn(android.R.drawable.ic_lock_silent_mode_off) { toggleMute() }
        fullscreenBtn = createBtn(android.R.drawable.ic_menu_myplaces) { toggleFullscreen() }
        closeBtn = createBtn(android.R.drawable.ic_menu_close_clear_cancel) { stopSelf() }
        screenModeBtn = android.widget.TextView(this).apply {
            text = "FIT"
            setTextColor(0xFF4a9eff.toInt())
            gravity = Gravity.CENTER
            textSize = 9f
            setTypeface(null, android.graphics.Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(dpToPx(38), dpToPx(38)).apply {
                setMargins(6, 2, 6, 2)
            }
            setOnClickListener {
                cycleScreenMode()
                resetAutoHide()
            }
        }

        controlsLayout?.addView(playPauseBtn)
        controlsLayout?.addView(liveBtn)
        controlsLayout?.addView(muteBtn)
        controlsLayout?.addView(fullscreenBtn)
        controlsLayout?.addView(screenModeBtn)
        controlsLayout?.addView(closeBtn)

        videoContainer?.addView(controlsLayout)

        // Resize Handle
        resizeHandle = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_menu_more)
            setBackgroundColor(0)
            alpha = 0.85f
            layoutParams = FrameLayout.LayoutParams(dpToPx(30), dpToPx(30)).apply {
                gravity = Gravity.BOTTOM or Gravity.END
                setMargins(0, 0, 4, 4)
            }
        }
        videoContainer?.addView(resizeHandle)

        root.addView(videoContainer)

        // Load Video
        val isM3U8 = url.contains(".m3u8", true) || url.contains(".m3u", true)
        val useWebView = !isM3U8 || url.contains("frame", true) || url.contains("embed", true) || url.contains(".html", true)

        if (useWebView) {
            webView = WebView(this).apply {
                layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.mediaPlaybackRequiresUserGesture = false
                webViewClient = WebViewClient()
                webChromeClient = WebChromeClient()
            }
            videoContainer?.addView(webView, 0)
            webView?.loadUrl(url)
        } else {
            exoPlayer = ExoPlayer.Builder(this).build().apply {
                val hf = DefaultHttpDataSource.Factory().setUserAgent("Mozilla/5.0").setAllowCrossProtocolRedirects(true)
                val ds = DefaultDataSource.Factory(this@FloatingService, hf)
                setMediaSource(HlsMediaSource.Factory(ds).createMediaSource(MediaItem.fromUri(url)))
                prepare()
                playWhenReady = true
            }
            StyledPlayerView(this).apply {
                player = exoPlayer
                useController = false
                layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                playerView = this
                videoContainer?.addView(this, 0)
            }
        }

        // Drag to Move + Tap
        videoContainer?.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = winParams.x
                    initialY = winParams.y
                    initialTouchX = event.rawX
                    initialTouchY = event.rawY
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    if (!isResizing) {
                        winParams.x = initialX + (event.rawX - initialTouchX).toInt()
                        winParams.y = initialY + (event.rawY - initialTouchY).toInt()
                        updateLayout()
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (!isResizing && kotlin.math.abs(event.rawX - initialTouchX) < 15 && 
                        kotlin.math.abs(event.rawY - initialTouchY) < 15) {
                        if (controlsLayout?.visibility == View.VISIBLE) hideControls() 
                        else showControls()
                    }
                    true
                }
                else -> false
            }
        }

        // Resize
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
                        winParams.width = (initialWidth + deltaX).coerceAtLeast(dpToPx(180))
                        winParams.height = (initialHeight + deltaY).coerceAtLeast(dpToPx(120))
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

        try {
            windowManager.addView(root, winParams)
            showControls()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to add overlay", e)
            stopSelf()
        }

        setupNotification(title)
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
            fullscreenBtn?.setImageResource(android.R.drawable.ic_menu_myplaces)
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
            fullscreenBtn?.setImageResource(android.R.drawable.ic_menu_close_clear_cancel)
            sendBroadcast(Intent(MainActivity.ACTION_SET_ORIENTATION).apply {
                putExtra(MainActivity.EXTRA_ORIENTATION, android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE)
            })
            getSharedPreferences("rko_orient", Context.MODE_PRIVATE).edit().putInt("orientation", android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE).apply()
            Intent(this@FloatingService, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_NEW_TASK
                startActivity(this)
            }
        }
        updateLayout()
    }

    private fun cycleScreenMode() {
        screenMode = (screenMode + 1) % 3
        val mode = when (screenMode) {
            0 -> { playerView?.resizeMode = com.google.android.exoplayer2.ui.AspectRatioFrameLayout.RESIZE_MODE_FIT; "FIT" }
            1 -> { playerView?.resizeMode = com.google.android.exoplayer2.ui.AspectRatioFrameLayout.RESIZE_MODE_ZOOM; "ZOOM" }
            else -> { playerView?.resizeMode = com.google.android.exoplayer2.ui.AspectRatioFrameLayout.RESIZE_MODE_FILL; "FILL" }
        }
        screenModeBtn?.text = mode
    }

    private fun showControls() {
        controlsLayout?.visibility = View.VISIBLE
        handler.removeCallbacks(hideControlsRunnable)
        handler.postDelayed(hideControlsRunnable, AUTO_HIDE_DELAY)
    }

    private fun hideControls() {
        controlsLayout?.visibility = View.GONE
    }

    private fun resetAutoHide() {
        handler.removeCallbacks(hideControlsRunnable)
        handler.postDelayed(hideControlsRunnable, AUTO_HIDE_DELAY)
    }

    private fun updatePlayPauseIcon() {
        playPauseBtn?.setImageResource(if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play)
    }

    private fun togglePlayback() {
        if (isPlaying) pausePlayer() else resumePlayer()
        updatePlayPauseIcon()
    }

    private fun pausePlayer() {
        exoPlayer?.pause()
        webView?.evaluateJavascript("(function(){var v=document.querySelector('video');if(v)v.pause()})()", null)
        isPlaying = false
    }

    private fun resumePlayer() {
        exoPlayer?.play()
        webView?.evaluateJavascript("(function(){var v=document.querySelector('video');if(v)v.play()})()", null)
        isPlaying = true
    }

    private fun toggleMute() {
        isMuted = !isMuted
        exoPlayer?.volume = if (isMuted) 0f else 1f
        webView?.evaluateJavascript("(function(){var v=document.querySelector('video');if(v)v.muted=$isMuted})()", null)
        muteBtn?.setImageResource(if (isMuted) android.R.drawable.ic_lock_silent_mode else android.R.drawable.ic_lock_silent_mode_off)
    }

    private fun seekToLive() {
        exoPlayer?.let { player ->
            player.seekToDefaultPosition()
            if (!player.isPlaying) {
                player.playWhenReady = true
                isPlaying = true
                updatePlayPauseIcon()
            }
            Toast.makeText(this, "Seeking to LIVE", Toast.LENGTH_SHORT).show()
            liveBtn?.setTextColor(0xFF00FF00.toInt())
            Handler(Looper.getMainLooper()).postDelayed({ liveBtn?.setTextColor(0xFFFF0000.toInt()) }, 2000)
        }
        webView?.evaluateJavascript("(function(){var v=document.querySelector('video');if(v){v.currentTime=v.duration-1;v.play()}})()", null)
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
            Intent(this, FloatingService::class.java).apply { action = "STOP" },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        val togglePi = PendingIntent.getService(this, 1,
            Intent(this, FloatingService::class.java).apply { action = "TOGGLE_PLAY" },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        val seekPi = PendingIntent.getService(this, 2,
            Intent(this, FloatingService::class.java).apply { action = "SEEK_LIVE" },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("RKO TV")
            .setContentText(title)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .addAction(android.R.drawable.ic_media_pause, "Toggle", togglePi)
            .addAction(android.R.drawable.ic_media_next, "LIVE", seekPi)
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
            val channel = NotificationChannel(CHANNEL_ID, "RKO Floating Player", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        handler.removeCallbacks(hideControlsRunnable)
        super.onDestroy()
        try { rootView?.let { windowManager.removeView(it) } } catch (_: Exception) {}
        exoPlayer?.release()
        webView?.destroy()
        rootView = null
        try { sendBroadcast(Intent("com.rkotv.FLOAT_CLOSED")) } catch (_: Exception) {}
    }
}
