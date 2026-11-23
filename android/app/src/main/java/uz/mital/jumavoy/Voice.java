package uz.mital.jumavoy;

import android.Manifest;
import android.app.Activity;
import android.app.role.RoleManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognitionService;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * The phone's own voice for the web app: speech recognition (words appear while speaking, the end of a phrase is found
 * by the recognizer) and text-to-speech. Both are instant and spend no Gemini requests.
 *
 * Recognizers are tried in turn — Google's service, the phone's default one, the on-device one (Android 12+; first when
 * there is no internet) — while nothing has been said yet. If none can (e.g. the phone has no Uzbek), the page is told
 * why (onFail) and records the voice itself for the server.
 *
 * JS → window.JumavoyNative.listen("ru-RU") / stopListen() / speak(text, "ru-RU") / stopSpeak() / canSpeak(lang) / canListen()
 *      / isOnline() / isAssistant() / openAssistantSettings() / diag()
 * Java → window.jvNative.onReady() / onPartial(text) / onResult(text) / onLevel(0..1) / onEnd() / onSpeakDone()
 *      / onFail({code, msg, tried, heard, lang}) / onError(msg) — the last one for nothing said («») and old pages
 */
public class Voice {
  static final ComponentName GOOGLE = new ComponentName("com.google.android.googlequicksearchbox", "com.google.android.voicesearch.serviceapi.GoogleRecognitionService");
  static final ComponentName DEVICE = new ComponentName("-", "on-device"), DEFAULT = new ComponentName("-", "system");
  /** where the page lives: the app's screen, or the panel over other apps (Assistant.Session) */
  interface Host {
    void close();            // the panel goes away (in the app: to the background)
    void expand();           // open the full JUMAVOY app
    String screen();         // what is on the screen under the panel: JSON {app, text, shot} or null
    String screenShot();     // the screenshot as base64 JPEG, or null
  }
  final android.content.Context act; // a Context: the activity, or the assistant session's context
  final Activity activity;           // null in the panel (no permission dialogs there)
  final Host host;
  final android.os.Handler ui = new android.os.Handler(android.os.Looper.getMainLooper());
  final WebView web;
  SpeechRecognizer rec;
  TextToSpeech tts;
  boolean ttsReady;
  String pendingLang;
  final List<ComponentName> plan = new ArrayList<>();
  int step, session;
  boolean began; // the person started speaking — another recognizer would lose the words
  final StringBuilder tried = new StringBuilder();

  @JavascriptInterface public int version() { return 6; }

