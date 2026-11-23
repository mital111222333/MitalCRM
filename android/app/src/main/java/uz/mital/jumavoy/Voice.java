package uz.mital.jumavoy;

import android.Manifest;
import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.os.Build;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Locale;

/**
 * The phone's own voice for the web app: speech recognition (Google, on the phone, words appear while speaking, the end
 * of a phrase is found by the recognizer) and text-to-speech. Both are instant and spend no Gemini requests.
 * JS → window.JumavoyNative.listen("ru-RU") / stopListen() / speak(text, "ru-RU") / stopSpeak() / canSpeak(lang) / canListen()
 * Java → window.jvNative.onPartial(text) / onResult(text) / onError(msg) / onLevel(0..1) / onEnd() / onSpeakDone()
 */
public class Voice {
  final Activity act;
  final WebView web;
  SpeechRecognizer rec;
  TextToSpeech tts;
  boolean ttsReady;
  String pendingLang;
  int engine; // 0 the phone's default recognizer, 1 Google's service by name, 2 the on-device one (Android 12+)

  @JavascriptInterface public int version() { return 3; }

  Voice(Activity act, WebView web) {
    this.act = act;
    this.web = web;
    tts = new TextToSpeech(act, st -> {
      ttsReady = st == TextToSpeech.SUCCESS;
      if (ttsReady) {
        tts.setSpeechRate(1.08f);
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
          @Override public void onStart(String id) { }
          @Override public void onDone(String id) { if ("last".equals(id)) js("onSpeakDone", null); }
          @Override public void onError(String id) { js("onSpeakDone", null); }
        });
      }
    });
  }

  void js(String fn, String arg) {
    String a = arg == null ? "" : JSONObject.quote(arg);
    act.runOnUiThread(() -> web.evaluateJavascript("window.jvNative && window.jvNative." + fn + " && window.jvNative." + fn + "(" + a + ")", null));
  }

  @JavascriptInterface public boolean canListen() { return SpeechRecognizer.isRecognitionAvailable(act); }

  @JavascriptInterface public boolean canSpeak(String lang) {
    if (!ttsReady) return false;
    int r = tts.isLanguageAvailable(Locale.forLanguageTag(lang));
    return r >= TextToSpeech.LANG_AVAILABLE;
  }

  @JavascriptInterface public void listen(String lang) {
    act.runOnUiThread(() -> {
      if (act.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        pendingLang = lang;
        act.requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, MainActivity.MIC_NATIVE);
        return;
      }
      engine = 0;
      start(lang);
    });
  }

  void permissionResult(boolean ok) {
    if (pendingLang == null) return;
    String l = pendingLang; pendingLang = null;
    if (ok) { engine = 0; start(l); } else js("onError", "Нет доступа к микрофону. Разрешите его в настройках приложения.");
  }

  void start(String lang) {
    if (tts != null) tts.stop();
    if (rec != null) { rec.destroy(); rec = null; }
    rec = engine == 1 ? SpeechRecognizer.createSpeechRecognizer(act, new ComponentName("com.google.android.googlequicksearchbox", "com.google.android.voicesearch.serviceapi.GoogleRecognitionService"))
      : engine == 2 && Build.VERSION.SDK_INT >= 31 ? SpeechRecognizer.createOnDeviceSpeechRecognizer(act)
      : SpeechRecognizer.createSpeechRecognizer(act);
    final String lng = lang;
    rec.setRecognitionListener(new RecognitionListener() {
      @Override public void onReadyForSpeech(Bundle b) { js("onReady", null); }
      @Override public void onBeginningOfSpeech() { }
      @Override public void onRmsChanged(float db) { float v = Math.max(0f, Math.min(1f, (db + 2f) / 12f)); js("onLevel", String.valueOf(v)); }
      @Override public void onBufferReceived(byte[] b) { }
      @Override public void onEndOfSpeech() { js("onEnd", null); }
      @Override public void onError(int e) {
        // the recognizer refused (10 too many requests, 5 client, 8 busy, 11 disconnected, 12/13 language): the next one is tried
        if ((e == 10 || e == 5 || e == 8 || e == 11 || e == 12 || e == 13) && engine < 2) {
          engine++;
          act.runOnUiThread(() -> start(lng));
          return;
        }
        String m = e == SpeechRecognizer.ERROR_NO_MATCH || e == SpeechRecognizer.ERROR_SPEECH_TIMEOUT ? "" // nothing said
          : e == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ? "Нет доступа к микрофону."
          : e == SpeechRecognizer.ERROR_NETWORK || e == SpeechRecognizer.ERROR_NETWORK_TIMEOUT ? "Нет интернета для распознавания речи."
          : "Распознавание речи: ошибка " + e;
        js("onError", m);
      }
      @Override public void onResults(Bundle b) { js("onResult", best(b)); }
      @Override public void onPartialResults(Bundle b) { String t = best(b); if (!t.isEmpty()) js("onPartial", t); }
      @Override public void onEvent(int t, Bundle b) { }
    });
    Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
    i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
    i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
    i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
    i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
    i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
    i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1200L);
    i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1000L);
    rec.startListening(i);
  }

  static String best(Bundle b) {
    ArrayList<String> r = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
    return r == null || r.isEmpty() || r.get(0) == null ? "" : r.get(0);
  }

  @JavascriptInterface public void stopListen() { act.runOnUiThread(() -> { if (rec != null) rec.stopListening(); }); }

  @JavascriptInterface public void speak(String text, String lang) {
    act.runOnUiThread(() -> {
      if (!ttsReady) { js("onSpeakDone", null); return; }
      tts.setLanguage(Locale.forLanguageTag(lang));
      tts.stop();
      // long answers: by sentences, so the first one starts at once
      String[] parts = text.split("(?<=[.!?…\\n])\\s+");
      for (int k = 0; k < parts.length; k++) {
        tts.speak(parts[k], k == 0 ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, null, k == parts.length - 1 ? "last" : "p" + k);
      }
    });
  }

  @JavascriptInterface public void stopSpeak() { act.runOnUiThread(() -> { if (tts != null) tts.stop(); }); }

  void destroy() {
    if (rec != null) rec.destroy();
    if (tts != null) tts.shutdown();
  }
}
