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
  final Activity act;
  Device(Activity act) { this.act = act; }

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
        default: return "Не знаю такого действия: " + a;
      }
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      final Intent go = i;
      act.runOnUiThread(() -> { try { act.startActivity(go); } catch (Exception e) { /* reported below as well */ } });
      return go.resolveActivity(act.getPackageManager()) != null ? "ok" : "На телефоне нет приложения для этого действия";
    } catch (Exception e) {
      return "Не получилось: " + e.getMessage();
    }
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
