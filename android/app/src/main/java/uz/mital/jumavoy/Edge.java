package uz.mital.jumavoy;

import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.webkit.WebView;

/**
 * Full-screen drawing for the app and for the panel over other apps: the page is drawn under the status and navigation
 * bars (the Siri glow reaches the screen corners) and gets their heights as the CSS variables --sat / --sab. Android 15+
 * no longer shrinks a window for the keyboard (adjustResize is ignored there), so the keyboard height is taken off here,
 * otherwise the keyboard covers the text field.
 */
class Edge {
  final WebView web;
  float top, bottom;

  Edge(Window w, View root, WebView web) {
    this.web = web;
    if (Build.VERSION.SDK_INT < 30 || w == null) return; // Android 8–10: black bars, the window resizes for the keyboard by itself
    w.setDecorFitsSystemWindows(false);
    w.setStatusBarColor(Color.TRANSPARENT);
    w.setNavigationBarColor(Color.TRANSPARENT);
    w.setNavigationBarContrastEnforced(false);
    root.setOnApplyWindowInsetsListener((v, in) -> {
      android.graphics.Insets bars = in.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
      android.graphics.Insets ime = in.getInsets(WindowInsets.Type.ime());
      boolean kb = ime.bottom > bars.bottom;
      v.setPadding(bars.left, 0, bars.right, kb ? ime.bottom : 0);
      float d = v.getResources().getDisplayMetrics().density;
      top = bars.top / d;
      bottom = kb ? 0 : bars.bottom / d;
      send();
      return WindowInsets.CONSUMED;
    });
    root.requestApplyInsets();
  }

  void send() {
    if (web == null || Build.VERSION.SDK_INT < 30) return;
    web.evaluateJavascript("(function(s){s.setProperty('--sat','" + top + "px');s.setProperty('--sab','" + bottom
      + "px');window.dispatchEvent(new Event('resize'))})(document.documentElement.style)", null);
  }
}
