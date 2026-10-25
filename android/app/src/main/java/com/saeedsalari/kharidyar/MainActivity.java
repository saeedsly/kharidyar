package com.saeedsalari.kharidyar;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(OfflineOcrAssetsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
