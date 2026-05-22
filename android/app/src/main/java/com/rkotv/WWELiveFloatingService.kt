package com.rkotv

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.NotificationCompat
import com.google.android.exoplayer2.ExoPlayer
import com.google.android.exoplayer2.MediaItem
import com.google.android.exoplayer2.source.hls.HlsMediaSource
import com.google.android.exoplayer2.ui.StyledPlayerView
import com.google.android.exoplayer2.upstream.DefaultDataSource
import com.google.android.exoplayer2.upstream.DefaultHttpDataSource

class WWELiveFloatingService : Service() {

    companion object {
        private const val TAG = "RKO_WWELiveFloat"
        private const val NOTIFICATION_ID = 1006
        private const val CHANNEL_ID = "rko_wwelive_floating_channel"
    }

    private lateinit var windowManager: WindowManager
    private lateinit var videoParams: WindowManager.LayoutParams
    private lateinit var ctrlParams: WindowManager.LayoutParams

    private var videoRoot: FrameLayout? = null
    private var ctrlRoot: FrameLayout? = null
    private var exoPlayer: ExoPlayer? = null
    private var playerView: StyledPlayerView? = null

    private var isPlaying = true
    private var isMuted = false
    private var isResizing = false

    private var initialX = 0
    private var initialY = 0
    private var initialW = 0
    private var initialH = 0
    private var initialTouchX = 0f
    private var initialTouchY = 0f

