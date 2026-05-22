package com.rkotv

import android.app.AlertDialog
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ActivityInfo
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.view.Gravity
import android.view.MotionEvent
import android.view.ViewGroup
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {
    companion object {
        private const val OVERLAY_PERMISSION_REQUEST_CODE = 1001
        private const val TAG = "RKO_TV"
        private const val APP_URL = "https://rkolive.vercel.app/"
        const val ACTION_SET_ORIENTATION = "com.rkotv.SET_ORIENTATION"
        const val EXTRA_ORIENTATION = "orientation"
    }

    private lateinit var webView: WebView
    private var isCustomErrorShown = false

    private val orientationReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == ACTION_SET_ORIENTATION) {
                val orientation = intent.getIntExtra(EXTRA_ORIENTATION, ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED)
                setRequestedOrientation(orientation)
            }
        }
    }

    private val floatCloseReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == "com.rkotv.FLOAT_CLOSED") {
                webView.evaluateJavascript("(function(){var v=document.querySelector('video');if(v){v.play().catch(function(){})}})()", null)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)

        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.useWideViewPort = true
        webView.settings.loadWithOverviewMode = true
        webView.settings.allowFileAccess = true
        webView.settings.mediaPlaybackRequiresUserGesture = false

        webView.addJavascriptInterface(FloatBridge(), "Android")

        webView.webChromeClient = android.webkit.WebChromeClient()

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()
                if (url.startsWith("rko://float")) {
                    val uri = Uri.parse(url)
                    val videoUrl = uri.getQueryParameter("url") ?: ""
                    val title = uri.getQueryParameter("title") ?: "Stream"
                    Log.d(TAG, "URL scheme caught: $videoUrl | $title")
                    if (videoUrl.isNotEmpty()) {
                        view.evaluateJavascript("(function(){var v=document.querySelector('video');if(v)v.pause()})()", null)
                        launchFloatingPlayer(videoUrl, title)
                    }
                    return true
                }
                if (url.startsWith("rko://ipl2float")) {
                    val uri = Uri.parse(url)
                    var videoUrl = uri.getQueryParameter("url") ?: ""
                    val title = uri.getQueryParameter("title") ?: "Stream"
                    if (videoUrl.startsWith("/")) {
                        val origin = view.url?.let { Uri.parse(it).toString().takeWhile { c -> c != '/' } }
                        videoUrl = "${view.url?.substringBeforeLast("/")}$videoUrl"
                    }
                    Log.d(TAG, "URL scheme IPL2: $videoUrl | $title")
                    if (videoUrl.isNotEmpty()) {
                        view.evaluateJavascript("(function(){var v=document.querySelector('video');if(v)v.pause()})()", null)
                        launchIPL2FloatingPlayer(videoUrl, title)
                    }
                    return true
                }
                if (url.startsWith("rko://webfloat")) {
                    val uri = Uri.parse(url)
                    val videoUrl = uri.getQueryParameter("url") ?: ""
                    val title = uri.getQueryParameter("title") ?: "Web"
                    Log.d(TAG, "URL scheme Web: $videoUrl | $title")
                    if (videoUrl.isNotEmpty()) {
                        launchWebFloatingPlayer(videoUrl, title)
                    }
                    return true
                }
                if (url.startsWith("rko://wwelivefloat")) {
                    val uri = Uri.parse(url)
                    val videoUrl = uri.getQueryParameter("url") ?: ""
                    val title = uri.getQueryParameter("title") ?: "WWE Live"
                    Log.d(TAG, "URL scheme WWE: $videoUrl | $title")
                    if (videoUrl.isNotEmpty()) {
                        view.evaluateJavascript("(function(){var v=document.querySelector('video');if(v)v.pause()})()", null)
                        launchWWELiveFloatingPlayer(videoUrl, title)
                    }
                    return true
                }
                if (url.startsWith("rko://iptvfloat")) {
                    val uri = Uri.parse(url)
                    val videoUrl = uri.getQueryParameter("url") ?: ""
                    val title = uri.getQueryParameter("title") ?: "Stream"
                    Log.d(TAG, "URL scheme IPTV: $videoUrl | $title")
                    if (videoUrl.isNotEmpty()) {
                        view.evaluateJavascript("(function(){var v=document.querySelector('video');if(v)v.pause()})()", null)
                        launchIPTVFloatingPlayer(videoUrl, title)
                    }
                    return true
                }
                if (url.startsWith("rko://footystreamfloat")) {
                    val uri = Uri.parse(url)
                    val videoUrl = uri.getQueryParameter("url") ?: ""
                    val title = uri.getQueryParameter("title") ?: "FootyStream"
                    Log.d(TAG, "URL scheme FootyStream: $videoUrl | $title")
                    if (videoUrl.isNotEmpty()) {
                        view.evaluateJavascript("(function(){var v=document.querySelector('video');if(v)v.pause()})()", null)
                        launchFootyStreamFloatingPlayer(videoUrl, title)
                    }
                    return true
                }
                if (url.startsWith("rko://streamrkofloat")) {
                    val uri = Uri.parse(url)
                    val videoUrl = uri.getQueryParameter("url") ?: ""
                    val title = uri.getQueryParameter("title") ?: "Stream RKO"
                    Log.d(TAG, "URL scheme StreamRKO: $videoUrl | $title")
                    if (videoUrl.isNotEmpty()) {
                        view.evaluateJavascript("(function(){var v=document.querySelector('video');if(v)v.pause()})()", null)
                        launchStreamRkoFloatingPlayer(videoUrl, title)
                    }
                    return true
                }
                if (url.startsWith("mailto:")) {
                    try {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                        startActivity(intent)
                    } catch (e: Exception) {
                        Log.w(TAG, "mailto not handled: ${e.message}")
                    }
                    return true
                }
                if (!url.contains("rkolive.vercel.app") && !url.contains("rko.tv")) {
                    try {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                        startActivity(intent)
                    } catch (e: Exception) {
                        Log.w(TAG, "External URL not handled: ${e.message}")
                    }
                    return true
                }
                return false
            }

            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                isCustomErrorShown = false
            }

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                if (!isCustomErrorShown) {
                    injectOverrides(view)
                }
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                super.onReceivedError(view, request, error)
                if (request.isForMainFrame && !isCustomErrorShown) {
                    isCustomErrorShown = true
                    view.loadUrl("javascript:document.body.innerHTML='" +
                        "<div style=\"display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#0f0f14;color:#fff;font-family:sans-serif;padding:20px;text-align:center;\">"+
                        "<div style=\"font-size:60px;margin-bottom:16px;\">&#127761;</div>"+
                        "<h2 style=\"margin:0 0 8px;color:#4a9eff;\">No Internet Connection</h2>"+
                        "<p style=\"margin:0 0 24px;color:#888;font-size:14px;\">Check your network and try again</p>"+
                        "<button onclick=\"location.reload()\" style=\"background:#4a9eff;color:#fff;border:none;padding:12px 28px;font-size:16px;border-radius:8px;cursor:pointer;font-weight:600;\">Retry</button>"+
                        "</div>';void 0;")
                }
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: android.webkit.WebResourceResponse) {
                super.onReceivedHttpError(view, request, errorResponse)
                if (request.isForMainFrame && errorResponse.statusCode >= 500 && !isCustomErrorShown) {
                    isCustomErrorShown = true
                    view.loadUrl("javascript:document.body.innerHTML='" +
                        "<div style=\"display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#0f0f14;color:#fff;font-family:sans-serif;padding:20px;text-align:center;\">"+
                        "<div style=\"font-size:60px;margin-bottom:16px;\">&#9888;</div>"+
                        "<h2 style=\"margin:0 0 8px;color:#4a9eff;\">Server Error</h2>"+
                        "<p style=\"margin:0 0 24px;color:#888;font-size:14px;\">Unable to reach the server</p>"+
                        "<button onclick=\"location.reload()\" style=\"background:#4a9eff;color:#fff;border:none;padding:12px 28px;font-size:16px;border-radius:8px;cursor:pointer;font-weight:600;\">Retry</button>"+
                        "</div>';void 0;")
                }
            }
        }

        // Swipe down from top to reload - intercept before WebView
        val rootLayout = object : FrameLayout(this) {
            // WebView blocks parent intercept during scroll - ignore it
            override fun requestDisallowInterceptTouchEvent(disallow: Boolean) {}

            override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
                when (ev.action) {
                    MotionEvent.ACTION_DOWN -> touchStartY = ev.rawY
                    MotionEvent.ACTION_MOVE -> {
                        if (touchStartY < 80 && ev.rawY - touchStartY > SWIPE_THRESHOLD
                            && !webView.canScrollVertically(-1)) {
                            reloadApp()
                            return true
                        }
                    }
                }
                return super.onInterceptTouchEvent(ev)
            }
        }
        rootLayout.addView(webView, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(rootLayout)

        // Share button at top right
        val shareBtn = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_menu_share)
            setBackgroundColor(0x66000000.toInt())
            scaleType = android.widget.ImageView.ScaleType.CENTER_INSIDE
            layoutParams = FrameLayout.LayoutParams(dpToPx(40), dpToPx(40)).apply {
                gravity = Gravity.TOP or Gravity.END
                setMargins(0, dpToPx(8), dpToPx(52), 0)
            }
            setOnClickListener {
                val intent = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_TEXT, "Watch live TV, IPL, cricket, and more with RKO TV! Download the app: https://rkolive.vercel.app/download.html")
                }
                startActivity(Intent.createChooser(intent, "Share RKO TV"))
            }
        }
        rootLayout.addView(shareBtn)

        // Reload button at top right
        val reloadBtn = ImageButton(this).apply {
            setImageResource(android.R.drawable.ic_menu_rotate)
            setBackgroundColor(0x66000000.toInt())
            scaleType = android.widget.ImageView.ScaleType.CENTER_INSIDE
            layoutParams = FrameLayout.LayoutParams(dpToPx(40), dpToPx(40)).apply {
                gravity = Gravity.TOP or Gravity.END
                setMargins(0, dpToPx(8), dpToPx(8), 0)
            }
            setOnClickListener { reloadApp() }
        }
        rootLayout.addView(reloadBtn)

        webView.loadUrl(APP_URL)

        checkForUpdate()

        if (!Settings.canDrawOverlays(this)) {
            AlertDialog.Builder(this)
                .setTitle("Floating Player")
                .setMessage("Allow 'Display over other apps' to play video over Facebook, TikTok, etc.")
                .setPositiveButton("Enable") { _, _ ->
                    startActivityForResult(
                        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.parse("package:$packageName")),
                        OVERLAY_PERMISSION_REQUEST_CODE
                    )
                }
                .setNegativeButton("Later", null)
                .show()
        }

        try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                registerReceiver(floatCloseReceiver, IntentFilter("com.rkotv.FLOAT_CLOSED"), RECEIVER_NOT_EXPORTED)
                registerReceiver(orientationReceiver, IntentFilter(ACTION_SET_ORIENTATION), RECEIVER_NOT_EXPORTED)
            } else {
                registerReceiver(floatCloseReceiver, IntentFilter("com.rkotv.FLOAT_CLOSED"))
                registerReceiver(orientationReceiver, IntentFilter(ACTION_SET_ORIENTATION))
            }
        } catch (e: Exception) {
            Log.w(TAG, "Receiver not registered: ${e.message}")
        }
    }

    inner class FloatBridge {
        @JavascriptInterface
        fun onVideoPlaying(url: String) {
            Log.d(TAG, "JS bridge video playing: $url")
        }
        @JavascriptInterface
        fun startFloatingPlayer(url: String, title: String) {
            Log.d(TAG, "JS bridge: $url | $title")
            runOnUiThread { launchFloatingPlayer(url, title) }
        }
        @JavascriptInterface
        fun startIPL2FloatingPlayer(url: String, title: String) {
            Log.d(TAG, "JS bridge IPL2: $url | $title")
            runOnUiThread { launchIPL2FloatingPlayer(url, title) }
        }
        @JavascriptInterface
        fun startIPTVFloatingPlayer(url: String, title: String) {
            Log.d(TAG, "JS bridge IPTV: $url | $title")
            runOnUiThread { launchIPTVFloatingPlayer(url, title) }
        }
        @JavascriptInterface
        fun startWebFloatingPlayer(url: String, title: String) {
            Log.d(TAG, "JS bridge Web: $url | $title")
            runOnUiThread { launchWebFloatingPlayer(url, title) }
        }
        @JavascriptInterface
        fun startWWELiveFloatingPlayer(url: String, title: String) {
            Log.d(TAG, "JS bridge WWE Live: $url | $title")
            runOnUiThread { launchWWELiveFloatingPlayer(url, title) }
        }
        @JavascriptInterface
        fun startStreamRkoFloatingPlayer(url: String, title: String) {
            Log.d(TAG, "JS bridge Stream RKO: $url | $title")
            runOnUiThread { launchStreamRkoFloatingPlayer(url, title) }
        }
        @JavascriptInterface
        fun startFootyStreamFloatingPlayer(url: String, title: String) {
            Log.d(TAG, "JS bridge FootyStream: $url | $title")
            runOnUiThread { launchFootyStreamFloatingPlayer(url, title) }
        }
    }

    private fun launchFloatingPlayer(url: String, title: String) {
        if (!Settings.canDrawOverlays(this)) {
            AlertDialog.Builder(this)
                .setTitle("Permission Needed")
                .setMessage("Allow overlay permission for floating player.")
                .setPositiveButton("Enable") { _, _ ->
                    startActivityForResult(
                        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.parse("package:$packageName")),
                        OVERLAY_PERMISSION_REQUEST_CODE
                    )
                }
                .setNegativeButton("Cancel", null)
                .show()
            return
        }
        webView.evaluateJavascript("(function(){var v=document.querySelector('video');if(v)v.pause()})()", null)
        Log.d(TAG, "Starting FloatingService: $url")
        val intent = Intent(this, FloatingService::class.java)
        intent.putExtra("url", url)
        intent.putExtra("title", title)
        startService(intent)
        Toast.makeText(this, "Floating player started", Toast.LENGTH_SHORT).show()
    }

    private fun launchIPL2FloatingPlayer(url: String, title: String) {
        if (!Settings.canDrawOverlays(this)) {
            AlertDialog.Builder(this)
                .setTitle("Permission Needed")
                .setMessage("Allow overlay permission for floating player.")
                .setPositiveButton("Enable") { _, _ ->
                    startActivityForResult(
                        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.parse("package:$packageName")),
                        OVERLAY_PERMISSION_REQUEST_CODE
                    )
                }
                .setNegativeButton("Cancel", null)
                .show()
            return
        }
        webView.evaluateJavascript("(function(){var v=document.querySelector('video');if(v)v.pause()})()", null)
        Log.d(TAG, "Starting IPL2FloatingService: $url")
        val intent = Intent(this, IPL2FloatingService::class.java)
        intent.putExtra("url", url)
        intent.putExtra("title", title)
        startService(intent)
        Toast.makeText(this, "IPL2 player started", Toast.LENGTH_SHORT).show()
    }

    private fun launchIPTVFloatingPlayer(url: String, title: String) {
        if (!Settings.canDrawOverlays(this)) {
            AlertDialog.Builder(this)
                .setTitle("Permission Needed")
                .setMessage("Allow overlay permission for floating player.")
                .setPositiveButton("Enable") { _, _ ->
                    startActivityForResult(
                        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.parse("package:$packageName")),
                        OVERLAY_PERMISSION_REQUEST_CODE
                    )
                }
                .setNegativeButton("Cancel", null)
                .show()
            return
        }
        webView.evaluateJavascript("(function(){var v=document.querySelector('video');if(v)v.pause()})()", null)
        Log.d(TAG, "Starting IPTVFloatingService: $url")
        val intent = Intent(this, IPTVFloatingService::class.java)
        intent.putExtra("url", url)
        intent.putExtra("title", title)
        startService(intent)
        Toast.makeText(this, "IPTV player started", Toast.LENGTH_SHORT).show()
    }

    private fun launchWebFloatingPlayer(url: String, title: String) {
        if (!Settings.canDrawOverlays(this)) {
            AlertDialog.Builder(this)
                .setTitle("Permission Needed")
                .setMessage("Allow overlay permission for floating player.")
                .setPositiveButton("Enable") { _, _ ->
                    startActivityForResult(
                        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.parse("package:$packageName")),
                        OVERLAY_PERMISSION_REQUEST_CODE
                    )
                }
                .setNegativeButton("Cancel", null)
                .show()
            return
        }
        Log.d(TAG, "Starting WebFloatingService: $url")
        val intent = Intent(this, WebFloatingService::class.java)
        intent.putExtra("url", url)
        intent.putExtra("title", title)
        startService(intent)
        Toast.makeText(this, "Web player started", Toast.LENGTH_SHORT).show()
    }

    private fun launchWWELiveFloatingPlayer(url: String, title: String) {
        if (!Settings.canDrawOverlays(this)) {
            AlertDialog.Builder(this)
                .setTitle("Permission Needed")
                .setMessage("Allow overlay permission for floating player.")
                .setPositiveButton("Enable") { _, _ ->
                    startActivityForResult(
                        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.parse("package:$packageName")),
                        OVERLAY_PERMISSION_REQUEST_CODE
                    )
                }
                .setNegativeButton("Cancel", null)
                .show()
            return
        }
        webView.evaluateJavascript("(function(){var v=document.querySelector('video');if(v)v.pause()})()", null)
        Log.d(TAG, "Starting WWELiveFloatingService: $url")
        val intent = Intent(this, WWELiveFloatingService::class.java)
        intent.putExtra("url", url)
        intent.putExtra("title", title)
        startService(intent)
        Toast.makeText(this, "WWE Live player started", Toast.LENGTH_SHORT).show()
    }

    private fun launchStreamRkoFloatingPlayer(url: String, title: String) {
        if (!Settings.canDrawOverlays(this)) {
            AlertDialog.Builder(this)
                .setTitle("Permission Needed")
                .setMessage("Allow overlay permission for floating player.")
                .setPositiveButton("Enable") { _, _ ->
                    startActivityForResult(
                        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.parse("package:$packageName")),
                        OVERLAY_PERMISSION_REQUEST_CODE
                    )
                }
                .setNegativeButton("Cancel", null)
                .show()
            return
        }
        webView.evaluateJavascript("(function(){var v=document.querySelector('video');if(v)v.pause()})()", null)
        Log.d(TAG, "Starting StreamRkoFloatingService: $url")
        val intent = Intent(this, StreamRkoFloatingService::class.java)
        intent.putExtra("url", url)
        intent.putExtra("title", title)
        startService(intent)
        Toast.makeText(this, "Stream RKO player started", Toast.LENGTH_SHORT).show()
    }

    private fun launchFootyStreamFloatingPlayer(url: String, title: String) {
        if (!Settings.canDrawOverlays(this)) {
            AlertDialog.Builder(this)
                .setTitle("Permission Needed")
                .setMessage("Allow overlay permission for floating player.")
                .setPositiveButton("Enable") { _, _ ->
                    startActivityForResult(
                        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.parse("package:$packageName")),
                        OVERLAY_PERMISSION_REQUEST_CODE
                    )
                }
                .setNegativeButton("Cancel", null)
                .show()
            return
        }
        webView.evaluateJavascript("(function(){var v=document.querySelector('video');if(v)v.pause()})()", null)
        Log.d(TAG, "Starting FootyStreamFloatingService: $url")
        val intent = Intent(this, FootyStreamFloatingService::class.java)
        intent.putExtra("url", url)
        intent.putExtra("title", title)
        startService(intent)
        Toast.makeText(this, "FootyStream player started", Toast.LENGTH_SHORT).show()
    }

    private var downloadId: Long = -1
    private val downloadReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1)
            if (id == downloadId) {
                val dm = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
                val query = DownloadManager.Query().setFilterById(id)
                val cursor: Cursor = dm.query(query)
                if (cursor.moveToFirst()) {
                    val status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                    if (status == DownloadManager.STATUS_SUCCESSFUL) {
                        installApk()
                    }
                }
                cursor.close()
            }
        }
    }

    private fun installApk() {
        val file = File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "rkotv-update.apk")
        val installUri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
        val intent = Intent(Intent.ACTION_INSTALL_PACKAGE).apply {
            setDataAndType(installUri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        startActivity(intent)
    }

    private fun checkForUpdate() {
        Thread {
            try {
                val currentCode = BuildConfig.VERSION_CODE
                val url = URL("https://rkolive.vercel.app/api/latest-version")
                val conn = url.openConnection() as HttpURLConnection
                conn.connectTimeout = 8000
                conn.readTimeout = 8000
                conn.requestMethod = "GET"
                val reader = conn.inputStream.bufferedReader().readText()
                conn.disconnect()
                val json = JSONObject(reader)
                val latestCode = json.getInt("versionCode")
                val latestName = json.getString("versionName")
                val downloadUrl = json.getString("downloadUrl")

                if (latestCode > currentCode) {
                    val apkUrl = "https://rkolive.vercel.app$downloadUrl"
                    Handler(Looper.getMainLooper()).post {
                        AlertDialog.Builder(this)
                            .setTitle("Update Available")
                            .setMessage("Version $latestName available (you have ${BuildConfig.VERSION_NAME}). Download & install?")
                            .setPositiveButton("Download") { _, _ ->
                                AlertDialog.Builder(this)
                                    .setTitle("Installation Notice")
                                    .setMessage("If installation is blocked:\n\n1. Settings > Apps > RKO TV > Install unknown apps > Allow\n2. Or Settings > Google > Play Protect > disable scanning\n\nThis update is signed with the same key — safe to install.")
                                    .setPositiveButton("Got it, start download") { _, _ ->
                                        startUpdateDownload(apkUrl, latestName)
                                    }
                                    .setNegativeButton("Cancel", null)
                                    .show()
                            }
                            .setNegativeButton("Later", null)
                            .show()
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Update check failed: ${e.message}")
            }
        }.start()
    }

    private fun startUpdateDownload(apkUrl: String, versionName: String) {
        val dm = getSystemService(DOWNLOAD_SERVICE) as DownloadManager
        val request = DownloadManager.Request(Uri.parse(apkUrl)).apply {
            setTitle("RKO TV Update")
            setDescription("Downloading $versionName...")
            setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            setDestinationInExternalFilesDir(this@MainActivity, Environment.DIRECTORY_DOWNLOADS, "rkotv-update.apk")
        }
        downloadId = dm.enqueue(request)
        registerReceiver(downloadReceiver, IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) RECEIVER_NOT_EXPORTED else 0)
        Toast.makeText(this@MainActivity, "Download started...", Toast.LENGTH_LONG).show()
    }

    private fun injectOverrides(view: WebView) {
        val js = """
            (function() {
                if (window.__rko) return;
                window.__rko = true;
                function fixUrl(u) {
                    if (u && u.charAt(0) === '/' && u.indexOf('://') < 0) {
                        return window.location.origin + u;
                    }
                    return u;
                }
                function sendNative(url, title) {
                    url = fixUrl(url);
                    console.log('RKO native: ' + url);
                    if (url && url.length > 10 && url.indexOf('blob:') !== 0) {
                        try { Android.startFloatingPlayer(url, title || 'Stream'); } catch(e) {
                            window.location.href = 'rko://float?url=' + encodeURIComponent(url) + '&title=' + encodeURIComponent(title||'Stream');
                        }
                        return true;
                    }
                    return false;
                }
                function sendIPL2Native(url, title) {
                    url = fixUrl(url);
                    console.log('RKO IPL2 native: ' + url);
                    if (url && url.length > 10 && url.indexOf('blob:') !== 0) {
                        try { Android.startIPL2FloatingPlayer(url, title || 'Stream'); } catch(e) {
                            window.location.href = 'rko://ipl2float?url=' + encodeURIComponent(url) + '&title=' + encodeURIComponent(title||'Stream');
                        }
                        return true;
                    }
                    return false;
                }
                function sendIPTVNative(url, title) {
                    url = fixUrl(url);
                    console.log('RKO IPTV native: ' + url);
                    if (url && url.length > 10 && url.indexOf('blob:') !== 0) {
                        try { Android.startIPTVFloatingPlayer(url, title || 'Stream'); } catch(e) {
                            window.location.href = 'rko://iptvfloat?url=' + encodeURIComponent(url) + '&title=' + encodeURIComponent(title||'Stream');
                        }
                        return true;
                    }
                    return false;
                }
                function sendWebNative(url, title) {
                    url = fixUrl(url);
                    console.log('RKO web native: ' + url);
                    if (url && url.length > 10 && url.indexOf('blob:') !== 0) {
                        try { Android.startWebFloatingPlayer(url, title || 'Web'); } catch(e) {
                            window.location.href = 'rko://webfloat?url=' + encodeURIComponent(url) + '&title=' + encodeURIComponent(title||'Web');
                        }
                        return true;
                    }
                    return false;
                }
                function sendWWELiveNative(url, title) {
                    url = fixUrl(url);
                    console.log('RKO WWE live native: ' + url);
                    if (url && url.length > 10 && url.indexOf('blob:') !== 0) {
                        try { Android.startWWELiveFloatingPlayer(url, title || 'WWE Live'); } catch(e) {
                            window.location.href = 'rko://wwelivefloat?url=' + encodeURIComponent(url) + '&title=' + encodeURIComponent(title||'WWE Live');
                        }
                        return true;
                    }
                    return false;
                }
                function sendStreamRkoNative(url, title) {
                    url = fixUrl(url);
                    console.log('RKO Stream RKO native: ' + url);
                    if (url && url.length > 10 && url.indexOf('blob:') !== 0) {
                        try { Android.startStreamRkoFloatingPlayer(url, title || 'Stream RKO'); } catch(e) {
                            window.location.href = 'rko://streamrkofloat?url=' + encodeURIComponent(url) + '&title=' + encodeURIComponent(title||'Stream RKO');
                        }
                        return true;
                    }
                    return false;
                }
                window.showWebFloatPlayer = function(url, title) {
                    console.log('RKO showWebFloatPlayer: ' + url);
                    sendWebNative(url, title || 'Web');
                };
                function sendFootyStreamNative(url, title) {
                    url = fixUrl(url);
                    console.log('RKO FootyStream native: ' + url);
                    if (url && url.length > 10 && url.indexOf('blob:') !== 0) {
                        try { Android.startFootyStreamFloatingPlayer(url, title || 'FootyStream'); } catch(e) {
                            window.location.href = 'rko://footystreamfloat?url=' + encodeURIComponent(url) + '&title=' + encodeURIComponent(title||'FootyStream');
                        }
                        return true;
                    }
                    return false;
                }
                window.showFloatPlayer = function(url, title) {
                    console.log('RKO showFloatPlayer: ' + url);
                    if (!sendNative(url, title || 'Stream')) {
                        var v = document.querySelector('video');
                        var u = v ? (v.currentSrc || v.src || '') : '';
                        sendNative(u, title || 'Stream');
                    }
                };
                if (window.playCricHDStream) {
                    var origCric = window.playCricHDStream;
                    window.playCricHDStream = function(title, streamUrl) {
                        console.log('RKO playCricHDStream: ' + streamUrl);
                        document.getElementById('nowPlaying').innerHTML = '<span style="color:#4a9eff;">Playing: ' + title + '</span>';
                        sendNative(streamUrl, title);
                    };
                }
                if (window.playIPL2Event) {
                    var origIPL2 = window.playIPL2Event;
                    window.playIPL2Event = function(event) {
                        console.log('RKO playIPL2Event override: ' + event.title);
                        document.getElementById('nowPlaying').innerHTML = '<span style="color:#4a9eff;">Loading: ' + event.title + '</span>';
                        fetch('/api/webcric?action=servers&eventUrl=' + encodeURIComponent(event.url))
                            .then(function(r){return r.json();})
                            .then(function(data){
                                if(data.success&&data.servers&&data.servers.length>0){
                                    if(data.servers.length===1){
                                        sendIPL2Native(data.servers[0].url, event.title+' ('+data.servers[0].name+')');
                                    }else{
                                        var html='<div style="padding:20px;text-align:center;"><h3 style="margin-bottom:15px;color:#fff;">Select Stream: '+event.title+'</h3>';
                                        html+='<div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center;">';
                                        data.servers.forEach(function(s){
                                            var logo=s.logo?'<img src="'+s.logo+'" style="height:24px;vertical-align:middle;margin-right:8px;border-radius:4px;" onerror="this.style.display=\'none\'">':'';
                                            html+='<button onclick="window.selectIPL2Server(\''+s.url+'\',\''+event.title+' ('+s.name+')\')" style="background:#4a9eff;color:#fff;border:none;padding:12px 20px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px;">'+logo+s.name+'</button>';
                                        });
                                        html+='</div><button onclick="document.getElementById(\'streamModal\').classList.remove(\'show\')" style="margin-top:15px;background:#555;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;">Cancel</button></div>';
                                        document.getElementById('modalBody').innerHTML=html;
                                        document.getElementById('streamModal').classList.add('show');
                                    }
                                }else{
                                    document.getElementById('nowPlaying').innerHTML='No streams for: '+event.title;
                                }
                            })
                            .catch(function(e){
                                document.getElementById('nowPlaying').innerHTML='Failed to load: '+event.title;
                            });
                    };
                }
                if (window.playFootyStream) {
                    var origFooty = window.playFootyStream;
                    window.playFootyStream = function(url, name, type) {
                        console.log('RKO playFootyStream: ' + url);
                        if (type === 'hls' || type === 'direct' || (url && url.indexOf('.m3u8') >= 0)) {
                            document.getElementById('nowPlaying').innerHTML = '<span style="color:#4a9eff;">FootyStream: ' + name + '</span>';
                            sendFootyStreamNative(url, name || 'FootyStream');
                        } else {
                            origFooty(url, name, type);
                        }
                    };
                }
                window.selectIPL2Server=function(url,title){
                    document.getElementById('streamModal').classList.remove('show');
                    document.getElementById('nowPlaying').innerHTML='<span style="color:#4a9eff;">Playing: '+title+'</span>';
                    sendIPL2Native(url,title);
                };
                window.popOutCricHD = function(streamUrl, title) {
                    sendNative(streamUrl, title || 'Stream');
                };
                // Route playlist IPTV channels to IPTV floating service
                if (window.playChannel) {
                    var origPlayChannel = window.playChannel;
                    window.playChannel = function(ch, idx) {
                        var urls = (ch.urls && ch.urls.length > 0) ? ch.urls : [ch.url, ch.fallback].filter(Boolean);
                        var url = urls[0] || '';
                        if (url && url.length > 10) {
                            console.log('RKO playChannel IPTV: ' + url);
                            document.getElementById('nowPlaying').innerHTML = '<span style="color:#4a9eff;">Playing: ' + ch.name + '</span>';
                            sendIPTVNative(url, ch.name);
                        }
                    };
                }
                window.toggleMiniPlayer = function() {};
                var origPiP = window.togglePiP;
                window.togglePiP = function() {
                    var v = document.querySelector('video');
                    var u = v ? (v.currentSrc || v.src || '') : '';
                    u = fixUrl(u);
                    console.log('RKO togglePiP: ' + u);
                    if (!sendNative(u, 'Live')) {
                        origPiP && origPiP();
                    }
                };
                var origPip2 = window.pipIplstreams;
                window.pipIplstreams = function() {
                    var v = document.querySelector('video');
                    var u = v ? (v.currentSrc || v.src || '') : '';
                    u = fixUrl(u);
                    console.log('RKO pipIplstreams: ' + u);
                    if (!sendNative(u, 'Live')) {
                        origPip2 && origPip2();
                    }
                };
                // Route WWE streams to WWELiveFloatingService (original handles Android routing)
                if (window.playWWEUrl) {
                    var origWWE = window.playWWEUrl;
                    window.playWWEUrl = function(url, title, referer) {
                        console.log('RKO playWWEUrl override: ' + url);
                        origWWE(url, title, referer);
                    };
                }
            })();
        """.trimIndent()
        view.evaluateJavascript(js, null)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == OVERLAY_PERMISSION_REQUEST_CODE && Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "Permission granted. Tap Float/PiP button again.", Toast.LENGTH_LONG).show()
        }
    }

    override fun onResume() {
        super.onResume()
        getSharedPreferences("rko_orient", Context.MODE_PRIVATE).apply {
            val saved = getInt("orientation", -1)
            if (saved != -1) {
                setRequestedOrientation(saved)
                edit().remove("orientation").apply()
            }
        }
        webView.onResume()
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onDestroy() {
        super.onDestroy()
        try { unregisterReceiver(orientationReceiver) } catch (_: Exception) {}
        try { unregisterReceiver(floatCloseReceiver) } catch (_: Exception) {}
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            try { stopService(Intent(this, FloatingService::class.java)) } catch (_: Exception) {}
            try { stopService(Intent(this, IPL2FloatingService::class.java)) } catch (_: Exception) {}
            try { stopService(Intent(this, IPTVFloatingService::class.java)) } catch (_: Exception) {}
            try { stopService(Intent(this, WebFloatingService::class.java)) } catch (_: Exception) {}
            try { stopService(Intent(this, WWELiveFloatingService::class.java)) } catch (_: Exception) {}
            try { stopService(Intent(this, StreamRkoFloatingService::class.java)) } catch (_: Exception) {}
            try { stopService(Intent(this, FootyStreamFloatingService::class.java)) } catch (_: Exception) {}
            finishAffinity()
        }
    }

    // Swipe down from top to reload
    private var touchStartY = 0f
    private val SWIPE_THRESHOLD = 250

    private fun reloadApp() {
        webView.evaluateJavascript("(function(){try{var v=document.querySelector('video');if(v)v.pause()}catch(e){}})()", null)
        try { stopService(Intent(this, FloatingService::class.java)) } catch (_: Exception) {}
        try { stopService(Intent(this, IPL2FloatingService::class.java)) } catch (_: Exception) {}
        try { stopService(Intent(this, IPTVFloatingService::class.java)) } catch (_: Exception) {}
        try { stopService(Intent(this, WebFloatingService::class.java)) } catch (_: Exception) {}
        try { stopService(Intent(this, WWELiveFloatingService::class.java)) } catch (_: Exception) {}
        try { stopService(Intent(this, StreamRkoFloatingService::class.java)) } catch (_: Exception) {}
        try { stopService(Intent(this, FootyStreamFloatingService::class.java)) } catch (_: Exception) {}
        webView.reload()
        Toast.makeText(this, "Reloaded", Toast.LENGTH_SHORT).show()
    }

    private fun dpToPx(dp: Int): Int = (dp * resources.displayMetrics.density).toInt()
}