  Voice(Activity act, WebView web) { this(act, act, web, null); }
  Voice(android.content.Context ctx, Activity activity, WebView web, Host host) {
    this.act = ctx;
    this.activity = activity;
    this.host = host;
    this.web = web;
    tts = new TextToSpeech(act, st -> {
      ttsReady = st == TextToSpeech.SUCCESS;
      if (ttsReady) {
        tts.setSpeechRate(1.08f);
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
          @Override public void onStart(String id) { }
          @Override public void onDone(String id) { if ("last".equals(id)) js("onSpeakDone", null); }
          @Override public void onError(String id) { if ("last".equals(id)) js("onSpeakDone", null); } // a middle part failed: the next ones still play
        });
      }
    });
  }

  void js(String fn, String arg) {
    String a = arg == null ? "" : JSONObject.quote(arg);
    ui.post(() -> web.evaluateJavascript("window.jvNative && window.jvNative." + fn + " && window.jvNative." + fn + "(" + a + ")", null));
  }

  // ── the internet, the assistant role, a self-check for the «Проверка» screen ──
  @JavascriptInterface public boolean isOnline() {
    try {
      ConnectivityManager cm = act.getSystemService(ConnectivityManager.class);
      Network nw = cm == null ? null : cm.getActiveNetwork();
      NetworkCapabilities c = nw == null ? null : cm.getNetworkCapabilities(nw);
      return c != null && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
    } catch (Exception e) { return true; } // unknown → let the request try
  }

  // is JUMAVOY still the phone's digital assistant? (Google sometimes switches it back to Gemini by itself)
  @JavascriptInterface public boolean isAssistant() {
    if (Build.VERSION.SDK_INT < 29) return true;
    RoleManager rm = act.getSystemService(RoleManager.class);
    return rm == null || rm.isRoleHeld(RoleManager.ROLE_ASSISTANT);
  }

  // the «Default apps» screen with «Digital assistant app» (the assistant role cannot be asked for from an app)
  @JavascriptInterface public void openAssistantSettings() {
    ui.post(() -> {
      for (String a : new String[] { Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS, Settings.ACTION_VOICE_INPUT_SETTINGS, Settings.ACTION_SETTINGS }) {
        try { act.startActivity(new Intent(a).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); if (host != null) host.close(); return; } catch (Exception ignored) { }
      }
    });
  }

  boolean hasGoogle() {
    try { act.getPackageManager().getServiceInfo(GOOGLE, 0); return true; } catch (Exception e) { return false; }
  }

  /**
   * Every speech recognizer installed on the phone, the best first: the Google app, «Speech Recognition & Synthesis by
   * Google» (com.google.android.tts — there on phones without the Google app, e.g. HONOR), then the others. Not JUMAVOY's
   * own (it only passes on) and not other assistants' apps.
   */
  static List<ComponentName> recognizers(android.content.Context c) {
    List<ComponentName> out = new ArrayList<>();
    try {
      for (ResolveInfo r : c.getPackageManager().queryIntentServices(new Intent(RecognitionService.SERVICE_INTERFACE), 0)) {
        String pkg = r.serviceInfo.packageName;
        if (pkg.equals(c.getPackageName()) || pkg.startsWith("com.anthropic") || pkg.startsWith("com.openai")) continue;
        out.add(new ComponentName(pkg, r.serviceInfo.name));
      }
    } catch (Exception ignored) { }
    out.sort((a, b) -> rank(a) - rank(b));
    return out;
  }
  static int rank(ComponentName c) {
    String p = c.getPackageName();
    return p.equals("com.google.android.googlequicksearchbox") ? 0 : p.equals("com.google.android.tts") ? 1 : p.startsWith("com.google") ? 3 : 2;
  }
  static String nameOf(ComponentName c) {
    if (c == DEVICE) return "на телефоне";
    if (c == DEFAULT) return "система";
    String p = c.getPackageName();
    return p.equals("com.google.android.googlequicksearchbox") ? "Google" : p.equals("com.google.android.tts") ? "Google Speech" : p.equals("com.google.android.as") ? "Android AI" : p;
  }
  boolean hasOnDevice() { return Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(act); }

  @JavascriptInterface public String diag() {
    JSONObject o = new JSONObject();
    try {
      o.put("apk", WebFiles.apkName(act));
      o.put("bridge", version());
      o.put("android", Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")");
      o.put("phone", Build.MANUFACTURER + " " + Build.MODEL);
      o.put("online", isOnline());
      o.put("assistant", isAssistant());
      o.put("mic", act.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED);
      o.put("google", hasGoogle());
      o.put("onDevice", hasOnDevice());
      o.put("recognition", SpeechRecognizer.isRecognitionAvailable(act));
      JSONArray rs = new JSONArray();
      for (ResolveInfo r : act.getPackageManager().queryIntentServices(new Intent(RecognitionService.SERVICE_INTERFACE), 0)) rs.put(r.serviceInfo.packageName);
      o.put("recognizers", rs);
      o.put("ttsRu", canSpeak("ru-RU"));
      o.put("ttsUz", canSpeak("uz-UZ"));
      o.put("lastTry", tried.toString());
      JSONArray pl = new JSONArray(); for (ComponentName c : recognizers(act)) pl.put(nameOf(c)); o.put("order", pl);
    } catch (Exception ignored) { }
    return o.toString();
  }

  // ── the microphone: without it no voice at all (it was off on the owner's phone after a reinstall) ──
  @JavascriptInterface public boolean hasMic() { return act.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED; }
  @JavascriptInterface public void requestMic() {
    ui.post(() -> {
      if (hasMic()) { js("onMic", "1"); return; }
      if (activity == null) { if (host != null) host.expand(); return; } // the panel cannot ask: the app asks
      activity.requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, MainActivity.MIC_ASK);
    });
  }

  // ── the panel over other apps ──
  @JavascriptInterface public boolean isPanel() { return host != null; }
  @JavascriptInterface public void closePanel() { ui.post(() -> { if (host != null) host.close(); else if (activity != null) activity.moveTaskToBack(true); }); }
  @JavascriptInterface public void openApp() { ui.post(() -> { if (host != null) host.expand(); }); }
  @JavascriptInterface public String screen() { return host == null ? null : host.screen(); }
  @JavascriptInterface public String screenShot() { return host == null ? null : host.screenShot(); }

  @JavascriptInterface public boolean canListen() { return SpeechRecognizer.isRecognitionAvailable(act) || !recognizers(act).isEmpty() || hasOnDevice(); }

  @JavascriptInterface public boolean canSpeak(String lang) {
    if (!ttsReady) return false;
    int r = tts.isLanguageAvailable(Locale.forLanguageTag(lang));
    return r >= TextToSpeech.LANG_AVAILABLE;
  }

  // ── speech recognition ──
  @JavascriptInterface public void listen(String lang) {
    ui.post(() -> {
      if (act.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        if (activity == null) { js("onError", "Разрешите микрофон: откройте JUMAVOY и нажмите на сферу."); if (host != null) host.expand(); return; }
        pendingLang = lang;
        activity.requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, MainActivity.MIC_NATIVE);
        return;
      }
      begin(lang);
    });
  }

  void permissionResult(boolean ok) {
    if (pendingLang == null) return;
    String l = pendingLang; pendingLang = null;
    if (ok) begin(l); else js("onError", "Нет доступа к микрофону. Разрешите его в настройках приложения.");
  }

  void begin(String lang) {
    plan.clear();
    boolean online = isOnline(), device = hasOnDevice();
    if (!online && device) plan.add(DEVICE);           // no internet: the on-device recognizer works without it
    plan.addAll(recognizers(act));
    if (device && !plan.contains(DEVICE)) plan.add(DEVICE);
    plan.add(DEFAULT);                                 // the phone's default (while JUMAVOY is the assistant: Recognizer.java)
    step = 0; tried.setLength(0);
    start(lang);
  }

  void start(String lang) {
    if (tts != null) tts.stop();
    if (rec != null) { rec.destroy(); rec = null; }
    final ComponentName engine = plan.get(step);
    final int my = ++session;
    began = false;
    try {
      rec = engine == DEVICE && Build.VERSION.SDK_INT >= 31 ? SpeechRecognizer.createOnDeviceSpeechRecognizer(act)
        : engine == DEFAULT ? SpeechRecognizer.createSpeechRecognizer(act)
        : SpeechRecognizer.createSpeechRecognizer(act, engine);
    } catch (Exception e) { failed(lang, engine, SpeechRecognizer.ERROR_CLIENT, null); return; }
    final String lng = lang;
    rec.setRecognitionListener(new RecognitionListener() {
      boolean live() { return my == session; }
      @Override public void onReadyForSpeech(Bundle b) { if (live()) js("onReady", null); }
      @Override public void onBeginningOfSpeech() { if (live()) began = true; }
      @Override public void onRmsChanged(float db) { if (live()) { float v = Math.max(0f, Math.min(1f, (db + 2f) / 12f)); js("onLevel", String.valueOf(v)); } }
      @Override public void onBufferReceived(byte[] b) { }
      @Override public void onEndOfSpeech() { if (live()) js("onEnd", null); }
      @Override public void onError(int e) { if (live()) failed(lng, engine, e, intentFor); }
      @Override public void onResults(Bundle b) { if (live()) { tried.append(nameOf(engine)).append(": ok "); js("onResult", best(b)); } }
      @Override public void onPartialResults(Bundle b) { if (!live()) return; String t = best(b); if (!t.isEmpty()) { began = true; js("onPartial", t); } }
      @Override public void onEvent(int t, Bundle b) { }
    });
    Intent i = intentFor = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
    i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
    i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
    i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
    i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
    i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
    if (engine == DEVICE) i.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
    // a pause to think («…bugun kamandirovkaga… Delpin, Eco Filter») must not end the question
    i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1800L);
    i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1500L);
    try { rec.startListening(i); } catch (Exception e) { failed(lang, engine, SpeechRecognizer.ERROR_CLIENT, i); }
  }
  Intent intentFor;
  boolean downloading;

  void failed(String lang, ComponentName engine, int e, Intent intent) {
    tried.append(nameOf(engine)).append(": ").append(e).append(' ');
    // 13 = the language is known but its pack is not on the phone yet: ask Android to download it (Android 13+);
    // the next questions will be recognized on the phone, even without the internet
    if (e == 13 && engine == DEVICE && intent != null && Build.VERSION.SDK_INT >= 33 && rec != null && !downloading) {
      try { rec.triggerModelDownload(intent); downloading = true; } catch (Exception ignored) { }
    }
    // nothing said (7 no match, 6 silence) → simply nothing; no permission → say so
    if (e == SpeechRecognizer.ERROR_NO_MATCH || e == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) { js("onError", ""); return; }
    if (e == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) { js("onError", "Нет доступа к микрофону. Разрешите его в настройках приложения."); return; }
    // the recognizer could not (busy, too many requests, no language, no service, no network…) and nothing was said
    // yet → the next one; the words are never lost to a switch in the middle of speech
    if (!began && step + 1 < plan.size()) { step++; ui.post(() -> start(lang)); return; }
    JSONObject o = new JSONObject();
    try {
      o.put("code", e); o.put("lang", lang); o.put("heard", began); o.put("tried", tried.toString().trim()); o.put("downloading", downloading);
      o.put("msg", e == SpeechRecognizer.ERROR_NETWORK || e == SpeechRecognizer.ERROR_NETWORK_TIMEOUT ? "Нет интернета для распознавания речи."
        : e == 12 ? "Телефон не распознаёт этот язык." : e == 13 ? "Языковой пакет для распознавания ещё не скачан." : "Распознавание речи: ошибка " + e);
    } catch (Exception ignored) { }
    js("onFail", o.toString());
  }

  static String best(Bundle b) {
    ArrayList<String> r = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
    return r == null || r.isEmpty() || r.get(0) == null ? "" : r.get(0);
  }

  @JavascriptInterface public void stopListen() { ui.post(() -> { if (rec != null) rec.stopListening(); }); }

  // ── the answer read aloud ──
  @JavascriptInterface public void speak(String text, String lang) {
    ui.post(() -> {
      if (!ttsReady) { js("onSpeakDone", null); return; }
      tts.setLanguage(Locale.forLanguageTag(lang));
      tts.stop();
      // long answers: by sentences, so the first one starts at once
      String[] parts = text.split("(?<=[.!?…\\n])\\s+");
      if (parts.length == 0) { js("onSpeakDone", null); return; }
      for (int k = 0; k < parts.length; k++) {
        tts.speak(parts[k], k == 0 ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, null, k == parts.length - 1 ? "last" : "p" + k);
      }
    });
  }

  // the screen stays on while JUMAVOY listens, thinks and speaks (it went dark in the middle of a long answer)
  @JavascriptInterface public void keepAwake(boolean on) {
    if (activity == null) return;
    ui.post(() -> {
      if (on) activity.getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
      else activity.getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    });
  }

  @JavascriptInterface public void stopSpeak() { ui.post(() -> { if (tts != null) tts.stop(); }); }

  void destroy() {
    session++;
    if (rec != null) rec.destroy();
    if (tts != null) tts.shutdown();
  }
}
