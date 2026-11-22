package uz.mital.jumavoy;

import android.Manifest;
import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.PermissionRequest;
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
  static final int MIC = 1;
  WebView web;
  PermissionRequest pending;

  @Override protected void onCreate(Bundle b) {
    super.onCreate(b);
    web = new WebView(this);
    web.setBackgroundColor(Color.parseColor("#0a0e1c"));
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
    });
    web.setWebChromeClient(new WebChromeClient() {
      @Override public void onPermissionRequest(PermissionRequest r) {
        runOnUiThread(() -> {
          if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) r.grant(r.getResources());
          else { pending = r; requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, MIC); }
        });
      }
    });
    setContentView(web);
    if (b != null) web.restoreState(b);
    open(getIntent(), b == null);
  }

  @Override protected void onNewIntent(Intent i) {
    super.onNewIntent(i);
    setIntent(i);
    open(i, false);
  }

  boolean isAssist(Intent i) {
    String a = i == null ? null : i.getAction();
    return Intent.ACTION_ASSIST.equals(a) || Intent.ACTION_VOICE_COMMAND.equals(a);
  }

  void open(Intent i, boolean fresh) {
    String link = sharedLink(i);
    if (link != null) { web.loadUrl(BASE + "#" + link); return; }
    if (isAssist(i)) {
      unlockIfNeeded();
      if (fresh || web.getUrl() == null) web.loadUrl(BASE + "?assist=1");
      else web.evaluateJavascript("window.jumavoyAssist && window.jumavoyAssist()", null);
    } else if (fresh || web.getUrl() == null) web.loadUrl(BASE);
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
    if (code != MIC || pending == null) return;
    if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED) pending.grant(pending.getResources());
    else pending.deny();
    pending = null;
  }

  @Override protected void onSaveInstanceState(Bundle b) { super.onSaveInstanceState(b); web.saveState(b); }

  @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
}
