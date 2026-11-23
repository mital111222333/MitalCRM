package uz.mital.jumavoy;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.service.voice.VoiceInteractionService;
import android.service.voice.VoiceInteractionSession;
import android.service.voice.VoiceInteractionSessionService;

/**
 * JUMAVOY as a full digital assistant (the same way Gemini, ChatGPT and Perplexity are made), not only an activity that
 * opens on ACTION_ASSIST. Android keeps such an assistant as the default more reliably, and it works from the lock
 * screen. A long press of the power button → the system shows a session → the session opens MainActivity listening.
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

  public static class Session extends VoiceInteractionSession {
    Session(Context c) { super(c); }

    @Override public void onShow(Bundle args, int flags) {
      super.onShow(args, flags);
      try { open(getContext()); } catch (Exception ignored) { }
      hide(); // JUMAVOY's own screen does the rest
    }
  }
}
