package uz.mital.jumavoy;

import android.app.KeyguardManager;
import android.app.assist.AssistContent;
import android.app.assist.AssistStructure;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.service.voice.VoiceInteractionService;
import android.service.voice.VoiceInteractionSession;
import android.service.voice.VoiceInteractionSessionService;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;

/**
 * JUMAVOY as a full digital assistant (the same way Gemini, ChatGPT and Perplexity are made). A long press of the power
 * button shows a PANEL OVER THE APP THAT IS OPEN — like Gemini: the same page in panel mode (?panel=1) in a transparent
 * window, the Siri glow along the screen, the answer at the bottom; the app underneath stays where it was.
 * Android also hands the assistant what is on the screen (its text and a screenshot, if «Use text from screen» /
 * «Use screenshot» are on in the assistant settings) — the page offers «Про экран» with it.
 * On the lock screen the full app opens instead (it asks to unlock: the CRM is not shown to strangers).
 * Declared in AndroidManifest.xml with res/xml/assistant.xml; speech recognition for the system: Recognizer.java.
 */
public class Assistant extends VoiceInteractionService {
  static void open(Context c) {
    Intent i = new Intent(Intent.ACTION_ASSIST).setClass(c, MainActivity.class)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    c.startActivity(i);
  }

  @Override public void onLaunchVoiceAssistFromKeyguard() { open(this); }

  public static class Sessions extends VoiceInteractionSessionService {
    @Override public VoiceInteractionSession onNewSession(Bundle args) { return new Session(this); }
  }

  public static class Session extends VoiceInteractionSession implements Voice.Host {
    WebView web;
    Voice voice;
    Edge edge;
    WebFiles files;
    String scrApp, scrText;
    Bitmap shot;
    boolean loaded;

    Session(Context c) { super(c); }

    boolean locked() {
      KeyguardManager km = (KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE);
      return km != null && km.isKeyguardLocked();
    }

    @Override public void onCreate() {
      super.onCreate();
      Window w = getWindow() == null ? null : getWindow().getWindow();
      if (w != null) {
        w.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        w.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        w.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
      }
    }

