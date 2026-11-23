package uz.mital.jumavoy;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.TileService;

/**
 * «JUMAVOY» in the Quick Settings (swipe down from the top → the JUMAVOY tile): it opens and listens at once. It works
 * even when Android has given the power button back to Gemini, and on the lock screen it asks to unlock first
 * (the CRM is not shown to strangers). Add the tile once: swipe down → ✎ (edit) → drag «JUMAVOY» up.
 */
public class Tile extends TileService {
  @Override public void onStartListening() {
    super.onStartListening();
    android.service.quicksettings.Tile t = getQsTile();
    if (t == null) return;
    t.setState(android.service.quicksettings.Tile.STATE_INACTIVE);
    if (Build.VERSION.SDK_INT >= 29) t.setSubtitle("Спросить голосом");
    t.updateTile();
  }

  @Override public void onClick() {
    super.onClick();
    if (isLocked()) unlockAndRun(this::go); else go();
  }

  @SuppressWarnings("deprecation")
  @android.annotation.SuppressLint("StartActivityAndCollapseDeprecated") // the old call only below Android 14, where it is the only one
  void go() {
    Intent i = new Intent(this, MainActivity.class).putExtra("ask", "/listen")
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    try {
      // Android 14+ accepts only a PendingIntent here (an Intent throws for apps made for Android 14 and newer)
      if (Build.VERSION.SDK_INT >= 34) startActivityAndCollapse(PendingIntent.getActivity(this, 7, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
      else startActivityAndCollapse(i);
    } catch (Exception e) { try { startActivity(i); } catch (Exception ignored) { } }
  }
}
