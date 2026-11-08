package com.lorenz.spinnext;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.speech.RecognizerIntent;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;

/** Hosts the Spin Next web app and gives it two native helpers: HTTP without CORS limits, and opening links in other apps. */
public class MainActivity extends Activity {

    private static final int REQ_SPEECH = 42;
    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        web.addJavascriptInterface(new Bridge(), "SpinNextAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if ("file".equals(u.getScheme())) return false;
                openExternal(u.toString());
                return true;
            }
        });

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_SPEECH || resultCode != RESULT_OK || data == null) return;
        ArrayList<String> results = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        if (results == null || results.isEmpty()) return;
        String js = "window.__spinNextDictation && window.__spinNextDictation(" + JSONObject.quote(results.get(0)) + ")";
        web.evaluateJavascript(js, null);
    }

    private void startDictation() {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_PROMPT, "What did you think of the album?");
        try {
            startActivityForResult(i, REQ_SPEECH);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Voice typing isn't available on this phone", Toast.LENGTH_SHORT).show();
        }
    }

    private void openExternal(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No app can open this link", Toast.LENGTH_SHORT).show();
        }
    }

    private class Bridge {
        @JavascriptInterface
        public void openExternal(final String url) {
            runOnUiThread(() -> MainActivity.this.openExternal(url));
        }

        @JavascriptInterface
        public void dictate() {
            runOnUiThread(MainActivity.this::startDictation);
        }

        @JavascriptInterface
        public void request(final String id, final String method, final String url, final String body) {
            new Thread(() -> {
                boolean ok;
                String text;
                try {
                    text = http(method, url, body);
                    ok = true;
                } catch (Exception e) {
                    ok = false;
                    text = e.getMessage() != null ? e.getMessage() : e.toString();
                }
                final String js = "window.__spinNextReply(" + JSONObject.quote(id) + "," + ok + "," + JSONObject.quote(text) + ")";
                runOnUiThread(() -> web.evaluateJavascript(js, null));
            }).start();
        }
    }

    /** Apps Script answers with a redirect to googleusercontent.com; follow it with GET, as browsers do. */
    static String http(String method, String url, String body) throws IOException {
        String current = url;
        String m = method;
        for (int hop = 0; hop < 6; hop++) {
            HttpURLConnection c = (HttpURLConnection) new URL(current).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestMethod(m);
            if ("POST".equals(m) && body != null) {
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "text/plain;charset=utf-8");
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                try (OutputStream os = c.getOutputStream()) { os.write(bytes); }
            }
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null) throw new IOException("Redirect without a location");
                current = new URL(new URL(current), loc).toString();
                m = "GET";
                continue;
            }
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            String text = read(in);
            c.disconnect();
            if (code >= 400) throw new IOException("The sheet answered with HTTP " + code);
            return text;
        }
        throw new IOException("Too many redirects");
    }

    private static String read(InputStream in) throws IOException {
        if (in == null) return "";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        in.close();
        return out.toString("UTF-8");
    }
}
