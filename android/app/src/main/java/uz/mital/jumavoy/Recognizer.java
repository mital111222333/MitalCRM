package uz.mital.jumavoy;

import android.content.ComponentName;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.RemoteException;
import android.speech.RecognitionListener;
import android.speech.RecognitionService;
import android.speech.SpeechRecognizer;

/**
 * A digital assistant must also bring a speech recognizer, and while JUMAVOY is the assistant Android uses it as the
 * phone's default one. This one simply passes everything to Google's recognizer (the same one the phone used before),
 * or to the on-device one on Android 12+, so voice input in other apps and in JUMAVOY keeps working as before.
 */
public class Recognizer extends RecognitionService {
  SpeechRecognizer inner;
  Callback cb;

  // the best recognizer on the phone except this one: the Google app, «Speech Recognition by Google», others, on-device
  SpeechRecognizer make() {
    for (ComponentName c : Voice.recognizers(this)) {
      try { return SpeechRecognizer.createSpeechRecognizer(this, c); } catch (Exception ignored) { }
    }
    if (Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(this)) return SpeechRecognizer.createOnDeviceSpeechRecognizer(this);
    return null;
  }

  @Override protected void onStartListening(Intent intent, Callback c) {
    release();
    cb = c;
    inner = make();
    if (inner == null) { send(() -> c.error(SpeechRecognizer.ERROR_CLIENT)); cb = null; return; }
    inner.setRecognitionListener(new RecognitionListener() {
      @Override public void onReadyForSpeech(Bundle b) { send(() -> c.readyForSpeech(b)); }
      @Override public void onBeginningOfSpeech() { send(c::beginningOfSpeech); }
      @Override public void onRmsChanged(float db) { send(() -> c.rmsChanged(db)); }
      @Override public void onBufferReceived(byte[] buf) { send(() -> c.bufferReceived(buf)); }
      @Override public void onEndOfSpeech() { send(c::endOfSpeech); }
      @Override public void onError(int e) { send(() -> c.error(e)); }
      @Override public void onResults(Bundle b) { send(() -> c.results(b)); }
      @Override public void onPartialResults(Bundle b) { send(() -> c.partialResults(b)); }
      @Override public void onEvent(int t, Bundle b) { }
    });
    inner.startListening(intent);
  }

  @Override protected void onStopListening(Callback c) { if (inner != null) inner.stopListening(); }

  @Override protected void onCancel(Callback c) { release(); }

  @Override public void onDestroy() { release(); super.onDestroy(); }

  void release() { if (inner != null) { inner.destroy(); inner = null; } cb = null; }

  interface Call { void run() throws RemoteException; }
  static void send(Call x) { try { x.run(); } catch (Exception ignored) { } }
}
