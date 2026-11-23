package uz.mital.jumavoy;

import android.Manifest;
import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.WebResourceResponse;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * JUMAVOY: the web app (jumavoy/ on GitHub Pages) in a WebView, plus what a web page cannot do on its own —
 * being the phone's assistant. Opened by the assistant gesture (ASSIST / VOICE_COMMAND) it asks to unlock the phone
 * if it is locked and starts listening at once. The personal /app link is kept by the web page (localStorage);
 * it can be pasted on the first screen or shared to JUMAVOY from Telegram.
 */
public class MainActivity extends Activity {
  static final String BASE = "https://mital111222333.github.io/MitalCRM/jumavoy/";
  static final int MIC = 1, MIC_NATIVE = 2;
  WebView web;
  WebFiles files;
  long lastUpdate;
  Voice voice;
  PermissionRequest pending;
  float barTop, barBottom; // status / navigation bar heights in CSS px, handed to the page (--sat / --sab)

  @Override protected void onCreate(Bundle b) {
    super.onCreate(b);
    files = new WebFiles(this);
    // a service worker left by an older version must not stand between the page and the app's own copy
    try {
      ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
        @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest r) { return "GET".equals(r.getMethod()) ? files.serve(r.getUrl().toString()) : null; }
      });
    } catch (Exception ignored) { }
    web = new WebView(this);
    web.setBackgroundColor(Color.BLACK);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false); // the spoken answer plays by itself
    web.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
        Uri u = r.getUrl();
        if (u.toString().startsWith(BASE)) return false;
        try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
        return true; // Telegram, WhatsApp, sites → their own apps
      }
      @Override public void onPageFinished(WebView v, String url) { sendInsets(); }
      // the page itself comes from the phone: opens at once even without the internet (WebFiles)
      @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
        return "GET".equals(r.getMethod()) ? files.serve(r.getUrl().toString()) : null;
      }
      // the WebView's engine crashed or was stopped by Android to free memory: open again instead of closing the app
      @Override public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
        if (web == v) { ((android.view.ViewGroup) v.getParent()).removeView(v); v.destroy(); web = null; recreate(); }
        return true;
      }
    });
    web.setWebChromeClient(new WebChromeClient() {
      @Override public void onPermissionRequest(PermissionRequest r) {
        runOnUiThread(() -> {
          if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) r.grant(r.getResources());
          else { pending = r; requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, MIC); }
        });
      }
    });
    voice = new Voice(this, web);
    web.addJavascriptInterface(voice, "JumavoyNative"); // the phone's speech recognition and voice (Voice.java)
    web.addJavascriptInterface(new Device(this), "JumavoyDevice"); // alarm, timer, calendar, call, SMS, route, apps (Device.java)
    FrameLayout root = new FrameLayout(this);
    root.setBackgroundColor(Color.BLACK);
    root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
    setContentView(root);
    edgeToEdge(root);
    if (b != null) web.restoreState(b);
    open(getIntent(), b == null);
    updatePage();
  }

  // a newer page from GitHub, in the background, at most every 30 minutes; used at the next opening
  void updatePage() {
    long now = System.currentTimeMillis();
    if (now - lastUpdate < 30 * 60e3) return;
    lastUpdate = now;
    new Thread(files::update, "jumavoy-web-update").start();
  }

  @Override protected void onResume() { super.onResume(); updatePage(); }

  @Override protected void onNewIntent(Intent i) {
    super.onNewIntent(i);
    setIntent(i);
    open(i, false);
  }

  /**
   * Siri-like full screen: the page is drawn under the status and navigation bars (the screen-edge glow reaches the
   * corners) and gets their heights as CSS variables. Android 15 (targetSdk 35) forces this mode anyway, and there the
   * keyboard no longer shrinks the window by itself (adjustResize is ignored) — so the keyboard height is taken off
   * the bottom here, otherwise the keyboard covers the text field.
   */
  void edgeToEdge(View root) {
    if (Build.VERSION.SDK_INT < 30) return; // Android 8–10: black bars, the window resizes for the keyboard by itself
    getWindow().setDecorFitsSystemWindows(false);
    getWindow().setStatusBarColor(Color.TRANSPARENT);
    getWindow().setNavigationBarColor(Color.TRANSPARENT);
    getWindow().setNavigationBarContrastEnforced(false);
    root.setOnApplyWindowInsetsListener((v, in) -> {
      android.graphics.Insets bars = in.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
      android.graphics.Insets ime = in.getInsets(WindowInsets.Type.ime());
      boolean kb = ime.bottom > bars.bottom;
      v.setPadding(bars.left, 0, bars.right, kb ? ime.bottom : 0);
      float d = getResources().getDisplayMetrics().density;
      barTop = bars.top / d;
      barBottom = kb ? 0 : bars.bottom / d;
      sendInsets();
      return WindowInsets.CONSUMED;
    });
    root.requestApplyInsets();
  }

  void sendInsets() {
    if (web == null || Build.VERSION.SDK_INT < 30) return;  // Android 8–10: the window is not drawn under the bars
    web.evaluateJavascript("(function(s){s.setProperty('--sat','" + barTop + "px');s.setProperty('--sab','" + barBottom
      + "px');window.dispatchEvent(new Event('resize'))})(document.documentElement.style)", null);
  }

  boolean isAssist(Intent i) {
    String a = i == null ? null : i.getAction();
    return Intent.ACTION_ASSIST.equals(a) || Intent.ACTION_VOICE_COMMAND.equals(a);
  }

  void open(Intent i, boolean fresh) {
    if (web == null) return;
    String link = sharedLink(i);
    if (link != null) { web.loadUrl(BASE + "#" + link); return; }
    if (isAssist(i)) {
      unlockIfNeeded();
      if (fresh || web.getUrl() == null) web.loadUrl(BASE + "?assist=1");
      else web.evaluateJavascript("window.jumavoyAssist && window.jumavoyAssist()", null);
    } else if (fresh || web.getUrl() == null || files.updated) { files.updated = false; web.loadUrl(BASE); } // a newer page was downloaded → open it
  }

  // the assistant gesture works on the lock screen too, but the CRM is shown only after the owner unlocks the phone
  void unlockIfNeeded() {
    setShowWhenLocked(true);
    setTurnScreenOn(true);
    KeyguardManager km = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
    if (km != null && km.isKeyguardLocked()) km.requestDismissKeyguard(this, null);
  }

  // «c=123&k=…» from a shared /app link
  String sharedLink(Intent i) {
    if (i == null || !Intent.ACTION_SEND.equals(i.getAction())) return null;
    String t = i.getStringExtra(Intent.EXTRA_TEXT);
    if (t == null) return null;
    Matcher m = Pattern.compile("c=(\\d+)&k=([0-9a-f]{32})").matcher(t);
    return m.find() ? "c=" + m.group(1) + "&k=" + m.group(2) : null;
  }

  @Override public void onRequestPermissionsResult(int code, String[] p, int[] res) {
    if (code == MIC_NATIVE) { voice.permissionResult(res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED); return; }
    if (code != MIC || pending == null) return;
    if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED) pending.grant(pending.getResources());
    else pending.deny();
    pending = null;
  }

  @Override protected void onSaveInstanceState(Bundle b) { super.onSaveInstanceState(b); if (web != null) web.saveState(b); }

  @Override protected void onDestroy() { if (voice != null) voice.destroy(); super.onDestroy(); }

  // «Back» closes an open sheet / the menu of the page first (window.jumavoyBack returns true), then leaves the app
  @Override public void onBackPressed() {
    if (web == null) { super.onBackPressed(); return; }
    web.evaluateJavascript("window.jumavoyBack ? window.jumavoyBack() : false", v -> { if (!"true".equals(v)) { if (web != null && web.canGoBack()) web.goBack(); else moveTaskToBack(true); } });
  }
}
