package com.alienpass.app;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
	@Override
	public void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);
		// Prevent screenshots and showing sensitive views in Android recents
		getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
	}
}
