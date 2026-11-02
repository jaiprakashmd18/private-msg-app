package com.jaiprakash.ghostline;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge starts.
        registerPlugin(GhostlinePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
