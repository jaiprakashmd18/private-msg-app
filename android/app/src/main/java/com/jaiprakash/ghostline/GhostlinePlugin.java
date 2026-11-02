package com.jaiprakash.ghostline;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Small helper for the website running inside the app.
 *
 * pushAvailable: true only when the app was built with Firebase's
 * google-services.json. Without it, asking Firebase for a push token would
 * crash the app, so the website checks this first.
 */
@CapacitorPlugin(name = "Ghostline")
public class GhostlinePlugin extends Plugin {

    @PluginMethod
    public void info(PluginCall call) {
        int googleAppId = getContext().getResources().getIdentifier("google_app_id", "string", getContext().getPackageName());
        JSObject result = new JSObject();
        result.put("pushAvailable", googleAppId != 0);
        call.resolve(result);
    }
}