    private var playPauseBtn: TextView? = null

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
            "TOGGLE_PLAY" -> { togglePlayback(); return START_STICKY }
            "SEEK_LIVE" -> { seekToLive(); return START_STICKY }
            else -> {
                val url = intent?.getStringExtra("url") ?: ""
                val title = intent?.getStringExtra("title") ?: "WWE Live"
                Log.d(TAG, "Received URL: $url")
                if (url.isNotEmpty()) {
                    if (videoRoot == null) createOverlay(url, title)
                    else updateStream(url, title)
                }
                return START_STICKY
            }
        }
    }

    private fun toggleMute() {
        isMuted = !isMuted
        exoPlayer?.volume = if (isMuted) 0f else 1f
        Toast.makeText(this, if (isMuted) "Muted" else "Unmuted", Toast.LENGTH_SHORT).show()
    }

    private fun togglePlayback() {
        isPlaying = !isPlaying
        if (isPlaying) {
            exoPlayer?.play()
            playPauseBtn?.text = "\u23F8"
        } else {
            exoPlayer?.pause()
            playPauseBtn?.text = "\u25B6"
        }
    }

    private fun seekToLive() {
        exoPlayer?.let { player ->
            player.seekToDefaultPosition()
            if (!player.isPlaying) {
                player.playWhenReady = true
                isPlaying = true
            }
            Toast.makeText(this, "Seeking to LIVE", Toast.LENGTH_SHORT).show()
        }
    }

    private fun createOverlay(url: String, title: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "Overlay permission needed", Toast.LENGTH_LONG).show()
            stopSelf()
            return
        }

        val videoW = dpToPx(380)
        val videoH = dpToPx(280)
        val barH = dpToPx(38)
        val gap = dpToPx(4)

        val flags = WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS

        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            WindowManager.LayoutParams.TYPE_PHONE

        // -- Video window --
        videoParams = WindowManager.LayoutParams(videoW, videoH, type, flags, PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.TOP or Gravity.START
            x = dpToPx(20)
            y = dpToPx(80) + barH + gap
        }

        // -- Control bar window (above video) --
        ctrlParams = WindowManager.LayoutParams(videoW, barH, type, flags, PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.TOP or Gravity.START
            x = videoParams.x
            y = videoParams.y - barH - gap
        }

        // Build video window
        val videoFrame = FrameLayout(this)
        videoFrame.setBackgroundColor(Color.BLACK)
        videoRoot = videoFrame

        // Video content — ExoPlayer for m3u8 streams only
        exoPlayer = ExoPlayer.Builder(this).build().apply {
            val hf = DefaultHttpDataSource.Factory().setUserAgent("Mozilla/5.0").setAllowCrossProtocolRedirects(true)
            val ds = DefaultDataSource.Factory(this@WWELiveFloatingService, hf)
            setMediaSource(HlsMediaSource.Factory(ds).createMediaSource(MediaItem.fromUri(url)))
            prepare()
            playWhenReady = true
            this@WWELiveFloatingService.isPlaying = true
        }
        playerView = StyledPlayerView(this).apply {
            player = exoPlayer
            useController = false
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        videoFrame.addView(playerView)

        // Build control bar window
        val ctrlFrame = FrameLayout(this)
        ctrlFrame.setBackgroundColor(Color.argb(200, 0, 0, 0))
        ctrlRoot = ctrlFrame

        val btnH = dpToPx(32)
        val btnW = dpToPx(34)
        val small = dpToPx(2)

        // Drag handle — far left
        val dragBtn = TextView(this).apply {
            text = "\u2261"
            textSize = 20f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            setTypeface(null, Typeface.BOLD)
            layoutParams = FrameLayout.LayoutParams(btnW, btnH).apply {
                gravity = Gravity.START or Gravity.CENTER_VERTICAL
                setMargins(small, 0, 0, 0)
            }
            setOnTouchListener { _, event ->
                when (event.action) {
                    MotionEvent.ACTION_DOWN -> {
                        initialX = videoParams.x
                        initialY = videoParams.y
                        initialTouchX = event.rawX
                        initialTouchY = event.rawY
                        true
                    }
                    MotionEvent.ACTION_MOVE -> {
                        val dx = (event.rawX - initialTouchX).toInt()
                        val dy = (event.rawY - initialTouchY).toInt()
                        videoParams.x = initialX + dx
                        videoParams.y = initialY + dy
                        ctrlParams.x = videoParams.x
                        ctrlParams.y = videoParams.y - barH - gap
                        updateLayouts()
                        true
                    }
                    else -> false
                }
            }
        }
        ctrlFrame.addView(dragBtn)

        // Mute button
        val muteBtn = TextView(this).apply {
            text = "\uD83D\uDD0A"
            textSize = 15f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            layoutParams = FrameLayout.LayoutParams(btnW, btnH).apply {
                gravity = Gravity.START or Gravity.CENTER_VERTICAL
                setMargins(btnW + small, 0, 0, 0)
            }
            setOnTouchListener { _, event ->
                if (event.action == MotionEvent.ACTION_UP) { toggleMute(); true } else false
            }
        }
        ctrlFrame.addView(muteBtn)

        // Play/Pause button
        playPauseBtn = TextView(this).apply {
            text = "\u23F8"
            textSize = 15f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            layoutParams = FrameLayout.LayoutParams(btnW, btnH).apply {
                gravity = Gravity.START or Gravity.CENTER_VERTICAL
                setMargins(btnW * 2 + small * 2, 0, 0, 0)
            }
            setOnTouchListener { _, event ->
                if (event.action == MotionEvent.ACTION_UP) { togglePlayback(); true } else false
            }
        }
        ctrlFrame.addView(playPauseBtn)

        // LIVE seek button
        val liveBtn = TextView(this).apply {
            text = "LIVE"
            textSize = 11f
            gravity = Gravity.CENTER
            setBackgroundColor(Color.RED)
            setTextColor(Color.WHITE)
            setTypeface(null, Typeface.BOLD)
            layoutParams = FrameLayout.LayoutParams(dpToPx(42), btnH).apply {
                gravity = Gravity.START or Gravity.CENTER_VERTICAL
                setMargins(btnW * 3 + small * 3, 0, 0, 0)
            }
            setOnTouchListener { _, event ->
                if (event.action == MotionEvent.ACTION_UP) { seekToLive(); true } else false
            }
        }
        ctrlFrame.addView(liveBtn)

        // Resize handle — right side
        val resizeBtn = TextView(this).apply {
            text = "\u25A2"
            textSize = 18f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            setTypeface(null, Typeface.BOLD)
            layoutParams = FrameLayout.LayoutParams(btnW, btnH).apply {
                gravity = Gravity.END or Gravity.CENTER_VERTICAL
                setMargins(0, 0, small, 0)
            }
            setOnTouchListener { _, event ->
                when (event.action) {
                    MotionEvent.ACTION_DOWN -> {
                        isResizing = true
                        initialW = videoParams.width
                        initialH = videoParams.height
                        initialTouchX = event.rawX
                        initialTouchY = event.rawY
                        true
                    }
                    MotionEvent.ACTION_MOVE -> {
                        if (isResizing) {
                            val dw = (event.rawX - initialTouchX).toInt()
                            val dh = (event.rawY - initialTouchY).toInt()
                            videoParams.width = (initialW + dw).coerceAtLeast(dpToPx(200))
                            videoParams.height = (initialH + dh).coerceAtLeast(dpToPx(150))
                            ctrlParams.width = videoParams.width
                            updateLayouts()
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
        }
        ctrlFrame.addView(resizeBtn)

        // Close button — far right
        val closeBtn = TextView(this).apply {
            text = "\u2715"
            textSize = 18f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            setTypeface(null, Typeface.BOLD)
            layoutParams = FrameLayout.LayoutParams(btnW, btnH).apply {
                gravity = Gravity.END or Gravity.CENTER_VERTICAL
                setMargins(0, 0, btnW + small, 0)
            }
            setOnTouchListener { _, event ->
                if (event.action == MotionEvent.ACTION_UP) { stopSelf(); true } else false
            }
        }
        ctrlFrame.addView(closeBtn)

        // Add both windows
        try {
            windowManager.addView(ctrlFrame, ctrlParams)
            windowManager.addView(videoFrame, videoParams)
            setupNotification(title)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to add overlay", e)
            stopSelf()
        }
    }

    private fun updateStream(url: String, title: String) {
        Log.d(TAG, "Switching stream: $url")
        exoPlayer?.let { player ->
            val hf = DefaultHttpDataSource.Factory().setUserAgent("Mozilla/5.0").setAllowCrossProtocolRedirects(true)
            val ds = DefaultDataSource.Factory(this, hf)
            player.setMediaSource(HlsMediaSource.Factory(ds).createMediaSource(MediaItem.fromUri(url)))
            player.prepare()
            player.playWhenReady = true
            isPlaying = true
            playPauseBtn?.text = "\u23F8"
        }
        setupNotification(title)
    }

    private fun updateLayouts() {
        try {
            videoRoot?.let { windowManager.updateViewLayout(it, videoParams) }
            ctrlRoot?.let { windowManager.updateViewLayout(it, ctrlParams) }
        } catch (e: Exception) {
            Log.e(TAG, "updateLayouts failed", e)
        }
    }

    private fun dpToPx(dp: Int): Int = (dp * resources.displayMetrics.density).toInt()

    private fun setupNotification(title: String) {
        val stopPi = PendingIntent.getService(this, 0,
            Intent(this, WWELiveFloatingService::class.java).apply { action = "STOP" },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val mutePi = PendingIntent.getService(this, 1,
            Intent(this, WWELiveFloatingService::class.java).apply { action = "TOGGLE_MUTE" },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val togglePi = PendingIntent.getService(this, 2,
            Intent(this, WWELiveFloatingService::class.java).apply { action = "TOGGLE_PLAY" },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("WWE Live Player")
            .setContentText(title)
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .addAction(android.R.drawable.ic_lock_silent_mode_off, "Mute", mutePi)
            .addAction(android.R.drawable.ic_media_pause, "Play/Pause", togglePi)
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
            val channel = NotificationChannel(CHANNEL_ID, "WWE Live Floating Player", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        try { ctrlRoot?.let { windowManager.removeView(it) } } catch (_: Exception) {}
        try { videoRoot?.let { windowManager.removeView(it) } } catch (_: Exception) {}
        exoPlayer?.release()
        exoPlayer = null
        playerView = null
        videoRoot = null
        ctrlRoot = null
        try { sendBroadcast(Intent("com.rkotv.FLOAT_CLOSED")) } catch (_: Exception) {}
    }
}
