package uz.mital.jumavoy;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.provider.AlarmClock;
import android.provider.CalendarContract;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

/**
 * Things JUMAVOY does on the phone when the owner asks (phone_action in the bot): alarm, timer, an event in the phone's
 * calendar, call, SMS, route, open an app. Calls, SMS and calendar events only open the ready screen — the owner presses
 * «call» / «send» / «save» himself; nothing reaches another person by itself.
 * JS → window.JumavoyDevice.run(json) → "ok" or an error text.
 */
public class Device {
  final android.content.Context act;
  final Voice.Host host; // in the panel: it steps aside when another app opens
  final android.os.Handler ui = new android.os.Handler(android.os.Looper.getMainLooper());
  Device(android.content.Context act) { this(act, null); }
  Device(android.content.Context act, Voice.Host host) { this.act = act; this.host = host; }

  @JavascriptInterface public String run(String json) {
    try {
      JSONObject x = new JSONObject(json);
      String a = x.optString("action");
      Intent i;
      switch (a) {
        case "alarm": {
          i = new Intent(AlarmClock.ACTION_SET_ALARM)
            .putExtra(AlarmClock.EXTRA_HOUR, x.getInt("hour")).putExtra(AlarmClock.EXTRA_MINUTES, x.getInt("minute"))
            .putExtra(AlarmClock.EXTRA_MESSAGE, x.optString("label", "JUMAVOY")).putExtra(AlarmClock.EXTRA_SKIP_UI, true);
          JSONArray d = x.optJSONArray("days");
          if (d != null && d.length() > 0) {
            ArrayList<Integer> days = new ArrayList<>();
            for (int k = 0; k < d.length(); k++) {
              switch (d.getString(k)) {
                case "mon": days.add(Calendar.MONDAY); break; case "tue": days.add(Calendar.TUESDAY); break;
                case "wed": days.add(Calendar.WEDNESDAY); break; case "thu": days.add(Calendar.THURSDAY); break;
                case "fri": days.add(Calendar.FRIDAY); break; case "sat": days.add(Calendar.SATURDAY); break;
                case "sun": days.add(Calendar.SUNDAY); break;
              }
            }
            i.putExtra(AlarmClock.EXTRA_DAYS, days);
          }
          break;
        }
        case "timer":
          i = new Intent(AlarmClock.ACTION_SET_TIMER).putExtra(AlarmClock.EXTRA_LENGTH, x.getInt("seconds"))
            .putExtra(AlarmClock.EXTRA_MESSAGE, x.optString("label", "JUMAVOY")).putExtra(AlarmClock.EXTRA_SKIP_UI, true);
          break;
        case "calendar":
          i = new Intent(Intent.ACTION_INSERT).setData(CalendarContract.Events.CONTENT_URI)
            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, x.getLong("start_ms")).putExtra(CalendarContract.EXTRA_EVENT_END_TIME, x.getLong("end_ms"))
            .putExtra(CalendarContract.Events.TITLE, x.optString("title")).putExtra(CalendarContract.Events.EVENT_LOCATION, x.optString("place"));
          break;
        case "call":
          i = new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(x.getString("phone"))));
          break;
        case "sms":
          i = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(x.getString("phone")))).putExtra("sms_body", x.optString("label"));
          break;
        case "navigate":
          i = new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(x.getString("place"))));
          break;
        case "open_app": {
          i = findApp(x.getString("app"));
          if (i == null) return "Не нашёл на телефоне приложение «" + x.getString("app") + "»";
          break;
        }
        case "flashlight": return torch(x.optBoolean("on", true));
        case "volume": return volume(x.optString("level"));
        case "settings": {
          String pn = x.optString("panel");
          String act29 = pn.equals("wifi") ? android.provider.Settings.Panel.ACTION_WIFI : pn.equals("internet") ? android.provider.Settings.Panel.ACTION_INTERNET_CONNECTIVITY
            : pn.equals("volume") ? android.provider.Settings.Panel.ACTION_VOLUME : pn.equals("nfc") ? android.provider.Settings.Panel.ACTION_NFC : null;
          String old = pn.equals("wifi") ? android.provider.Settings.ACTION_WIFI_SETTINGS : pn.equals("internet") ? android.provider.Settings.ACTION_WIRELESS_SETTINGS
            : pn.equals("bluetooth") ? android.provider.Settings.ACTION_BLUETOOTH_SETTINGS : pn.equals("nfc") ? android.provider.Settings.ACTION_NFC_SETTINGS
            : pn.equals("display") ? android.provider.Settings.ACTION_DISPLAY_SETTINGS : pn.equals("battery") ? Intent.ACTION_POWER_USAGE_SUMMARY
            : pn.equals("location") ? android.provider.Settings.ACTION_LOCATION_SOURCE_SETTINGS : android.provider.Settings.ACTION_SOUND_SETTINGS;
          i = new Intent(android.os.Build.VERSION.SDK_INT >= 29 && act29 != null ? act29 : old);
          break;
        }
        case "share": {
          i = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, x.optString("text"));
          Intent to = x.optString("app").isEmpty() ? null : findApp(x.optString("app"));
          String pkg = to == null ? null : to.getComponent() != null ? to.getComponent().getPackageName() : to.getPackage();
          if (pkg != null) i.setPackage(pkg); else i = Intent.createChooser(i, "Отправить");
          break;
        }
        case "whatsapp": {
          i = new Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/" + x.getString("phone") + "?text=" + Uri.encode(x.optString("text"))));
          for (String pk : new String[] { "com.whatsapp", "com.whatsapp.w4b" }) {
            try { act.getPackageManager().getPackageInfo(pk, 0); i.setPackage(pk); break; } catch (Exception ignored) { }
          }
          break;
        }
        case "open_url": {
          String u = x.getString("url");
          if (!u.matches("(?i)^https?://\\S+$")) return "Открываю только ссылки http(s)";
          i = new Intent(Intent.ACTION_VIEW, Uri.parse(u));
          break;
        }
        default: return "Не знаю такого действия: " + a;
      }
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      final Intent go = i;
      final boolean quiet = a.equals("alarm") || a.equals("timer"); // set without a screen: the panel stays
      ui.post(() -> { try { act.startActivity(go); if (host != null && !quiet) host.close(); } catch (Exception e) { /* reported below as well */ } });
      return go.resolveActivity(act.getPackageManager()) != null ? "ok" : "На телефоне нет приложения для этого действия";
    } catch (Exception e) {
      return "Не получилось: " + e.getMessage();
    }
  }

  // the flashlight (no permission needed for the torch)
  String torch(boolean on) {
    try {
      android.hardware.camera2.CameraManager cm = (android.hardware.camera2.CameraManager) act.getSystemService(android.content.Context.CAMERA_SERVICE);
      for (String id : cm.getCameraIdList()) {
        Boolean f = cm.getCameraCharacteristics(id).get(android.hardware.camera2.CameraCharacteristics.FLASH_INFO_AVAILABLE);
        if (Boolean.TRUE.equals(f)) { cm.setTorchMode(id, on); return "ok"; }
      }
      return "На телефоне нет вспышки";
    } catch (Exception e) { return "Фонарик не включился: " + e.getMessage(); }
  }

  // the media volume (music, videos, JUMAVOY's voice): a level in %, up, down or mute; the phone shows its volume bar
  String volume(String level) {
    try {
      android.media.AudioManager am = (android.media.AudioManager) act.getSystemService(android.content.Context.AUDIO_SERVICE);
      int s = android.media.AudioManager.STREAM_MUSIC, ui = android.media.AudioManager.FLAG_SHOW_UI;
      if (level.equals("up")) am.adjustStreamVolume(s, android.media.AudioManager.ADJUST_RAISE, ui);
      else if (level.equals("down")) am.adjustStreamVolume(s, android.media.AudioManager.ADJUST_LOWER, ui);
      else if (level.equals("mute")) am.adjustStreamVolume(s, android.media.AudioManager.ADJUST_MUTE, ui);
      else { int max = am.getStreamMaxVolume(s); am.setStreamVolume(s, Math.round(max * Math.max(0, Math.min(100, Integer.parseInt(level))) / 100f), ui); }
      return "ok";
    } catch (Exception e) { return "Громкость не изменилась: " + e.getMessage(); }
  }

  // an app by the name the owner said: exact name first, then a name that contains it (Telegram, Карты, LINKO…)
  Intent findApp(String name) {
    String q = name.toLowerCase(Locale.ROOT).trim();
    PackageManager pm = act.getPackageManager();
    List<ResolveInfo> apps = pm.queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0);
    ResolveInfo part = null;
    for (ResolveInfo r : apps) {
      String label = String.valueOf(r.loadLabel(pm)).toLowerCase(Locale.ROOT);
      if (label.equals(q)) return pm.getLaunchIntentForPackage(r.activityInfo.packageName);
      if (part == null && (label.contains(q) || q.contains(label))) part = r;
    }
    return part == null ? null : pm.getLaunchIntentForPackage(part.activityInfo.packageName);
  }
}