    @Override public View onCreateContentView() {
      Context c = getContext();
      files = new WebFiles(c);
      web = new WebView(c);
      web.setBackgroundColor(Color.TRANSPARENT);
      WebSettings s = web.getSettings();
      s.setJavaScriptEnabled(true);
      s.setDomStorageEnabled(true);
      s.setMediaPlaybackRequiresUserGesture(false);
      web.setWebViewClient(new WebViewClient() {
        @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
          Uri u = r.getUrl();
          if (u.toString().startsWith(MainActivity.BASE)) return false;
          try { getContext().startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); hide(); } catch (Exception ignored) { }
          return true;
        }
        @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
          return "GET".equals(r.getMethod()) ? files.serve(r.getUrl().toString()) : null;
        }
        @Override public void onPageFinished(WebView v, String url) { loaded = true; if (edge != null) edge.send(); sendScreen(); }
      });
      web.setWebChromeClient(new WebChromeClient() {
        // the page records the voice itself when the phone's recognizer cannot: allowed if the app has the microphone
        @Override public void onPermissionRequest(PermissionRequest r) {
          if (getContext().checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED) r.grant(r.getResources());
          else { r.deny(); expand(); }
        }
      });
      voice = new Voice(c, null, web, this);
      web.addJavascriptInterface(voice, "JumavoyNative");
      web.addJavascriptInterface(new Device(c, this), "JumavoyDevice");
      FrameLayout root = new FrameLayout(c);
      root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
      edge = new Edge(getWindow() == null ? null : getWindow().getWindow(), root, web);
      web.loadUrl(MainActivity.BASE + "?panel=1&assist=1");
      return root;
    }

    @Override public void onShow(Bundle args, int flags) {
      super.onShow(args, flags);
      if (locked()) { // on the lock screen: the full app, which asks to unlock first
        try { open(getContext()); } catch (Exception ignored) { }
        hide();
        return;
      }
      scrApp = null; scrText = null; shot = null;
      if (loaded && web != null) web.evaluateJavascript("window.jumavoyPanelShow && window.jumavoyPanelShow()", null);
    }

    @Override public void onHide() {
      super.onHide();
      if (web != null) web.evaluateJavascript("window.jumavoyPanelHide && window.jumavoyPanelHide()", null);
      if (voice != null) { voice.stopSpeak(); voice.stopListen(); }
    }

    @Override public void onDestroy() {
      if (voice != null) voice.destroy();
      if (web != null) { web.destroy(); web = null; }
      super.onDestroy();
    }

    // ── what is on the screen under the panel ──
    @Override public void onHandleAssist(AssistState state) {
      if (Build.VERSION.SDK_INT >= 29 && state.isFocused()) take(state.getAssistStructure(), state.getAssistContent());
    }
    @SuppressWarnings("deprecation")
    @Override public void onHandleAssist(Bundle data, AssistStructure structure, AssistContent content) {
      if (Build.VERSION.SDK_INT < 29) take(structure, content);
    }
    @Override public void onHandleScreenshot(Bitmap b) { shot = b; sendScreen(); }

    void take(AssistStructure st, AssistContent content) {
      if (st == null) return;
      StringBuilder sb = new StringBuilder();
      for (int k = 0; k < st.getWindowNodeCount() && sb.length() < 8000; k++) walk(st.getWindowNodeAt(k).getRootViewNode(), sb, 0);
      scrText = sb.toString().trim();
      try { scrApp = getContext().getPackageManager().getApplicationLabel(getContext().getPackageManager().getApplicationInfo(st.getActivityComponent().getPackageName(), 0)).toString(); }
      catch (Exception e) { scrApp = st.getActivityComponent() == null ? null : st.getActivityComponent().getPackageName(); }
      if (content != null && content.getWebUri() != null) scrText = "Ссылка: " + content.getWebUri() + "\n" + scrText;
      sendScreen();
    }
    static void walk(AssistStructure.ViewNode n, StringBuilder sb, int depth) {
      if (n == null || depth > 60 || sb.length() >= 8000) return;
      CharSequence t = n.getText();
      if (t != null && t.length() > 0) sb.append(t).append('\n');
      else if (n.getContentDescription() != null && n.getChildCount() == 0) sb.append(n.getContentDescription()).append('\n');
      for (int k = 0; k < n.getChildCount(); k++) walk(n.getChildAt(k), sb, depth + 1);
    }
    void sendScreen() {
      if (!loaded || web == null) return;
      web.post(() -> { if (web != null) web.evaluateJavascript("window.jvNative && window.jvNative.onScreen && window.jvNative.onScreen()", null); });
    }

    // Voice.Host
    @Override public void close() { hide(); }
    @Override public void expand() {
      try {
        Intent i = new Intent(getContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        getContext().startActivity(i);
      } catch (Exception ignored) { }
      hide();
    }
    @Override public String screen() {
      if (scrText == null && shot == null) return null;
      try {
        JSONObject o = new JSONObject();
        o.put("app", scrApp == null ? "" : scrApp);
        o.put("text", scrText == null ? "" : scrText);
        o.put("shot", shot != null);
        return o.toString();
      } catch (Exception e) { return null; }
    }
    @Override public String screenShot() {
      Bitmap b = shot; if (b == null) return null;
      try {
        float k = Math.min(1f, 1280f / Math.max(b.getWidth(), b.getHeight()));
        Bitmap s = k < 1f ? Bitmap.createScaledBitmap(b, Math.round(b.getWidth() * k), Math.round(b.getHeight() * k), true) : b;
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        s.compress(Bitmap.CompressFormat.JPEG, 72, o);
        return Base64.encodeToString(o.toByteArray(), Base64.NO_WRAP);
      } catch (Exception e) { return null; }
    }
  }
}
