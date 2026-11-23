package uz.mital.jumavoy;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

/**
 * The JUMAVOY page comes from the phone itself, so the app opens at once — with a bad connection or none at all.
 * The address stays https://mital111222333.github.io/MitalCRM/jumavoy/ (the personal link and the chat history kept by
 * the page live there), but the files are given from the app: the newest copy downloaded from GitHub (files/web/),
 * otherwise the copy built into the APK (assets/web/). In the background the app downloads a newer page; it is used the
 * next time JUMAVOY is opened. Questions to the bot are not touched here (another address, they need the internet).
 */
class WebFiles {
  static final String[] FILES = { "index.html", "manifest.json", "icon-192.png", "icon-512.png", "icon-maskable-512.png" };
  final Context ctx;
  final File dir;
  volatile boolean updated; // a newer page was downloaded while the app was open

  WebFiles(Context c) {
    ctx = c;
    dir = new File(c.getFilesDir(), "web");
    // after an APK update its own page is newer than anything downloaded before
    SharedPreferences sp = c.getSharedPreferences("web", Context.MODE_PRIVATE);
    long v = apkVersion(c);
    if (sp.getLong("apk", -1) != v) { clear(); sp.edit().putLong("apk", v).apply(); }
  }

  static long apkVersion(Context c) {
    try { PackageInfo p = c.getPackageManager().getPackageInfo(c.getPackageName(), 0); return android.os.Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : versionCodeOld(p); } catch (Exception e) { return 0; }
  }
  @SuppressWarnings("deprecation") static long versionCodeOld(PackageInfo p) { return p.versionCode; }
  static String apkName(Context c) {
    try { return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName; } catch (Exception e) { return "?"; }
  }

  void clear() { File[] l = dir.listFiles(); if (l != null) for (File f : l) f.delete(); }

  /** the file for an address of the page, or null (then the WebView asks the network) */
  WebResourceResponse serve(String url) {
    if (url == null || !url.startsWith(MainActivity.BASE)) return null;
    String path = url.substring(MainActivity.BASE.length());
    int cut = path.length();
    for (char ch : new char[] { '?', '#' }) { int k = path.indexOf(ch); if (k >= 0 && k < cut) cut = k; }
    path = path.substring(0, cut);
    if (path.isEmpty()) path = "index.html";
    if (!Arrays.asList(FILES).contains(path)) return null;
    InputStream in = null;
    try { File f = new File(dir, path); in = f.isFile() ? new FileInputStream(f) : ctx.getAssets().open("web/" + path); }
    catch (Exception e) { return null; }
    String mime = path.endsWith(".html") ? "text/html" : path.endsWith(".json") ? "application/manifest+json" : "image/png";
    Map<String, String> h = new HashMap<>();
    h.put("Cache-Control", "no-store");
    h.put("Access-Control-Allow-Origin", "*");
    return new WebResourceResponse(mime, mime.startsWith("image") ? null : "utf-8", 200, "OK", h, in);
  }

  /** download the newest page from GitHub (in the background); true if something changed */
  boolean update() {
    boolean changed = false;
    try {
      dir.mkdirs();
      for (String name : FILES) {
        byte[] b = download(MainActivity.BASE + name + "?t=" + System.currentTimeMillis());
        if (b == null) return changed; // no internet now — try next time
        if (name.equals("index.html")) {
          String t = new String(b, StandardCharsets.UTF_8);
          if (!t.contains("</html>") || !t.contains("JUMAVOY")) return changed; // a broken or foreign page is never kept
        }
        if (Arrays.equals(b, current(name))) continue;
        File tmp = new File(dir, name + ".tmp");
        try (FileOutputStream o = new FileOutputStream(tmp)) { o.write(b); }
        if (!tmp.renameTo(new File(dir, name))) { tmp.delete(); continue; }
        if (name.equals("index.html")) changed = true;
      }
    } catch (Exception ignored) { }
    if (changed) updated = true;
    return changed;
  }

  byte[] current(String name) {
    try (InputStream in = new File(dir, name).isFile() ? new FileInputStream(new File(dir, name)) : ctx.getAssets().open("web/" + name)) { return read(in); }
    catch (Exception e) { return null; }
  }

  static byte[] download(String u) {
    HttpURLConnection c = null;
    try {
      c = (HttpURLConnection) new URL(u).openConnection();
      c.setConnectTimeout(8000); c.setReadTimeout(15000); c.setUseCaches(false);
      if (c.getResponseCode() != 200) return null;
      try (InputStream in = c.getInputStream()) { return read(in); }
    } catch (Exception e) { return null; } finally { if (c != null) c.disconnect(); }
  }

  static byte[] read(InputStream in) throws java.io.IOException {
    ByteArrayOutputStream o = new ByteArrayOutputStream(); byte[] buf = new byte[16384]; int k;
    while ((k = in.read(buf)) > 0) o.write(buf, 0, k);
    return o.toByteArray();
  }
}
