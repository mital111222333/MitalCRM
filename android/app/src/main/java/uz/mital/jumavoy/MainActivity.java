package uz.mital.jumavoy;

import android.Manifest;
import android.app.Activity;
import android.app.KeyguardManager;
import android.content.ContentValues;
import android.content.Intent;
import android.provider.MediaStore;
import android.webkit.ValueCallback;
import java.util.ArrayList;
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
  static final int MIC = 1, MIC_NATIVE = 2, PICK = 3;
  ValueCallback<Uri[]> fileCb; // the page waits for the chosen files
  Uri cameraUri;               // where the camera puts a new photo
  WebView web;
  WebFiles files;
  long lastUpdate;
  Voice voice;
  PermissionRequest pending;
  Edge edge; // status / navigation bar heights for the page, the keyboard (Edge.java)

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
      @Override public void onPageFinished(WebView v, String url) { if (edge != null) edge.send(); }
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
      // «📎»: any file from the phone (photo, video, PDF, Word, Excel…), or a new photo / video from the camera
      @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
        if (fileCb != null) fileCb.onReceiveValue(null);
        fileCb = cb;
        Intent get = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        get.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
        ArrayList<Intent> cams = new ArrayList<>();
        cameraUri = null;
        if (Build.VERSION.SDK_INT >= 29) { // a new photo is saved to Pictures/JUMAVOY (no storage permission needed)
          try {
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.Images.Media.DISPLAY_NAME, "JUMAVOY_" + System.currentTimeMillis() + ".jpg");
            cv.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            cv.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/JUMAVOY");
            cameraUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
            if (cameraUri != null) cams.add(new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, cameraUri)
              .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION));
          } catch (Exception ignored) { cameraUri = null; }
        }
        cams.add(new Intent(MediaStore.ACTION_VIDEO_CAPTURE));
        Intent ch = Intent.createChooser(get, "Файл для JUMAVOY");
        ch.putExtra(Intent.EXTRA_INITIAL_INTENTS, cams.toArray(new Intent[0]));
        try { startActivityForResult(ch, PICK); return true; }
        catch (Exception e) { dropCamera(); fileCb = null; cb.onReceiveValue(null); return false; }
      }

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
    edge = new Edge(getWindow(), root, web);
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

  void dropCamera() { if (cameraUri != null) { try { getContentResolver().delete(cameraUri, null, null); } catch (Exception ignored) { } cameraUri = null; } }

  @Override protected void onActivityResult(int code, int res, Intent data) {
    super.onActivityResult(code, res, data);
    if (code != PICK || fileCb == null) return;
    Uri[] out = null;
    if (res == RESULT_OK) {
      if (data != null && data.getClipData() != null) {
        out = new Uri[data.getClipData().getItemCount()];
        for (int k = 0; k < out.length; k++) out[k] = data.getClipData().getItemAt(k).getUri();
      } else if (data != null && data.getData() != null) out = new Uri[] { data.getData() };
      else if (cameraUri != null) { out = new Uri[] { cameraUri }; cameraUri = null; } // the camera wrote the photo there
    }
    if (out == null || cameraUri != null && !java.util.Arrays.asList(out).contains(cameraUri)) dropCamera(); // the empty camera slot
    fileCb.onReceiveValue(out);
    fileCb = null;
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
